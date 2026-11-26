import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SurveyRuntime, SURVEY_RUNTIME_PREFIX, compactSurveyUpdate } from '../src/survey-runtime.mjs';
import { pacedSurveyTelegram, surveyTelegram } from '../src/survey-telegram.mjs';
import { createSurveyBot } from '../src/surveys.mjs';
import worker, { SurveyStore } from '../src/survey-worker.mjs';
import { harness } from './helpers/survey-harness.mjs';

const prefix = SURVEY_RUNTIME_PREFIX;
const tick = () => new Promise(resolve => setImmediate(resolve));
function storageFixture() {
  const data = new Map();
  let tail = Promise.resolve(), alarm = null, listCalls = 0;
  const storage = {
    get: async key => structuredClone(data.get(key)),
    put: async (key, value) => {
      for (const [k, v] of typeof key === 'object' ? Object.entries(key) : [[key, value]])
        data.set(k, structuredClone(v));
    },
    delete: async key => {
      if (Array.isArray(key)) return key.reduce((n, k) => n + Number(data.delete(k)), 0);
      return data.delete(key);
    },
    list: async ({ prefix: p = '', limit = 1000, startAfter }) => {
      listCalls++;
      return new Map([...data].filter(([key]) => key.startsWith(p) && (!startAfter || key > startAfter))
        .sort(([a], [b]) => a.localeCompare(b)).slice(0, limit).map(([key, value]) => [key, structuredClone(value)]));
    },
    getAlarm: async () => alarm,
    setAlarm: async at => { alarm = at; },
    deleteAlarm: async () => { alarm = null; },
    transaction: work => {
      const result = tail.then(() => work(storage));
      tail = result.catch(() => {}); return result;
    },
  };
  return { storage, data, alarm: () => alarm, listCalls: () => listCalls };
}
function message(id, user, text = '/start') {
  return { update_id: id, message: { message_id: id, text,
    from: { id: user, first_name: 'DO NOT KEEP MY TELEGRAM NAME' }, chat: { id: user, type: 'private' } } };
}
function callback(id, user, data) {
  return { update_id: id, callback_query: { id: 'cb' + id, from: { id: user },
    message: { message_id: id, chat: { id: user, type: 'private' } }, data } };
}
function runtimeFixture(handle = async () => {}, fixture = storageFixture(), options = {}) {
  const background = [];
  const runtime = new SurveyRuntime({ storage: fixture.storage, handle, flushReports: async () => {},
    waitUntil: p => { background.push(p); }, ...options });
  return { ...fixture, runtime, background };
}
async function settle(runtime) {
  // A bounded batch deliberately leaves excess work for a later alarm.
  for (let i = 0; i < 20; i++) {
    await runtime.drain();
    const pending = await runtime.storage.list({ prefix: prefix + 'inbox:', limit: 1000 });
    if (!pending.size) return;
    const heads = new Map();
    for (const [, job] of pending) if (!heads.has(job.actor)) heads.set(job.actor, job);
    if ([...heads.values()].every(job => job.due > runtime.now())) return;
  }
  assert.fail('Inbox did not drain within 20 batches');
}

test('A slow respondent does not block another, while updates from the same person stay ordered', async () => {
  let release, entered, calls = [];
  const blocked = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { entered = resolve; });
  const f = runtimeFixture(async update => {
    calls.push('begin:' + update.update_id);
    if (update.update_id === 1) { entered(); await blocked; }
    calls.push('end:' + update.update_id);
  });
  await f.runtime.accept(message(1, 10)); await began;
  await f.runtime.accept(message(2, 10));
  await f.runtime.accept(message(3, 20));
  for (let i = 0; i < 20 && !calls.includes('end:3'); i++) await tick();
  assert.ok(calls.includes('end:3'), 'different user must finish while first user is blocked');
  assert.ok(!calls.includes('begin:2'), 'same user must wait for their own preceding update');
  assert.ok(f.alarm(), 'in-flight work must retain a durable recovery alarm');
  release(); await settle(f.runtime);
  assert.ok(calls.indexOf('end:1') < calls.indexOf('begin:2'));
});

