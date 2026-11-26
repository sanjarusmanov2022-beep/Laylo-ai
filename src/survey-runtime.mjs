// Durable ingress and bounded parallel processing, without changing the SURVEYS namespace.
export const SURVEY_RUNTIME_PREFIX = 'runtime:v1:';
const runtimeInbox = SURVEY_RUNTIME_PREFIX + 'inbox:';
const runtimeReceipt = SURVEY_RUNTIME_PREFIX + 'receipt:';
const runtimeExpiry = SURVEY_RUNTIME_PREFIX + 'expiry:';
const runtimeReportAt = SURVEY_RUNTIME_PREFIX + 'reports-at';
const runtimeNotice = SURVEY_RUNTIME_PREFIX + 'notice:';
const runtimeDay = 86_400_000;
export function surveyUpdateActor(update) {
  const message = update.callback_query?.message ?? update.message;
  const user = update.callback_query?.from ?? message?.from;
  return message?.chat?.type === 'private' && Number.isSafeInteger(user?.id) && user.id > 0 &&
    message.chat.id === user.id ? String(user.id) : null;
}
export function compactSurveyUpdate(update) {
  const message = update.callback_query?.message ?? update.message;
  const compact = { message_id: message.message_id, text: message.text,
    chat: { id: message.chat.id, type: 'private' }, from: { id: message.from?.id ?? message.chat.id } };
  // Owner channel setup supports forwarded channel messages; names and usernames are unnecessary.
  if (message.forward_origin?.type === 'channel') compact.forward_origin = {
    type: 'channel', chat: { id: message.forward_origin.chat?.id }, message_id: message.forward_origin.message_id,
  };
  if (message.forward_from_chat) compact.forward_from_chat = { id: message.forward_from_chat.id };
  return update.callback_query ? { update_id: update.update_id, callback_query: {
    id: update.callback_query.id, from: { id: update.callback_query.from.id },
    message: compact, data: update.callback_query.data,
  } } : { update_id: update.update_id, message: compact };
}
export class SurveyRuntime {
  constructor({ storage, handle, flushReports, notifyCompletion, waitUntil = () => {}, now = Date.now,
    concurrency = 24, batchSize = 1000, budgetMs = 18_000 }) {
    this.storage = storage; this.handle = handle; this.flushReports = flushReports;
    this.notifyCompletion = notifyCompletion; this.waitUntil = waitUntil; this.now = now;
    this.concurrency = concurrency; this.batchSize = batchSize; this.budgetMs = budgetMs;
    this.processing = null; this.ingressVersion = 0; this.wakeDrain = null; this.queued = new Map();
  }
  // SQLite storage participates in the transaction directly, including native alarm APIs.
  atomic(work) { return this.storage.transaction(() => work(this.storage)); }
  async wakeSoon(tx, at = this.now() + 1000) {
    const current = await tx.getAlarm();
    if (current === null || current > at) await tx.setAlarm(at);
  }
  reportStorage() {
    const storage = this.storage;
    return {
      get: storage.get.bind(storage), put: storage.put.bind(storage),
      delete: storage.delete.bind(storage), list: storage.list.bind(storage),
      transaction: storage.transaction.bind(storage),
      setAlarm: async at => this.atomic(async tx => {
        await tx.put(runtimeReportAt, Number(at)); await this.wakeSoon(tx, Number(at));
      }),
      deleteAlarm: async () => this.atomic(async tx => {
        // A completion can arrive between the outbox scan and this call. Recheck atomically.
        const channel = await tx.get('report-channel');
        const pending = await tx.list({ prefix: 'channel-report:', limit: 1 });
        if (channel && pending.size) {
          await tx.put(runtimeReportAt, this.now() + 1000); await this.wakeSoon(tx);
        } else await tx.delete(runtimeReportAt);
      }),
    };
  }
  async noteCompletion(id) {
    await this.atomic(async tx => {
      const key = runtimeNotice + id;
      if (!await tx.get(key)) await tx.put(key, { due: this.now() + 60_000, id });
      await this.wakeSoon(tx, this.now() + 60_000);
    });
  }
  async accept(update) {
    if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) return 400;
    const actor = surveyUpdateActor(update);
    if (!actor) return 200; // Unsupported updates must not create a queue or touch respondent state.
    if (typeof (update.callback_query?.data ?? update.message?.text) !== 'string') return 200;
    const suffix = String(update.update_id).padStart(16, '0');
    const job = { update: compactSurveyUpdate(update), actor, attempts: 0, due: 0 };
    const inserted = await this.atomic(async tx => {
      if (await tx.get(runtimeReceipt + suffix) || await tx.get(runtimeInbox + suffix)) return false;
      await tx.put(runtimeInbox + suffix, job);
      // Persist a wakeup in the same transaction before acknowledging Telegram.
      await this.wakeSoon(tx); return true;
    });
    if (inserted) this.queued.set(runtimeInbox + suffix, job);
    this.ingressVersion++; this.wakeDrain?.();
    this.waitUntil(this.drain().catch(() => { console.error('Survey inbox processing deferred to alarm'); }));
    return 200;
  }
  async finish(key, job) {
    const suffix = key.slice(runtimeInbox.length), expires = this.now() + runtimeDay;
    await this.atomic(async tx => {
      await tx.put({ [runtimeReceipt + suffix]: expires,
        [runtimeExpiry + String(expires).padStart(16, '0') + ':' + suffix]: suffix });
      await tx.delete(key);
    });
  }
  async process(key, job) {
    try {
      await this.handle(job.update);
      await this.finish(key, job);
      this.queued.delete(key); return true;
    } catch (error) {
      // A user who blocked the bot cannot receive a retry. Other failures remain durable.
      if (error.status === 403) { await this.finish(key, job); this.queued.delete(key); return true; }
      job.attempts++;
      job.due = this.now() + Math.max(
        Math.min(1000 * 2 ** Math.min(job.attempts - 1, 8), 300_000),
        Number(error.retryAfter ?? 0) * 1000);
      await this.storage.put(key, job);
      this.queued.set(key, job); return false;
    }
  }
  drain() {
    if (this.processing) return this.processing;
    this.processing = this.runBatch().finally(() => { this.processing = null; });
    return this.processing;
  }
  async runBatch() {
    const started = this.now(), active = new Set(), actors = new Set(), keys = new Set();
    const restored = await this.storage.list({ prefix: runtimeInbox, limit: this.batchSize });
    for (const [key, job] of restored) if (!this.queued.has(key)) this.queued.set(key, job);
    try {
      while (this.now() - started < this.budgetMs) {
        const version = this.ingressVersion;
        const page = [...this.queued].sort(([a], [b]) => a.localeCompare(b));
        const encountered = new Set();
        for (const [key, job] of page) {
          if (encountered.has(job.actor)) continue;
          encountered.add(job.actor);
          // Only the oldest update of each actor is eligible, even when it is backing off.
          if (active.size >= this.concurrency || actors.has(job.actor) || keys.has(key) || job.due > this.now()) continue;
          actors.add(job.actor); keys.add(key);
          const task = this.process(key, job).finally(() => {
            active.delete(task); actors.delete(job.actor); keys.delete(key);
          });
          active.add(task);
        }
        if (!active.size) break;
        if (version !== this.ingressVersion) continue;
        const arrival = new Promise(resolve => { this.wakeDrain = resolve; });
        if (version !== this.ingressVersion) this.wakeDrain();
        await Promise.race([...active, arrival]);
        this.wakeDrain = null;
      }
    } finally {
      this.wakeDrain = null;
      await Promise.allSettled([...active]);
      await this.arm();
    }
  }
  async cleanReceipts() {
    const expired = await this.storage.list({ prefix: runtimeExpiry, limit: 1000 });
    for (const [key, suffix] of expired) {
      const at = Number(key.slice(runtimeExpiry.length).split(':')[0]);
      if (at > this.now()) break;
      await this.storage.delete([key, runtimeReceipt + suffix]);
    }
  }
  async arm() {
    // One native alarm services inbox, channel outbox, completion notices and receipt expiry.
    // This transaction also closes the race with an ingress arriving as the last batch finishes.
    await this.atomic(async tx => {
      const page = await tx.list({ prefix: runtimeInbox, limit: this.batchSize });
      let at = Infinity;
      for (const [, job] of page) at = Math.min(at, Math.max(this.now() + 1000, job.due || 0));
      const report = await tx.get(runtimeReportAt);
      if (Number.isFinite(report)) at = Math.min(at, Math.max(this.now() + 1000, report));
      for (const [, job] of await tx.list({ prefix: runtimeNotice, limit: 100 }))
        at = Math.min(at, Math.max(this.now() + 1000, job.due));
      const expiry = await tx.list({ prefix: runtimeExpiry, limit: 1 });
      if (expiry.size) at = Math.min(at, Math.max(this.now() + 1000,
        Number([...expiry.keys()][0].slice(runtimeExpiry.length).split(':')[0])));
      if (Number.isFinite(at)) await tx.setAlarm(at); else await tx.deleteAlarm();
    });
  }
  async alarm() {
    try {
      await this.drain();
      const reportAt = await this.storage.get(runtimeReportAt);
      // Older releases used a native alarm without the reports-at metadata.
      if (reportAt === undefined || reportAt === null || reportAt <= this.now()) await this.flushReports();
      if (this.notifyCompletion) for (const [key, job] of await this.storage.list({ prefix: runtimeNotice, limit: 10 })) {
        if (job.due > this.now()) continue;
        try { await this.notifyCompletion(job.id); await this.storage.delete(key); }
        catch { job.due = this.now() + 60_000; await this.storage.put(key, job); }
      }
      await this.cleanReceipts();
    } finally { await this.arm(); }
  }
}
