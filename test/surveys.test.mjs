import { buildSurveyInsights, renderSurveyInsights } from '../src/survey-insights.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSurveyBot, parseAmount, surveyStats, validateSurvey, toScript, parsePublicIdentity } from '../src/surveys.mjs';
import worker, { SurveyStore } from '../src/survey-worker.mjs';

const definitions = await Promise.all(['employees', 'employers'].map(async id => JSON.parse(await readFile(new URL(`../config/surveys/${id}.json`, import.meta.url), 'utf8'))));

function harness(defs = definitions, existing, autoScript = true) {
  const data = existing ?? new Map();
  const messages = [];
  const storage = {
    get: async key => structuredClone(data.get(key)),
    delete: async key => data.delete(key),
    put: async (key, value) => {
      if (typeof key === 'object') for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v));
      else data.set(key, structuredClone(value));
    },
    setAlarm: async time => data.set('alarmAt', time),
    deleteAlarm: async () => data.delete('alarmAt'),
    list: async ({ prefix, limit, startAfter }) => new Map([...data].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter)).slice(0, limit)),
  };
  const api = { call: async (method, body) => {
    messages.push({ method, body: body instanceof FormData ? body : structuredClone(body) });
    if (method === 'getMe') return { id: 999, username: 'SurveyTestBot' };
    if (method === 'getChat') return { id: -100123456, type: 'channel', title: 'Hisobotlar', username: 'reports_test' };
    if (method === 'getChatMember') return { status: 'administrator', can_post_messages: true };
    return { message_id: messages.length };
  } };
  const bot = createSurveyBot({ storage, api, ownerId: 1, username: 'SurveyTestBot', definitions: defs });
  let updateId = 0;
  const chooseDefaultScript = async user => {
    if (autoScript && messages.findLast(m => m.body.chat_id === user)?.body.reply_markup?.inline_keyboard.flat().some(b => b.callback_data === 'script:latin')) await press(user, 'Lotincha');
  };
  const message = async (user, text) => {
    await bot.handle({ update_id: ++updateId, message: { text, from: { id: user, first_name: 'Telegram name never stored' }, chat: { id: user, type: 'private' } } });
    await chooseDefaultScript(user);
  };
  const buttons = user => messages.findLast(m => m.body.chat_id === user && m.body.reply_markup)?.body.reply_markup.inline_keyboard.flat() ?? [];
  const press = async (user, text) => {
    const button = buttons(user).find(b => b.text === text || b.text.includes(text));
    assert.ok(button, `Button not found: ${text}`);
    const update = { update_id: ++updateId, callback_query: { id: `cb${updateId}`, from: { id: user }, message: { message_id: messages.length, chat: { id: user, type: 'private' } }, data: button.callback_data } };
    await bot.handle(update);
    await chooseDefaultScript(user);
    return update;
  };
  const sessions = () => [...data].filter(([key]) => key.startsWith('session:')).map(([, session]) => session);
  return { data, storage, messages, api, bot, message, press, buttons, sessions };
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
  await h.message(222, 'Test respondent'); await h.press(222, 'Yoshni o‘tkazib');
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
    await h.message(user, 'Test respondent'); await h.press(user, 'Yoshni o‘tkazib');
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
  await h.message(22, '/start mini'); await h.press(22, 'Boshlash'); await h.message(22, 'Test respondent'); await h.press(22, 'Yoshni o‘tkazib');
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
    await h.message(user, '/start mini'); await h.press(user, 'Boshlash'); await h.message(user, 'Test respondent'); await h.press(user, 'Yoshni o‘tkazib');
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


