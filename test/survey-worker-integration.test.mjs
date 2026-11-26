// Runs the real queue code in Cloudflare's local workerd/SQLite runtime; no live bot or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Native SQLite Durable Object commits inbox+alarm and processes a 1,000-request ingress burst', { timeout: 120_000, skip: process.env.LAYLO_NATIVE_RUNTIME_TEST !== '1' }, async () => {
  const { Miniflare } = await import('miniflare');
  const runtime = await readFile(new URL('../src/survey-runtime.mjs', import.meta.url), 'utf8');
  const script = runtime + `
export class ProbeStore {
  constructor(ctx) {
    this.ctx = ctx;
    this.runtime = new SurveyRuntime({
      storage: ctx.storage, waitUntil: promise => ctx.waitUntil(promise),
      flushReports: async () => {},
      handle: async update => {
        const key = 'processed:' + update.update_id;
        const value = await ctx.storage.get(key);
        if (value) throw new Error('Duplicate handling');
        await ctx.storage.put(key, update.message.text);
      },
    });
  }
  async alarm() { return this.runtime.alarm(); }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/inspect') {
      await this.runtime.drain();
      return Response.json({
        processed: (await this.ctx.storage.list({ prefix: 'processed:', limit: 1100 })).size,
        inbox: (await this.ctx.storage.list({ prefix: SURVEY_RUNTIME_PREFIX + 'inbox:', limit: 1100 })).size,
        alarm: await this.ctx.storage.getAlarm(),
      });
    }
    if (path === '/report-alarm') {
      await this.runtime.reportStorage().setAlarm(Date.now() + 60_000);
      await this.runtime.reportStorage().deleteAlarm();
      return new Response('OK');
    }
    return new Response('OK', { status: await this.runtime.accept(await request.json()) });
  }
}
export default { fetch(request, env) {
  return env.PROBE.get(env.PROBE.idFromName('burst')).fetch(request);
} };
`;
  const mf = new Miniflare({ modules: true, script, compatibilityDate: '2026-11-01',
    durableObjects: { PROBE: { className: 'ProbeStore', useSQLite: true } } });
  try {
    const updates = Array.from({ length: 1000 }, (_, i) => ({
      update_id: i + 1, message: { message_id: i + 1, text: 'Answer ' + i,
        from: { id: i + 100 }, chat: { id: i + 100, type: 'private' } },
    }));
    // Bound client connections, while delivering the entire population without awaiting individual work.
    let cursor = 0;
    await Promise.all(Array.from({ length: 50 }, async () => {
      while (cursor < updates.length) {
        const update = updates[cursor++];
        const response = await mf.dispatchFetch('http://test/telegram', { method: 'POST', body: JSON.stringify(update) });
        assert.equal(response.status, 200, await response.text());
      }
    }));
    let state;
    for (let i = 0; i < 20; i++) {
      state = await (await mf.dispatchFetch('http://test/inspect')).json();
      if (state.processed === 1000 && state.inbox === 0) break;
    }
    assert.equal(state.processed, 1000); assert.equal(state.inbox, 0);
    assert.ok(state.alarm, 'receipt cleanup must retain a native alarm');
    await mf.dispatchFetch('http://test/report-alarm');
    assert.equal((await (await mf.dispatchFetch('http://test/inspect')).json()).processed, 1000);
    const duplicate = await mf.dispatchFetch('http://test/telegram', { method: 'POST', body: JSON.stringify(updates[0]) });
    assert.equal(duplicate.status, 200);
    state = await (await mf.dispatchFetch('http://test/inspect')).json();
    assert.equal(state.processed, 1000); assert.equal(state.inbox, 0);
    console.log('LAYLO_WORKERD_RESULT ' + JSON.stringify({ ingressUpdates: 1000, processedExactlyOnce: 1000,
      nativeSQLite: true, liveTelegram: false, productionCloudflare: false }));
  } finally { await mf.dispose(); }
});
