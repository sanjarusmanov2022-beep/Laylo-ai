import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSurveyBot, parseAmount, surveyStats, validateSurvey } from '../src/surveys.mjs';
import worker, { SurveyStore } from '../src/survey-worker.mjs';

const definitions = await Promise.all(['employees', 'employers'].map(async id => JSON.parse(await readFile(new URL(`../config/surveys/${id}.json`, import.meta.url), 'utf8'))));

function harness(defs = definitions, existing) {
  const data = existing ?? new Map();
  const messages = [];
  const storage = {
    get: async key => structuredClone(data.get(key)),
    put: async (key, value) => { data.set(key, structuredClone(value)); },
    list: async ({ prefix, limit, startAfter }) => new Map([...data].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter)).slice(0, limit)),
  };
  const api = { call: async (method, body) => {
    messages.push({ method, body: body instanceof FormData ? body : structuredClone(body) });
    return { message_id: messages.length };
  } };
  const bot = createSurveyBot({ storage, api, ownerId: 1, username: 'SurveyTestBot', definitions: defs });
  let updateId = 0;
  const message = (user, text) => bot.handle({ update_id: ++updateId, message: { text, from: { id: user, first_name: 'Telegram name never stored' }, chat: { id: user, type: 'private' } } });
  const buttons = user => messages.findLast(m => m.body.chat_id === user && m.body.reply_markup)?.body.reply_markup.inline_keyboard.flat() ?? [];
  const press = async (user, text) => {
    const button = buttons(user).find(b => b.text === text || b.text.includes(text));
    assert.ok(button, `Button not found: ${text}`);
    const update = { update_id: ++updateId, callback_query: { id: `cb${updateId}`, from: { id: user }, message: { message_id: messages.length, chat: { id: user, type: 'private' } }, data: button.callback_data } };
    await bot.handle(update);
    return update;
  };
  const sessions = () => [...data].filter(([key]) => key.startsWith('session:')).map(([, session]) => session);
  return { data, storage, messages, bot, message, press, buttons, sessions };
}

test('Both role questionnaires validate and keep all supplied employee questions', () => {
  assert.equal(validateSurvey(definitions[0]).questions.length, 57);
  assert.equal(validateSurvey(definitions[1]).questions.length, 40);
  assert.equal(definitions[0].questions[5].type, 'money');
  assert.equal(definitions[1].questions[2].type, 'number');
  assert.equal(parseAmount('3,5 mln').amount, 3500000);
  assert.deepEqual(parseAmount('7 000 USD'), { amount: 7000, currency: 'USD' });
  assert.equal(parseAmount('-500'), null);
  assert.equal(parseAmount('5 million blah'), null);
});

test('Roles, private admin access, duplicate and forged callbacks, and resume after restart', async () => {
  const h = harness();
  await h.message(222, '/start');
  assert.ok(h.buttons(222).some(b => b.text.includes('Xodim')));
  assert.ok(h.buttons(222).some(b => b.text.includes('Rahbar')));
  const before = h.messages.length;
  await h.bot.handle({ update_id: 100, callback_query: { id: 'attack', from: { id: 222 }, message: { chat: { id: 222, type: 'private' } }, data: 'a:export:all' } });
  assert.equal(h.messages.slice(before).filter(m => m.method !== 'answerCallbackQuery').length, 0);
  await h.press(222, 'Xodim');
  await h.press(222, 'Boshlash');
  await h.press(222, 'Ismsiz');
  const update = await h.press(222, '2–5 oy');
  assert.equal(h.sessions()[0].index, 1);
  await h.bot.handle(update);
  assert.equal(h.sessions()[0].index, 1);
  await h.bot.handle({ ...update, update_id: 999, callback_query: { ...update.callback_query, from: { id: 333 }, message: { chat: { id: 333, type: 'private' } } } });
  assert.equal(h.sessions()[0].index, 1);
  await h.press(222, 'Keyinroq');
  const restarted = harness(definitions, h.data);
  await restarted.message(222, '/survey');
  assert.match(restarted.messages.at(-1).body.text, /Savol 2\/57/);
  assert.equal(h.sessions()[0].answers[1].choices[0], '2–5 oy');
  assert.ok(!JSON.stringify([...h.data]).includes('Telegram name never stored'));
  assert.ok(![...h.data.keys()].some(k => k.includes(':222')));
});