test('Owner client mode completes both real questionnaires without entering reports or CSV', async () => {
  const h = harness();
  await h.message(1, '/admin');
  assert.ok(h.buttons(1).some(b => b.text === '🧪 Mijoz rejimi'));
  await h.press(1, 'Mijoz rejimi');
  assert.match(h.messages.at(-1).body.text, /SINOV/);
  for (const survey of definitions) {
    await h.press(1, survey.id === 'employees' ? 'Xodim' : 'Rahbar');
    await h.press(1, 'Boshlash'); await h.message(1, 'Test respondent'); await h.press(1, 'Yoshni o‘tkazib');
    for (const q of survey.questions) {
      assert.match(h.messages.at(-1).body.text, /Mijoz rejimi · SINOV/);
      if (q.type === 'single') await h.press(1, '1.');
      else if (q.type === 'multi') {
        for (let n = 0; n < (q.choose ?? 1); n++) await h.press(1, (n + 1) + '.');
        await h.press(1, 'Davom etish');
      } else await h.message(1, q.type === 'money' ? '3,5 mln' : q.type === 'number' ? '30' : 'OWNER_PREVIEW_ONLY');
    }
    await h.press(1, 'Javoblarni yuborish');
    assert.match(h.messages.at(-1).body.text, /Sinov yakunlandi/);
    await h.press(1, 'Xodim / Rahbar');
  }
  const previews = [...h.data].filter(([key]) => key.startsWith('preview-session:')).map(([, s]) => s);
  assert.equal(previews.length, 2);
  assert.ok(previews.every(s => s.stage === 'done' && s.preview));
  assert.equal(h.sessions().length, 0);
  assert.equal(surveyStats(definitions[0], previews).completed, 0);
  assert.ok(!h.messages.some(m => m.body.text?.startsWith('Yangi so‘rovnoma yakunlandi')));
  await h.press(1, 'Admin menyusi');
  await h.message(1, '/report');
  const reports = h.messages.filter(m => m.body.text?.includes('Foizlar har bir')).map(m => m.body.text).join('\n');
  assert.match(reports, /Boshlagan — 0/);
  assert.match(reports, /Yakunlagan — 0/);
  await h.message(1, '/export');
  const csv = await h.messages.findLast(m => m.method === 'sendDocument').body.get('document').text();
  assert.equal(csv.trim().split('\r\n').length, 1);
  assert.ok(!csv.includes('OWNER_PREVIEW_ONLY'));
});

test('Client preview resets, resumes after restart and leaves real owner responses intact', async () => {
  const h = harness();
  await h.message(1, '/start employees'); await h.press(1, 'Boshlash'); await h.message(1, 'Test respondent'); await h.press(1, 'Yoshni o‘tkazib');
  await h.press(1, '2–5 oy');
  const real = structuredClone(h.sessions()[0]);
  await h.message(1, '/admin'); await h.press(1, 'Mijoz rejimi'); await h.press(1, 'Xodim');
  await h.press(1, 'Boshlash'); await h.message(1, 'Test respondent'); await h.press(1, 'Yoshni o‘tkazib'); await h.press(1, '1.');
  await h.press(1, 'Keyinroq'); await h.message(1, '/survey');
  assert.match(h.messages.at(-1).body.text, /Savol 2[/]57/);
  const restarted = harness(definitions, h.data);
  await restarted.message(1, '/survey');
  assert.match(restarted.messages.at(-1).body.text, /SINOV/);
  assert.match(restarted.messages.at(-1).body.text, /Savol 2[/]57/);
  await h.press(1, 'Boshidan boshlash');
  const preview = [...h.data].find(([key]) => key.startsWith('preview-session:'))[1];
  assert.equal(preview.stage, 'intro'); assert.deepEqual(preview.answers, {});
  assert.deepEqual(h.sessions()[0], real);
  await h.message(1, '/admin'); await h.message(1, '/survey employees');
  assert.match(h.messages.at(-1).body.text, /Savol 2[/]57/);
  assert.ok(!h.messages.at(-1).body.text.includes('SINOV'));
});

test('Preview is owner only, clears survey drafts and can inspect closed questionnaires', async () => {
  const h = harness();
  for (const data of ['a:preview', 'a:trypreview:employees', 'a:resetpreview:employees', 'a:exitpreview']) {
    await h.bot.handle({ update_id: 100, callback_query: { id: 'attack', from: { id: 22 }, message: { chat: { id: 22, type: 'private' } }, data } });
  }
  assert.equal([...h.data].filter(([k]) => k.startsWith('preview-')).length, 0);
  await h.message(1, '/newsurvey');
  await h.message(1, '/admin'); await h.press(1, 'Mijoz rejimi');
  assert.equal(await h.storage.get('draft'), null);
  await h.storage.put('open:employees', false);
  await h.press(1, 'Xodim'); await h.press(1, 'Boshlash'); await h.message(1, 'Test respondent'); await h.press(1, 'Yoshni o‘tkazib');
  assert.match(h.messages.at(-1).body.text, /Savol 1[/]57/);
  await h.message(22, '/start employees');
  assert.match(h.messages.at(-1).body.text, /hozir yopiq/);
});