test('Ingress persists before acknowledging; restart replays queued work and strips Telegram names', async () => {
  const f = storageFixture();
  const first = new SurveyRuntime({ storage: f.storage, handle: async () => assert.fail('must not run'),
    flushReports: async () => {} });
  first.drain = async () => {}; // Simulate eviction immediately after the persisted acknowledgement.
  assert.equal(await first.accept(message(9, 45, 'A private answer')), 200);
  assert.ok(f.alarm());
  assert.equal((await f.storage.list({ prefix: prefix + 'inbox:' })).size, 1);
  assert.ok(!JSON.stringify([...f.data]).includes('DO NOT KEEP'));
  const processed = [];
  const recovered = runtimeFixture(async update => processed.push(update.message.text), f);
  await recovered.runtime.alarm();
  assert.deepEqual(processed, ['A private answer']);
  assert.equal((await f.storage.list({ prefix: prefix + 'inbox:' })).size, 0);
  await recovered.runtime.accept(message(9, 45));
  await settle(recovered.runtime);
  assert.equal(processed.length, 1, 'duplicate delivery after restart must not run again');
});

test('Parallel duplicate deliveries are processed once and a storage failure is not acknowledged', async () => {
  let count = 0;
  const f = runtimeFixture(async () => { count++; await tick(); });
  await Promise.all(Array.from({ length: 50 }, () => f.runtime.accept(message(3, 5))));
  await settle(f.runtime); assert.equal(count, 1);
  const broken = storageFixture(); broken.storage.transaction = async () => { throw new Error('disk full'); };
  const failed = runtimeFixture(async () => {}, broken);
  await assert.rejects(() => failed.runtime.accept(message(4, 5)), /disk full/);
});

test('429 cooldown is durable, preserves actor order, and does not block other users', async () => {
  let now = 100_000, fail = true; const seen = [];
  const f = runtimeFixture(async update => {
    if (update.update_id === 1 && fail) {
      fail = false; const error = new Error('rate limited'); error.status = 429; error.retryAfter = 30; throw error;
    }
    seen.push(update.update_id);
  }, storageFixture(), { now: () => now });
  await Promise.all([f.runtime.accept(message(1, 10)), f.runtime.accept(message(2, 10)), f.runtime.accept(message(3, 20))]);
  await settle(f.runtime);
  assert.deepEqual(seen, [3]);
  assert.equal((await f.storage.list({ prefix: prefix + 'inbox:' })).size, 2);
  now += 30_001; await f.runtime.alarm(); await settle(f.runtime);
  assert.deepEqual(seen, [3, 1, 2]);
});

test('Permanent blocked-user errors terminate only that delivery; temporary failures remain queued', async () => {
  let now = 10_000;
  const f = runtimeFixture(async update => {
    const error = new Error('delivery failed'); error.status = update.update_id === 1 ? 403 : 500; throw error;
  }, storageFixture(), { now: () => now });
  await Promise.all([f.runtime.accept(message(1, 10)), f.runtime.accept(message(2, 20))]);
  await f.runtime.drain();
  const pending = await f.storage.list({ prefix: prefix + 'inbox:' });
  assert.equal(pending.size, 1); assert.equal([...pending.values()][0].update.update_id, 2);
});

test('Report alarm changes cannot erase pending updates, and old channel outboxes still recover', async () => {
  let now = 100_000, reports = 0;
  const f = runtimeFixture(async () => {}, storageFixture(), { now: () => now, flushReports: async () => { reports++; } });
  f.runtime.drain = async () => {};
  await f.runtime.accept(message(1, 10));
  const before = f.alarm();
  await f.runtime.reportStorage().setAlarm(now + 60_000);
  await f.runtime.reportStorage().deleteAlarm();
  assert.equal(f.alarm(), before);
  await f.runtime.arm(); assert.equal(f.alarm(), now + 1000);
  await f.storage.put('report-channel', { id: -100123 });
  await f.storage.put('channel-report:late', { nextAttemptAt: now });
  await f.runtime.reportStorage().deleteAlarm();
  assert.equal(await f.storage.get(prefix + 'reports-at'), now + 1000, 'late outbox writes must retain a report alarm');
  const legacy = runtimeFixture(async () => {}, storageFixture(), { flushReports: async () => { reports++; } });
  await legacy.runtime.alarm(); assert.equal(reports, 1);
});