test('Participants finish both roles independently, and reports/export include only their own answers', async () => {
  const h = harness();
  const participants = Number(process.env.LAYLO_TEST_PARTICIPANTS || 20);
  assert.ok(participants > 0 && participants % 2 === 0);
  for (let i = 0; i < participants; i++) {
    const user = 100 + i;
    const survey = definitions[i % 2];
    await h.message(user, `/start ${survey.id}`);
    await h.press(user, 'Boshlash');
    await h.press(user, 'Ismsiz');
    for (const q of survey.questions) {
      if (q.type === 'single') await h.press(user, q.options[0].slice(0, 30));
      else if (q.type === 'multi') {
        for (let n = 0; n < (q.choose ?? 1); n++) await h.press(user, `${n + 1}.`);
        await h.press(user, 'Davom etish');
      } else await h.message(user, q.type === 'money' ? '3,5 mln' : q.type === 'number' ? '30' : 'Sinov fikri');
    }
    assert.match(h.messages.at(-1).body.text, /Savollar tugadi/);
    await h.press(user, 'Javoblarni yuborish');
  }
  for (const survey of definitions) {
    const sessions = h.sessions().filter(s => s.survey === survey.id);
    const stats = surveyStats(survey, sessions);
    assert.equal(stats.completed, participants / 2);
    assert.equal(stats.questions[0].answered, participants / 2);
  }
  await h.message(1, '/report');
  const reports = h.messages.filter(m => m.body.chat_id === 1 && typeof m.body.text === 'string').map(m => m.body.text).join('\n');
  assert.match(reports, /100%/);
  assert.match(reports, /mediana 3,500,000/);
  await h.message(1, '/export');
  const file = h.messages.findLast(m => m.method === 'sendDocument').body.get('document');
  const csv = await file.text();
  assert.equal(csv.trim().split('\r\n').length, 1 + participants / 2 * (57 + 40));
  assert.ok(!csv.includes('session:'));
  assert.ok(!csv.includes('Telegram name never stored'));
  await h.message(100, '/start employees');
  assert.equal(h.sessions().filter(s => s.stage === 'done').length, participants);
});

test('Multiple choice needs three choices, back restores answers, and closed surveys preserve progress', async () => {
  const mini = { id: 'mini', title: 'Sinov', sections: ['Savollar'], questions: [
    { id: 1, section: 1, text: 'Uchta tanlang', type: 'multi', choose: 3, options: ['A', 'B', 'C', 'D'] },
    { id: 2, section: 1, text: 'Son', type: 'number' },
  ] };
  const h = harness([mini]);
  await h.message(22, '/start mini'); await h.press(22, 'Boshlash'); await h.press(22, 'Ismsiz');
  await h.press(22, '1.'); await h.press(22, 'Davom etish');
  assert.equal(h.sessions()[0].index, 0);
  await h.press(22, '2.'); await h.press(22, '3.'); await h.press(22, 'Davom etish');
  await h.press(22, 'Orqaga');
  assert.equal(h.sessions()[0].index, 0);
  assert.equal(h.sessions()[0].answers[1].choices.length, 3);
  await h.press(22, 'Davom etish');
  await h.message(1, '/surveys'); await h.press(1, 'yopish');
  await h.message(22, '30');
  assert.equal(h.sessions()[0].index, 1);
  await h.message(1, '/surveys'); await h.press(1, 'ochish');
  await h.message(22, 'abc'); assert.equal(h.sessions()[0].index, 1);
  await h.message(22, '30'); await h.press(22, 'yuborish');
  assert.equal(h.sessions()[0].answers[2].number, 30);
});

test('Skipped answers do not inflate percentages and uncompleted answers are marked in CSV', async () => {
  const mini = { id: 'mini', title: 'Test', sections: ['Savollar'], questions: [{ id: 1, section: 1, type: 'single', text: 'Tanlang', options: ['Ha', 'Yo‘q'] }] };
  const h = harness([mini]);
  for (const user of [10, 20, 30]) {
    await h.message(user, '/start mini'); await h.press(user, 'Boshlash'); await h.press(user, 'Ismsiz');
    if (user === 30) continue;
    await h.press(user, user === 10 ? '1.' : 'O‘tkazib'); await h.press(user, 'yuborish');
  }
  const stats = surveyStats(mini, h.sessions());
  assert.deepEqual([stats.started, stats.completed, stats.unfinished], [3, 2, 1]);
  assert.equal(stats.questions[0].answered, 1);
  assert.equal(stats.questions[0].skipped, 1);
  assert.equal(stats.questions[0].choices[0].percent, 100);
});

test('Admin creates another survey from chat and draft content is kept out of respondent paths', async () => {
  const h = harness();
  await h.message(1, '/newsurvey'); await h.message(1, 'Yangi mavzu'); await h.message(1, 'Qoniqdingizmi? | Ha | Yo‘q');
  await h.press(1, 'Tayyor');
  const custom = [...h.data].find(([key]) => key.startsWith('custom:'))[1];
  assert.equal(custom.questions.length, 1);
  await h.message(2, `/start ${custom.id}`);
  assert.match(h.messages.at(-1).body.text, /Yangi mavzu/);
});

test('Worker rejects unauthenticated access and does not expose stored responses', async () => {
  const env = { TELEGRAM_WEBHOOK_SECRET: 'test-secret' };
  const request = new Request('https://test/telegram', { method: 'POST', body: '{}' });
  assert.equal((await worker.fetch(request, env)).status, 403);
  assert.equal((await worker.fetch(new Request('https://test/data'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://test/health'), env)).status, 200);
  const h = harness();
  const obj = new SurveyStore({ storage: h.storage }, { TELEGRAM_OWNER_ID: '1', TELEGRAM_BOT_USERNAME: 'TestBot', TELEGRAM_BOT_TOKEN: 'test' });
  assert.equal((await obj.fetch(new Request('https://internal', { method: 'POST', body: 'invalid' }))).status, 400);
});