test('Both roles ask name then age separately and export the supplied profile fields', async () => {
  const short = definitions.map(s => ({ ...s, questions: s.questions.slice(0, 1) }));
  const h = harness(short);
  for (const [index, survey] of short.entries()) {
    const user = 70 + index;
    await h.message(user, '/start ' + survey.id); await h.press(user, 'Boshlash');
    assert.match(h.messages.at(-1).body.text, /nom yoki raqam|Korxonangizni hisobotda/);
    await h.message(user, 'Aziza');
    assert.match(h.messages.at(-1).body.text, /Yoshingiz nechada/);
    for (const invalid of ['yigirma', '3.5', '-1', '0', '121', '28 yosh']) {
      await h.message(user, invalid);
      assert.equal(h.sessions().find(s => s.survey === survey.id).stage, 'age');
    }
    await h.message(user, '28');
    assert.match(h.messages.at(-1).body.text, /Savol 1[/]1/);
    if (survey.questions[0].type === 'single') await h.press(user, '1.');
    else await h.message(user, 'Javob');
    await h.press(user, 'Javoblarni yuborish');
  }
  assert.ok(h.sessions().every(s => s.publicIdentity?.value === 'Aziza' && s.age === 28));
  await h.message(1, '/export');
  const csv = await h.messages.findLast(m => m.method === 'sendDocument').body.get('document').text();
  assert.match(csv, /Yosh [(]ixtiyoriy[)]/);
  assert.match(csv, /"Aziza","28","Yakunlangan"/);
});

test('Identity is mandatory, can be changed to a private code, and age remains optional after restart', async () => {
  const h = harness();
  await h.message(88, '/start employees'); await h.press(88, 'Boshlash');
  assert.ok(!h.buttons(88).some(b => b.text.includes('Ismsiz')));
  await h.message(88, 'Ali');
  assert.equal(h.sessions()[0].stage, 'age');
  const restarted = harness(definitions, h.data);
  await restarted.message(88, '/survey');
  assert.match(restarted.messages.at(-1).body.text, /Yoshingiz nechada/);
  await h.press(88, 'Nom yoki raqamga qaytish');
  await h.message(88, '');
  assert.equal(h.sessions()[0].stage, 'name');
  await h.message(88, '789-856-78');
  assert.deepEqual(h.sessions()[0].publicIdentity, { kind: 'code', value: '789-856-78' });
  assert.equal(h.sessions()[0].name, undefined);
  await h.press(88, 'Yoshni o‘tkazib');
  assert.equal(h.sessions()[0].age, undefined);
  assert.match(h.messages.at(-1).body.text, /Savol 1[/]57/);
});

test('Benefits allow four or more selections, show a count, and commit all selected options', async () => {
  const benefits = { ...definitions[0], questions: [{ ...definitions[0].questions[8], id: 1 }] };
  const h = harness([benefits]);
  await h.message(99, '/start employees'); await h.press(99, 'Boshlash'); await h.message(99, 'Test respondent'); await h.press(99, 'Yoshni o‘tkazib');
  for (const n of [1, 2, 3, 4]) await h.press(99, n + '.');
  assert.equal(h.sessions()[0].index, 0);
  assert.equal(h.sessions()[0].pending.length, 4);
  assert.match(h.messages.at(-1).body.text, /Tanlandi: 4 ta/);
  assert.equal(h.buttons(99).filter(b => b.text.startsWith('✅ ')).length, 4);
  assert.ok(h.buttons(99)[0].text.includes('4 ta tanlandi'));
  await h.press(99, '2.');
  assert.equal(h.sessions()[0].pending.length, 3);
  await h.press(99, '2.'); await h.press(99, 'Davom etish'); await h.press(99, 'Javoblarni yuborish');
  assert.equal(h.sessions()[0].answers[1].choices.length, 4);
  assert.equal(surveyStats(benefits, h.sessions()).questions[0].choices.filter(c => c.count === 1).length, 4);
});