test('Receipts expire in bounded cleanup and notifications are coalesced per survey', async () => {
  let now = 1_000_000; const notified = [];
  const f = runtimeFixture(async () => {}, storageFixture(), { now: () => now, notifyCompletion: async id => notified.push(id) });
  await f.runtime.accept(message(1, 5)); await settle(f.runtime);
  await Promise.all(Array.from({ length: 1000 }, () => f.runtime.noteCompletion('employees')));
  assert.equal((await f.storage.list({ prefix: prefix + 'notice:' })).size, 1);
  await f.runtime.alarm(); assert.equal(notified.length, 0);
  now += 60_001; await f.runtime.alarm(); assert.deepEqual(notified, ['employees']);
  now += 86_400_001; await f.runtime.alarm();
  assert.equal((await f.storage.list({ prefix: prefix + 'receipt:' })).size, 0);
  assert.equal((await f.storage.list({ prefix: prefix + 'expiry:' })).size, 0);
});

test('Ingress ignores forged private identities, channel/media updates and invalid IDs', async () => {
  const f = runtimeFixture(() => assert.fail('must not handle invalid updates'));
  assert.equal(await f.runtime.accept(message(-1, 1)), 400);
  const forged = message(1, 10); forged.message.chat.id = 20;
  assert.equal(await f.runtime.accept(forged), 200);
  const group = message(2, 10); group.message.chat.type = 'group';
  assert.equal(await f.runtime.accept(group), 200);
  const media = message(3, 10); delete media.message.text;
  assert.equal(await f.runtime.accept(media), 200);
  assert.equal((await f.storage.list({ prefix: prefix + 'inbox:' })).size, 0);
  const forwarded = message(4, 1); forwarded.message.forward_origin = { type: 'channel', chat: { id: -100123, title: 'Not needed' }, message_id: 7 };
  assert.deepEqual(compactSurveyUpdate(forwarded).message.forward_origin.chat, { id: -100123 });
});

test('Outbound pacing is fair: a channel backlog does not reserve every future global slot', async () => {
  const events = [], started = performance.now();
  const api = pacedSurveyTelegram({ call: async (method, body) => {
    events.push({ chat: body.chat_id, method, at: performance.now() - started }); return {};
  } }, { globalMs: 5, privateMs: 25, channelMs: 70 });
  await Promise.all([
    api.call('sendMessage', { chat_id: -100, text: 'first' }),
    api.call('sendDocument', { chat_id: -100 }),
    api.call('sendMessage', { chat_id: 1, text: 'private first' }),
    api.call('sendMessage', { chat_id: 1, text: 'private second' }),
    api.call('answerCallbackQuery', { callback_query_id: 'cb' }),
  ]);
  const channels = events.filter(e => e.chat === -100), privateEvents = events.filter(e => e.chat === 1);
  assert.ok(channels[1].at - channels[0].at >= 65);
  assert.ok(privateEvents[1].at - privateEvents[0].at >= 20);
  assert.ok(privateEvents[0].at < channels[1].at, 'private replies must pass a waiting channel post');
  assert.ok(events.find(e => e.method === 'answerCallbackQuery').at < channels[1].at);
});

test('Telegram retry_after is exposed and a long cooldown returns work to the durable inbox', async () => {
  const fake = surveyTelegram('not-a-real-token', async () => ({
    ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 60 } }),
  }));
  await assert.rejects(() => fake.call('sendMessage', {}), e => e.status === 429 && e.retryAfter === 60);
  let calls = 0;
  const api = pacedSurveyTelegram({ call: async () => {
    calls++; const e = new Error('rate limit'); e.status = 429; e.retryAfter = 60; throw e;
  } });
  await assert.rejects(() => api.call('sendMessage', { chat_id: 1 }), e => e.status === 429);
  await assert.rejects(() => api.call('sendMessage', { chat_id: 2 }), e => e.retryAfter >= 59);
  assert.equal(calls, 1);
});

test('Parallel private codes reserve atomically and concurrent report flushes cannot duplicate channel posts', async () => {
  const mini = { id: 'mini', title: 'Test', sections: ['Test'],
    questions: [{ id: 1, section: 1, type: 'single', text: 'Choose', options: ['A', 'B'] }] };
  const h = harness([mini]);
  for (const user of [10, 20]) { await h.message(user, '/start mini'); await h.press(user, 'Boshlash'); }
  await Promise.all([h.message(10, '789-456-85'), h.message(20, '789-456-85')]);
  assert.equal(h.sessions().filter(s => s.publicIdentity?.kind === 'code').length, 1);
  const first = h.sessions().find(s => s.publicIdentity);
  await h.storage.put('report-channel', { id: -100123456, title: 'Test', username: 'reports_test' });
  await h.storage.put('channel-report:mini:' + first.token, { survey: mini,
    session: { ...first, stage: 'done', completedAt: '2026-11-26T00:00:00.000Z', answers: { 1: { choices: ['A'] } }, script: 'latin' }, attempts: 0, nextAttemptAt: 0 });
  await Promise.all([h.bot.flushChannelReports(), h.bot.flushChannelReports(), h.bot.flushChannelReports()]);
  assert.equal(h.messages.filter(m => m.method === 'sendDocument' && m.body.get('chat_id') === '-100123456').length, 1);
});

