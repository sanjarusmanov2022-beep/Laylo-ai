import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSurveyBot, parseAmount, surveyStats, validateSurvey, toScript } from '../src/surveys.mjs';
import worker, { SurveyStore } from '../src/survey-worker.mjs';

const definitions = await Promise.all(['employees', 'employers'].map(async id => JSON.parse(await readFile(new URL(`../config/surveys/${id}.json`, import.meta.url), 'utf8'))));

function harness(defs = definitions, existing, autoScript = true) {
  const data = existing ?? new Map();
  const messages = [];
  const storage = {
    get: async key => structuredClone(data.get(key)),
    delete: async key => data.delete(key),
    put: async (key, value) => { data.set(key, structuredClone(value)); },
    list: async ({ prefix, limit, startAfter }) => new Map([...data].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter)).slice(0, limit)),
  };
  const api = { call: async (method, body) => {
    messages.push({ method, body: body instanceof FormData ? body : structuredClone(body) });
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
  await h.press(222, 'Ismsiz'); await h.press(222, 'Yoshni o‘tkazib');
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
    await h.press(user, 'Ismsiz'); await h.press(user, 'Yoshni o‘tkazib');
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
  await h.message(22, '/start mini'); await h.press(22, 'Boshlash'); await h.press(22, 'Ismsiz'); await h.press(22, 'Yoshni o‘tkazib');
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
    await h.message(user, '/start mini'); await h.press(user, 'Boshlash'); await h.press(user, 'Ismsiz'); await h.press(user, 'Yoshni o‘tkazib');
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
    await h.press(1, 'Boshlash'); await h.press(1, 'Ismsiz'); await h.press(1, 'Yoshni o‘tkazib');
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
  await h.message(1, '/start employees'); await h.press(1, 'Boshlash'); await h.press(1, 'Ismsiz'); await h.press(1, 'Yoshni o‘tkazib');
  await h.press(1, '2–5 oy');
  const real = structuredClone(h.sessions()[0]);
  await h.message(1, '/admin'); await h.press(1, 'Mijoz rejimi'); await h.press(1, 'Xodim');
  await h.press(1, 'Boshlash'); await h.press(1, 'Ismsiz'); await h.press(1, 'Yoshni o‘tkazib'); await h.press(1, '1.');
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
  await h.press(1, 'Xodim'); await h.press(1, 'Boshlash'); await h.press(1, 'Ismsiz'); await h.press(1, 'Yoshni o‘tkazib');
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
    assert.match(h.messages.at(-1).body.text, /Ismingiz nima/);
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
  assert.ok(h.sessions().every(s => s.name === 'Aziza' && s.age === 28));
  await h.message(1, '/export');
  const csv = await h.messages.findLast(m => m.method === 'sendDocument').body.get('document').text();
  assert.match(csv, /Yosh [(]ixtiyoriy[)]/);
  assert.match(csv, /"Aziza","28","Yakunlangan"/);
});

test('Name and age can be skipped independently and age step survives a restart', async () => {
  const h = harness();
  await h.message(88, '/start employees'); await h.press(88, 'Boshlash');
  await h.message(88, 'Ali');
  assert.equal(h.sessions()[0].stage, 'age');
  const restarted = harness(definitions, h.data);
  await restarted.message(88, '/survey');
  assert.match(restarted.messages.at(-1).body.text, /Yoshingiz nechada/);
  await h.press(88, 'Ismga qaytish');
  assert.match(h.messages.at(-1).body.text, /Ismingiz nima/);
  await h.press(88, 'Ismsiz');
  assert.equal(h.sessions()[0].name, undefined);
  assert.match(h.messages.at(-1).body.text, /Yoshingiz nechada/);
  await h.press(88, 'Yoshni o‘tkazib');
  assert.equal(h.sessions()[0].age, undefined);
  assert.match(h.messages.at(-1).body.text, /Savol 1[/]57/);
});


test('Benefits allow four or more selections, show a count, and commit all selected options', async () => {
  const benefits = { ...definitions[0], questions: [{ ...definitions[0].questions[8], id: 1 }] };
  const h = harness([benefits]);
  await h.message(99, '/start employees'); await h.press(99, 'Boshlash'); await h.press(99, 'Ismsiz'); await h.press(99, 'Yoshni o‘tkazib');
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
    await h.press(user, user === 64 ? 'Исмсиз' : 'Ismsiz');
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
  await h.press(66, 'Boshlash'); await h.press(66, 'Ismsiz'); await h.press(66, 'Yoshni o‘tkazib');
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