test('Script rendering handles Uzbek letters and preserves links, identifiers and amounts', () => {
  assert.equal(toScript('So‘rovnoma. Yo‘l, yo‘q, yozuv, o‘qish, g‘oya, choy, shahar, e’lon.', 'cyrillic'), 'Сўровнома. Йўл, йўқ, ёзув, ўқиш, ғоя, чой, шаҳар, эълон.');
  assert.equal(toScript('Ўзбекистон, Ғоя, Қаҳва, Ёзув, Йўл', 'latin'), 'O‘zbekiston, G‘oya, Qahva, Yozuv, Yo‘l');
  assert.equal(toScript('CSV KPI UZS USD EUR /start /survey https://t.me/Laylo_asistent_bot?start=employees a@example.com @Laylo_asistent_bot', 'cyrillic'), 'CSV KPI UZS USD EUR /start /survey https://t.me/Laylo_asistent_bot?start=employees a@example.com @Laylo_asistent_bot');
  assert.deepEqual(parseAmount('3,5 млн сўм'), { amount: 3500000, currency: 'UZS' });
  assert.deepEqual(parseAmount('7 000 доллар'), { amount: 7000, currency: 'USD' });
});

test('New participants select a script before a deep-linked survey; display choice does not split report options', async () => {
  const mini = { ...definitions[0], questions: [
    { ...definitions[0].questions[8], id: 1 }, { ...definitions[0].questions[5], id: 2 },
    { id: 3, section: 1, type: 'text', text: 'Qo‘shimcha fikringiz?' },
  ] };
  const h = harness([mini], undefined, false);
  for (const [user, script] of [[64, 'Кириллча'], [65, 'Lotincha']]) {
    await h.message(user, '/start employees');
    assert.equal(h.sessions().length, user === 64 ? 0 : 1);
    assert.match(h.messages.at(-1).body.text, /Qaysi yozuv.*Қайси ёзув/s);
    await h.press(user, script);
    assert.ok(h.buttons(user).some(b => b.text.includes(user === 64 ? 'Бошлаш' : 'Boshlash')));
    await h.press(user, user === 64 ? 'Бошлаш' : 'Boshlash');
    await h.message(user, '789-856-' + user);
    await h.press(user, user === 64 ? 'Ёшни ўтказиб' : 'Yoshni o‘tkazib');
    assert.match(h.messages.at(-1).body.text, user === 64 ? /Иш жойингизда/ : /Ish joyingizda/);
    for (const n of [1, 2, 3, 4]) await h.press(user, n + '.');
    await h.press(user, user === 64 ? 'Давом этиш' : 'Davom etish');
    await h.message(user, user === 64 ? '3,5 млн сўм' : '3,5 mln');
    await h.message(user, user === 64 ? 'Асл фикрим' : 'Asl fikrim');
    await h.press(user, user === 64 ? 'Жавобларни юбориш' : 'Javoblarni yuborish');
  }
  assert.deepEqual(h.sessions()[0].answers[1].choices, h.sessions()[1].answers[1].choices);
  assert.equal(h.sessions()[0].answers[2].amount, 3500000);
  assert.equal(h.sessions()[0].answers[3].text, 'Асл фикрим');
  const stats = surveyStats(mini, h.sessions());
  assert.equal(stats.completed, 2);
  assert.equal(stats.questions[0].choices.filter(c => c.count === 2).length, 4);
  await h.message(1, '/export');
  const csv = await h.messages.findLast(m => m.method === 'sendDocument').body.get('document').text();
  assert.match(csv, /Асл фикрим/);
});