test('1,000 concurrent respondents finish a 100-question survey with isolated answers and replay deduplication', { timeout: 180_000, skip: process.env.LAYLO_SKIP_LOAD === '1' }, async () => {
  const users = 1000, count = 100, started = performance.now();
  const fixture = storageFixture(), latest = new Map();
  let bot, updateId = 0, active = 0, maxActive = 0, sends = 0, runtime;
  const definition = { id: 'loadtest', title: 'Load simulation', sections: ['Questions'],
    questions: Array.from({ length: count }, (_, i) => ({
      id: i + 1, section: 1, type: 'single', text: 'Question ' + (i + 1), options: ['A', 'B'],
    })) };
  const api = { call: async (method, body) => {
    sends++;
    if (body.chat_id) latest.set(body.chat_id, body);
    await Promise.resolve(); return { message_id: sends };
  } };
  runtime = new SurveyRuntime({
    storage: fixture.storage, flushReports: async () => {},
    waitUntil: promise => { void promise.catch(() => {}); },
    handle: async update => {
      active++; maxActive = Math.max(maxActive, active);
      try { await bot.handle(update); } finally { active--; }
    },
  });
  bot = createSurveyBot({ storage: runtime.reportStorage(), api, ownerId: 1,
    username: 'LoadTestBot', definitions: [definition], deferChannelReports: true,
    queueCompletion: id => runtime.noteCompletion(id) });
  await bot.ready;
  const population = Array.from({ length: users }, (_, i) => 100 + i);
  async function burst(make) {
    await Promise.all(population.map((user, i) => runtime.accept(make(++updateId, user, i))));
    await settle(runtime);
  }
  function press(id, user, part) {
    const buttons = latest.get(user)?.reply_markup?.inline_keyboard.flat() ?? [];
    const button = buttons.find(b => b.callback_data?.includes(part));
    assert.ok(button, 'Missing load-test button ' + part + ' for ' + user);
    return callback(id, user, button.callback_data);
  }
  await burst((id, user) => message(id, user, '/start loadtest'));
  await burst((id, user) => press(id, user, 'script:latin'));
  await burst((id, user) => press(id, user, ':begin'));
  await burst((id, user) => message(id, user, 'Respondent ' + user));
  await burst((id, user) => press(id, user, ':skip'));
  for (let q = 0; q < count; q++)
    await burst((id, user, i) => press(id, user, ':v' + (i % 2)));
  await burst((id, user) => press(id, user, ':submit'));
  const sessions = [...fixture.data].filter(([key]) => key.startsWith('session:')).map(([, value]) => value);
  assert.equal(sessions.length, users);
  for (const s of sessions) {
    assert.equal(s.stage, 'done'); assert.equal(Object.keys(s.answers).length, count);
    const user = Number(s.publicIdentity.value.replace('Respondent ', ''));
    const expected = (user - 100) % 2 ? 'B' : 'A';
    assert.ok(Object.values(s.answers).every(a => a.choices[0] === expected));
  }
  assert.ok(maxActive > 1 && maxActive <= 24);
  assert.equal((await fixture.storage.list({ prefix: prefix + 'inbox:', limit: 1 })).size, 0);
  const before = sends;
  await runtime.accept(message(updateId, population.at(-1), '/start loadtest')); await settle(runtime);
  assert.equal(sends, before);
  const result = { kind: 'mock-telegram-and-storage', respondents: users, questionsEach: count,
    updatesProcessed: updateId, answersVerified: users * count, maxParallelHandlers: maxActive,
    elapsedMs: Math.round(performance.now() - started), storageListCalls: fixture.listCalls(),
    productionLoadTest: false, freeQuotaGuaranteed: false };
  console.log('LAYLO_LOAD_RESULT ' + JSON.stringify(result));
});