test('Switching script mid-question preserves selections, session and stored preference after restart', async () => {
  const mini = { ...definitions[0], questions: [{ ...definitions[0].questions[8], id: 1 }] };
  const h = harness([mini], undefined, false);
  await h.message(66, '/start'); await h.press(66, 'Lotincha'); await h.press(66, 'Xodim');
  await h.press(66, 'Boshlash'); await h.message(66, 'Test respondent'); await h.press(66, 'Yoshni o‘tkazib');
  await h.press(66, '1.'); await h.press(66, '2.');
  const before = structuredClone(h.sessions()[0]);
  await h.press(66, '🔤'); await h.press(66, 'Кириллча');
  assert.match(h.messages.at(-1).body.text, /Танланди: 2 та/);
  assert.deepEqual(h.sessions()[0], before);
  const restarted = harness([mini], h.data, false);
  await restarted.message(66, '/survey');
  assert.match(restarted.messages.at(-1).body.text, /Танланди: 2 та/);
  await h.message(66, '/script'); await h.press(66, 'Lotincha');
  assert.match(h.messages.at(-1).body.text, /Tanlandi: 2 ta/);
  assert.deepEqual(h.sessions()[0], before);
  assert.ok(!h.buttons(66).some(b => b.callback_data.startsWith('a:')));
});


test('Every /start asks for script first, including the owner and returning users', async () => {
  const h = harness(definitions, undefined, false);
  await h.message(44, '/start'); await h.press(44, 'Lotincha'); await h.press(44, 'Xodim');
  await h.press(44, 'Boshlash'); await h.message(44, 'Ali');
  const before = structuredClone(h.sessions()[0]);
  await h.message(44, '/start');
  assert.ok(h.buttons(44).some(b => b.callback_data === 'script:latin'));
  assert.ok(h.buttons(44).some(b => b.callback_data === 'script:cyrillic'));
  assert.ok(!h.buttons(44).some(b => b.callback_data.startsWith('role:')));
  await h.press(44, 'Кириллча'); await h.press(44, 'Ходим');
  assert.match(h.messages.at(-1).body.text, /Ёшингиз нечада/);
  assert.deepEqual(h.sessions()[0], before);
  await h.message(1, '/start');
  assert.ok(!h.buttons(1).some(b => b.callback_data.startsWith('a:')));
  await h.press(1, 'Кириллча');
  assert.ok(h.buttons(1).some(b => b.callback_data === 'a:preview'));
  await h.message(1, '/start');
  assert.ok(h.buttons(1).some(b => b.callback_data === 'script:latin'));
});


test('Configured channel receives one complete response file after submit, not while answering or on duplicate callbacks', async () => {
  const mini = { ...definitions[0], questions: [{ ...definitions[0].questions[8], id: 1 }] };
  const h = harness([mini]);
  await h.message(1, '/reportchannel @reports_test');
  assert.equal((await h.storage.get('report-channel')).id, -100123456);
  await h.message(55, '/start employees'); await h.press(55, 'Boshlash'); await h.message(55, 'Aziza'); await h.message(55, '28');
  await h.press(55, '1.'); await h.press(55, '2.'); await h.press(55, 'Davom etish');
  assert.equal(h.messages.filter(m => m.method === 'sendDocument').length, 0);
  const submitted = await h.press(55, 'Javoblarni yuborish');
  const completedMessage = h.messages.findLast(m => m.body.chat_id === 55 && m.body.text);
  assert.match(completedMessage.body.text, /Hisobotni shu kanalda olasiz/);
  assert.match(completedMessage.body.text, /@reports_test/);
  assert.ok(h.buttons(55).some(b => b.url === 'https://t.me/reports_test'));
  const reports = h.messages.filter(m => m.method === 'sendDocument' && m.body.get('chat_id') === '-100123456');
  assert.equal(reports.length, 1);
  const summary = h.messages.findLast(m => m.method === 'sendMessage' && m.body.chat_id === -100123456 && m.body.text?.includes('Xulosa, baho va tavsiyalar'));
  assert.match(summary.body.text, /Aziza/);
  assert.match(summary.body.text, /Yosh: 28/);
  const csv = await reports[0].body.get('document').text();
  assert.match(csv, /Tushlik bepul beriladi/);
  assert.match(csv, /Yo‘l xarajatlari qoplanadi/);
  assert.ok(!csv.includes('Telegram name never stored'));
  await h.bot.handle(submitted);
  assert.equal(h.messages.filter(m => m.method === 'sendDocument').length, 1);
  assert.equal([...h.data].filter(([key]) => key.startsWith('channel-report:')).length, 0);
  assert.equal(h.sessions()[0].stage, 'done');
});

test('Client preview never sends respondent data to the reports channel', async () => {
  const mini = { ...definitions[0], questions: [{ ...definitions[0].questions[8], id: 1 }] };
  const h = harness([mini]);
  await h.message(1, '/reportchannel @reports_test'); await h.message(1, '/admin');
  await h.press(1, 'Mijoz rejimi'); await h.press(1, 'Xodim'); await h.press(1, 'Boshlash');
  await h.message(1, 'Test respondent'); await h.press(1, 'Yoshni o‘tkazib'); await h.press(1, '1.');
  await h.press(1, 'Davom etish'); await h.press(1, 'Javoblarni yuborish');
  assert.equal(h.messages.filter(m => m.method === 'sendDocument').length, 0);
  assert.ok(!h.messages.at(-1).body.text.includes('@reports_test'));
  assert.equal([...h.data].filter(([key]) => key.startsWith('channel-report:')).length, 0);
});

test('Failed channel delivery remains queued across restarts and retries without losing answers', async () => {
  const mini = { id: 'mini', title: 'Test', sections: ['Savollar'], questions: [{ id: 1, section: 1, type: 'text', text: 'Fikringiz?' }] };
  const h = harness([mini]);
  await h.message(1, '/reportchannel @reports_test');
  const normalCall = h.api.call;
  h.api.call = async (method, body) => { if (method === 'sendDocument') throw new Error('Temporary outage'); return normalCall(method, body); };
  await h.message(57, '/start mini'); await h.press(57, 'Boshlash'); await h.message(57, 'Test respondent'); await h.press(57, 'Yoshni o‘tkazib');
  await h.message(57, 'Saqlanadigan javob'); await h.press(57, 'Javoblarni yuborish');
  assert.equal(h.sessions()[0].stage, 'done');
  assert.equal(h.sessions()[0].answers[1].text, 'Saqlanadigan javob');
  const queue = [...h.data].filter(([key]) => key.startsWith('channel-report:'));
  assert.equal(queue.length, 1); assert.equal(queue[0][1].attempts, 1);
  assert.ok(h.data.get('alarmAt') > Date.now());
  const restarted = harness([mini], h.data);
  await restarted.bot.flushChannelReports(true);
  assert.equal(restarted.messages.filter(m => m.method === 'sendDocument').length, 1);
  assert.equal([...h.data].filter(([key]) => key.startsWith('channel-report:')).length, 0);
  await restarted.bot.flushChannelReports(true);
  assert.equal(restarted.messages.filter(m => m.method === 'sendDocument').length, 1);
});

test('Only owner can configure a channel, both admins are verified and forwarded private channels are supported', async () => {
  const h = harness();
  await h.message(23, '/reportchannel @reports_test');
  await h.bot.handle({ update_id: 300, callback_query: { id: 'attack', from: { id: 23 }, message: { chat: { id: 23, type: 'private' } }, data: 'a:channelsetup' } });
  assert.equal(await h.storage.get('report-channel'), undefined);
  await h.message(1, '/reportchannel'); await h.press(1, 'Kanalni ulash');
  await h.bot.handle({ update_id: 301, message: { from: { id: 1 }, chat: { id: 1, type: 'private' }, forward_origin: { type: 'channel', chat: { id: -100123456, type: 'channel' } }, text: 'Kanal xabari' } });
  const configured = await h.storage.get('report-channel');
  assert.equal(configured.id, -100123456);
  const normalCall = h.api.call;
  h.api.call = async (method, body) => method === 'getChatMember' && body.user_id === 1 ? { status: 'member' } : normalCall(method, body);
  await h.message(1, '/reportchannel @different_channel');
  assert.deepEqual(await h.storage.get('report-channel'), configured);
  assert.match(h.messages.at(-1).body.text, /siz administrator/);
  h.api.call = async (method, body) => method === 'getChatMember' && body.user_id === 999 ? { status: 'administrator', can_post_messages: false } : normalCall(method, body);
  await h.message(1, '/reportchannel @different_channel');
  assert.deepEqual(await h.storage.get('report-channel'), configured);
  assert.match(h.messages.at(-1).body.text, /xabar joylash huquqini/);
});


test('Survey indices distinguish reported conditions, skip unknowns, and do not depend on identity or salary', () => {
  const positive = { answers: Object.fromEntries(definitions[0].questions.filter(q => q.options).map(q => [q.id, { choices: [q.options[0]] }])) };
  const high = buildSurveyInsights(definitions[0], positive);
  assert.equal(high.company.score, 10); assert.equal(high.employee.score, 10);
  const lowValues = { 8: 'Deyarli hech qachon', 15: 'Yo‘q', 16: 'Ikkalasi ham mavjud emas', 23: 'Har kuni', 24: 'To‘lanmaydi', 28: 'Yo‘q', 29: 'Yo‘q', 30: 'Deyarli hech qachon', 31: 'Yo‘q', 32: 'Juda yomon', 33: 'Deyarli hech qachon', 34: 'Deyarli hech qachon', 41: 'Yo‘q' };
  const negative = { answers: Object.fromEntries(Object.entries(lowValues).map(([id, value]) => [id, { choices: [value] }])) };
  negative.answers[43] = { choices: ['Bepul tushlik.'] };
  const low = buildSurveyInsights(definitions[0], negative);
  assert.ok(low.company.score <= 1); assert.ok(low.employee.score <= 1);
  assert.ok(low.company.recommendations.length > 0); assert.ok(low.employee.recommendations.length > 0);
  assert.match(renderSurveyInsights(low), /Korxona uchun tavsiyalar/);
  assert.match(renderSurveyInsights(low), /Xodim uchun tavsiyalar/);
  const blank = buildSurveyInsights(definitions[0], { answers: { 41: { choices: ['Bilmayman'] } } });
  assert.equal(blank.company.score, null); assert.equal(blank.employee.score, null);
  const changedIdentity = structuredClone(positive);
  changedIdentity.name = 'Other name'; changedIdentity.age = 70; changedIdentity.answers[6] = { amount: 1_000_000_000, currency: 'USD' };
  assert.deepEqual(buildSurveyInsights(definitions[0], changedIdentity), high);
});

test('Employer reports do not invent employee satisfaction and include company and staff recommendations', () => {
  const session = { answers: {
    18: { choices: ['Har doim vaqtida'] }, 26: { choices: ['Hech qachon'] },
    27: { choices: ['Qo‘shimcha ishlanmaydi'] }, 34: { choices: ['Ha'] },
  } };
  const insights = buildSurveyInsights(definitions[1], session);
  assert.equal(insights.company.score, 10);
  assert.equal(insights.employee.score, null);
  assert.match(insights.employee.conclusion, /uning o‘z javoblari/);
  assert.ok(insights.company.recommendations.length); assert.ok(insights.employee.recommendations.length);
  assert.equal(buildSurveyInsights({ id: 'custom' }, session), null);
});

test('Cyrillic respondent reports retain their own script through delayed delivery and include separate recommendations', async () => {
  const h = harness(definitions, undefined, false);
  await h.message(1, '/reportchannel @reports_test');
  const normalCall = h.api.call;
  h.api.call = async (method, body) => { if (method === 'sendDocument') throw new Error('Retry'); return normalCall(method, body); };
  await h.message(78, '/start employees'); await h.press(78, 'Кириллча'); await h.press(78, 'Бошлаш');
  await h.message(78, '789-856-78'); await h.press(78, 'Ёшни ўтказиб');
  for (const q of definitions[0].questions) {
    if (q.type === 'single') await h.press(78, '1.');
    else if (q.type === 'multi') {
      for (let n = 0; n < (q.choose ?? 1); n++) await h.press(78, (n + 1) + '.');
      await h.press(78, 'Давом этиш');
    } else await h.message(78, q.type === 'money' ? '3,5 млн сўм' : 'Яхши');
  }
  await h.press(78, 'Жавобларни юбориш');
  const session = h.sessions()[0];
  assert.equal(session.script, 'cyrillic');
  const summary = h.messages.findLast(m => m.method === 'sendMessage' && m.body.chat_id === -100123456 && m.body.text?.includes('Хулоса, баҳо'));
  assert.ok(summary); assert.match(summary.body.text, /Корхона учун тавсиялар/); assert.match(summary.body.text, /Ходим учун тавсиялар/);
  assert.ok(summary.body.text.includes(session.token)); assert.ok(summary.body.text.length <= 4096);
  await h.message(78, '/script'); await h.press(78, 'Lotincha');
  const restarted = harness(definitions, h.data, false);
  await restarted.bot.flushChannelReports(true);
  assert.equal(restarted.messages.filter(m => m.method === 'sendMessage' && m.body.chat_id === -100123456).length, 0);
  const sent = restarted.messages.find(m => m.method === 'sendDocument').body;
  assert.match(sent.get('caption'), /барча савол-жавоблар/iu);
  const csv = await sent.get('document').text();
  assert.match(csv, /Сўровнома/); assert.match(csv, /Тушлик бепул берилади/); assert.match(csv, /Яхши/);
  assert.ok(csv.includes(session.token));
});


test('Private report codes are required and reserved per role; forged skip cannot bypass identity', async () => {
  const h = harness();
  assert.deepEqual(parsePublicIdentity('789-456-85'), { kind: 'code', value: '789-456-85' });
  assert.deepEqual(parsePublicIdentity('KORA GROUP'), { kind: 'name', value: 'KORA GROUP' });
  assert.equal(parsePublicIdentity(''), null); assert.equal(parsePublicIdentity('🙂'), null);
  for (const user of [81, 82]) { await h.message(user, '/start employers'); await h.press(user, 'Boshlash'); }
  const s = h.sessions()[0];
  await h.bot.handle({ update_id: 9000, callback_query: { id: 'old-skip', from: { id: 81 }, message: { chat: { id: 81, type: 'private' } }, data: 's:employers:' + s.token + ':' + s.revision + ':skip' } });
  assert.equal(h.sessions()[0].stage, 'name');
  await h.message(81, '789-456-85');
  await h.message(82, '78945685');
  assert.equal(h.sessions()[1].stage, 'name');
  assert.match(h.messages.at(-1).body.text, /raqam allaqachon band/);
  await h.message(82, '789-456-86');
  assert.equal(h.sessions()[1].stage, 'age');
});

test('Older unfinished anonymous sessions must provide a public name or code while keeping prior answers', async () => {
  const h = harness();
  await h.message(83, '/start employees'); await h.press(83, 'Boshlash'); await h.message(83, 'Ali'); await h.press(83, 'Yoshni o‘tkazib');
  await h.press(83, '1.');
  const [key, session] = [...h.data].find(([key]) => key.startsWith('session:'));
  delete session.publicIdentity; delete session.name;
  await h.storage.put(key, session);
  await h.message(83, '/survey');
  assert.match(h.messages.at(-1).body.text, /nom yoki raqam/);
  await h.message(83, '789-856-83');
  assert.equal(h.sessions()[0].index, 1);
  assert.equal(h.sessions()[0].stage, 'questions');
  assert.equal(h.sessions()[0].answers[1].choices[0], '2 oydan kam');
});

test('Company code is used in channel report and CSV without disclosing Telegram names', async () => {
  const mini = { ...definitions[1], questions: [definitions[1].questions[0]] };
  const h = harness([mini]);
  await h.message(1, '/reportchannel @reports_test');
  await h.message(84, '/start employers'); await h.press(84, 'Boshlash');
  assert.match(h.messages.at(-1).body.text, /Korxona nomini/);
  await h.message(84, '789-456-85'); await h.press(84, 'Yoshni o‘tkazib'); await h.message(84, '2 yil'); await h.press(84, 'Javoblarni yuborish');
  const summary = h.messages.findLast(m => m.body.chat_id === -100123456 && m.body.text?.includes('Xulosa, baho'));
  assert.match(summary.body.text, /789-456-85 raqami hisoboti/);
  assert.ok(!summary.body.text.includes('Telegram name never stored'));
  const csv = await h.messages.findLast(m => m.method === 'sendDocument').body.get('document').text();
  assert.match(csv, /789-456-85/);
  assert.ok(!csv.includes('Telegram name never stored'));
});
