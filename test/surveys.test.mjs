import { createSurveyPdf } from '../src/survey-pdf.mjs';
import { renderChannelReport, reportProfile, reportPercent } from '../src/report-format.mjs';
import { buildSurveyInsights, renderSurveyInsights, buildSituationalInsights, buildDecisionSupport, buildKpiInsights } from '../src/survey-insights.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSurveyBot, parseAmount, surveyStats, validateSurvey, toScript, parsePublicIdentity, splitReportText } from '../src/surveys.mjs';
import worker, { SurveyStore } from '../src/survey-worker.mjs';

const definitions = await Promise.all(['employees', 'employers'].map(async id => JSON.parse(await readFile(new URL(`../config/surveys/${id}.json`, import.meta.url), 'utf8'))));

function harness(defs = definitions, existing, autoScript = true, autoProfile = true) {
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
  const chooseDefaultProfile = async user => {
    if (!autoProfile) return;
    const lastButtons = messages.findLast(m => m.body.chat_id === user)?.body.reply_markup?.inline_keyboard.flat() ?? [];
    const option = lastButtons.find(b => b.callback_data?.endsWith(':workplace_private')) ?? lastButtons.find(b => b.callback_data?.endsWith(':sector_private'));
    if (option) await press(user, option.text);
  };
  const message = async (user, text) => {
    await bot.handle({ update_id: ++updateId, message: { text, from: { id: user, first_name: 'Telegram name never stored' }, chat: { id: user, type: 'private' } } });
    await chooseDefaultScript(user);
    await chooseDefaultProfile(user);
  };
  const buttons = user => messages.findLast(m => m.body.chat_id === user && m.body.reply_markup)?.body.reply_markup.inline_keyboard.flat() ?? [];
  const press = async (user, text) => {
    const button = buttons(user).find(b => b.text === text || b.text.includes(text));
    assert.ok(button, `Button not found: ${text}`);
    const update = { update_id: ++updateId, callback_query: { id: `cb${updateId}`, from: { id: user }, message: { message_id: messages.length, chat: { id: user, type: 'private' } }, data: button.callback_data } };
    await bot.handle(update);
    await chooseDefaultScript(user);
    await chooseDefaultProfile(user);
    return update;
  };
  const sessions = () => [...data].filter(([key]) => key.startsWith('session:')).map(([, session]) => session);
  return { data, storage, messages, api, bot, message, press, buttons, sessions };
}


function pdfText(bytes) {
  return [...Buffer.from(bytes).toString('latin1').matchAll(/<([A-F0-9]+)> Tj/g)].map(m=>m[1].match(/.{4}/g).map(h=>String.fromCharCode(parseInt(h,16))).join('')).join('\n');
}
async function assertPdfAttachment(body) {
  const file=body.get('document'); assert.equal(file.type,'application/pdf'); assert.match(file.name,/\.pdf$/);
  const bytes=new Uint8Array(await file.arrayBuffer()); assert.equal(Buffer.from(bytes.subarray(0,8)).toString(),'%PDF-1.7'); return pdfText(bytes);
}

test('Both role questionnaires validate and keep all supplied employee questions', () => {
  assert.equal(validateSurvey(definitions[0]).questions.length, 84);
  assert.equal(validateSurvey(definitions[1]).questions.length, 67);
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
  assert.match(restarted.messages.at(-1).body.text, /Savol 2\/84/);
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
  assert.equal(csv.trim().split('\r\n').length, 1 + participants / 2 * (definitions[0].questions.length + definitions[1].questions.length));
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
  assert.match(h.messages.at(-1).body.text, /Savol 2[/]84/);
  const restarted = harness(definitions, h.data);
  await restarted.message(1, '/survey');
  assert.match(restarted.messages.at(-1).body.text, /SINOV/);
  assert.match(restarted.messages.at(-1).body.text, /Savol 2[/]84/);
  await h.press(1, 'Boshidan boshlash');
  const preview = [...h.data].find(([key]) => key.startsWith('preview-session:'))[1];
  assert.equal(preview.stage, 'intro'); assert.deepEqual(preview.answers, {});
  assert.deepEqual(h.sessions()[0], real);
  await h.message(1, '/admin'); await h.message(1, '/survey employees');
  assert.match(h.messages.at(-1).body.text, /Savol 2[/]84/);
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
  assert.match(h.messages.at(-1).body.text, /Savol 1[/]84/);
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
  assert.match(h.messages.at(-1).body.text, /Savol 1[/]84/);
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
  const summary = h.messages.findLast(m => m.method === 'sendMessage' && m.body.chat_id === -100123456 && m.body.text?.includes('PDFda'));
  assert.match(summary.body.text, /Aziza/);
  assert.match(summary.body.text, /Yosh: 28/);
  const pdf = await assertPdfAttachment(reports[0].body); assert.match(pdf,/Aziza/);
  await h.message(1,'/export employees');
  const csv = await h.messages.findLast(m=>m.method==='sendDocument').body.get('document').text();
  assert.match(csv, /Tushlik bepul beriladi/);
  assert.match(csv, /Yo‘l xarajatlari qoplanadi/);
  assert.ok(!csv.includes('Telegram name never stored'));
  await h.bot.handle(submitted);
  assert.equal(h.messages.filter(m => m.method === 'sendDocument' && m.body.get('chat_id')==='-100123456').length, 1);
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
  assert.equal(h.messages.filter(m => m.method === 'sendDocument' && m.body.get('chat_id')==='-100123456').length, 0);
  const privatePdf=h.messages.find(m=>m.method==='sendDocument' && m.body.get('chat_id')==='1'); assert.ok(privatePdf); await assertPdfAttachment(privatePdf.body);
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
  const summary = h.messages.findLast(m => m.method === 'sendMessage' && m.body.chat_id === -100123456 && m.body.text?.includes('диаграммалар'));
  assert.ok(summary);
  const parts = h.messages.filter(m => m.method === 'sendMessage' && m.body.chat_id === -100123456);
  const fullReport = parts.map(m => m.body.text).join('\n');
  assert.match(fullReport, /Корхона учун тавсиялар/); assert.match(fullReport, /Ходим учун тавсиялар/);
  assert.ok(summary.body.text.includes(session.token)); assert.ok(parts.every(m => m.body.text.length <= 4096));
  await h.message(78, '/script'); await h.press(78, 'Lotincha');
  const restarted = harness(definitions, h.data, false);
  await restarted.bot.flushChannelReports(true);
  assert.equal(restarted.messages.filter(m => m.method === 'sendMessage' && m.body.chat_id === -100123456).length, 0);
  const sent = restarted.messages.find(m => m.method === 'sendDocument').body;
  assert.match(sent.get('caption'), /диаграммали PDF таҳлил/iu);
  const pdf = await assertPdfAttachment(sent);
  assert.match(pdf, /Ишдаги ёндашув/); assert.match(pdf, /Яхши/);
  assert.ok(pdf.includes(session.token));
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
  const summary = h.messages.findLast(m => m.body.chat_id === -100123456 && m.body.text?.includes('PDFda'));
  assert.match(summary.body.text, /789-456-85 raqami hisoboti/);
  assert.ok(!summary.body.text.includes('Telegram name never stored'));
  const pdf = await assertPdfAttachment(h.messages.findLast(m=>m.method==='sendDocument').body); assert.match(pdf,/789-456-85/);
  await h.message(1,'/export employers');
  const csv = await h.messages.findLast(m => m.method === 'sendDocument').body.get('document').text();
  assert.match(csv, /789-456-85/);
  assert.ok(!csv.includes('Telegram name never stored'));
});


test('Both roles append exactly sixteen scored situations and four proposal questions without renumbering the original questions', () => {
  for (const survey of definitions) {
    const base = survey.id === 'employees' ? 57 : 40;
    assert.equal(survey.questions.length, base + 27);
    assert.equal(survey.questions.filter(q => q.decision).length, 4);
    assert.equal(survey.questions.filter(q => q.kpi).length, 3);
    assert.ok(survey.questions.slice(0, base).every(q => !q.assessment && !q.proposal));
    assert.equal(survey.questions.filter(q => q.assessment).length, 16);
    assert.equal(survey.questions.filter(q => q.proposal).length, 4);
    assert.equal(new Set(survey.questions.filter(q => q.assessment).map(q => q.assessment.dimension)).size, 5);
    assert.equal(validateSurvey(survey), survey);
  }
  const invalid = structuredClone(definitions[0]);
  invalid.questions[57].assessment.scale[0].score = 20;
  assert.throws(() => validateSurvey(invalid), /mezonlari/);
});

function situationSession(survey, mode) {
  return { answers: Object.fromEntries(survey.questions.filter(q => q.assessment).map(q => {
    const scales = q.assessment.scale;
    const numeric = scales.map((v, i) => [v.score, i]).filter(([v]) => v !== null);
    const selected = mode === 'unknown' ? scales.findIndex(v => v.score === null) : numeric.sort((a, b) => mode === 'high' ? b[0] - a[0] : a[0] - b[0])[0][1];
    return [q.id, { choices: [q.options[selected]] }];
  })) };
}

test('Situational profiles use actual options, require coverage and generate different grounded recommendations', () => {
  for (const survey of definitions) {
    const high = buildSituationalInsights(survey, situationSession(survey, 'high'));
    const low = buildSituationalInsights(survey, situationSession(survey, 'low'));
    const unknown = buildSituationalInsights(survey, situationSession(survey, 'unknown'));
    assert.equal(high.score, 10); assert.ok(low.score < 4);
    assert.equal(high.dimensions.length, 5);
    assert.ok(high.dimensions.every(d => d.score === 10));
    assert.equal(unknown.score, null); assert.equal(unknown.measured, 0);
    assert.notDeepEqual(high.companyRecommendations, low.companyRecommendations);
    assert.notDeepEqual(high.employeeRecommendations, low.employeeRecommendations);
    assert.ok(low.observations.every(o => survey.questions[o.id - 1].options.includes(o.selected)));
  }
  const payment = definitions[0].questions[57];
  assert.equal(payment.assessment.scale[payment.options.indexOf('Moliyaviy holatimni aytib, to‘lov va ishni davom ettirish shartlarini ochiq kelishaman.')].score, 10);
});

test('Respondent proposals appear as their own words, retain full raw answers and personalize otherwise identical reports', () => {
  const survey = definitions[0];
  const firstSession = situationSession(survey, 'high');
  const secondSession = structuredClone(firstSession);
  const q = survey.questions.find(q => q.proposal === 'company');
  firstSession.answers[q.id] = { text: 'Tushlik uchun qulay joy tashkil qilishni taklif qilaman.' };
  secondSession.answers[q.id] = { text: 'Oyda bir marta rivojlanish bo‘yicha suhbat bo‘lishini istayman.' };
  const a = buildSurveyInsights(survey, firstSession);
  const b = buildSurveyInsights(survey, secondSession);
  assert.notEqual(renderSurveyInsights(a), renderSurveyInsights(b));
  assert.match(renderSurveyInsights(a), /Tushlik uchun qulay joy/);
  assert.match(renderSurveyInsights(b), /rivojlanish bo‘yicha suhbat/);
  assert.equal(firstSession.answers[q.id].text, 'Tushlik uchun qulay joy tashkil qilishni taklif qilaman.');
});

test('Old review screens continue into added questions and old completed responses do not count newly added questions as skipped', async () => {
  const h = harness();
  await h.message(90, '/start employees'); await h.press(90, 'Boshlash'); await h.message(90, '789-856-90'); await h.press(90, 'Yoshni o‘tkazib');
  const [key, session] = [...h.data].find(([key]) => key.startsWith('session:'));
  session.stage = 'review'; session.index = 57; session.questionCount = 57;
  session.answers = { 1: { choices: ['2–5 oy'] } };
  await h.storage.put(key, session);
  await h.bot.handle({ update_id: 10000, callback_query: { id: 'old-submit', from: { id: 90 }, message: { chat: { id: 90, type: 'private' } }, data: 's:employees:' + session.token + ':' + session.revision + ':submit' } });
  assert.equal(h.sessions()[0].stage, 'questions');
  assert.match(h.messages.at(-1).body.text, /Savol 58[/]84/);
  assert.equal(h.sessions()[0].answers[1].choices[0], '2–5 oy');
  const oldDone = { ...session, stage: 'done', completedAt: '2026-11-24T00:00:00Z' };
  delete oldDone.questionCount;
  await h.storage.put(key, oldDone);
  const stats = surveyStats(definitions[0], h.sessions());
  assert.equal(stats.questions[57].skipped, 0);
  await h.message(1, '/export employees');
  const csv = await h.messages.findLast(m => m.method === 'sendDocument').body.get('document').text();
  assert.equal(csv.trim().split('\r\n').length, 58);
});

test('Long Unicode reports split without losing text or breaking surrogate pairs', () => {
  const text = ('Rahbar 👩‍💼 va xodim 🙂\n').repeat(700) + 'yakun';
  const parts = splitReportText(text);
  assert.ok(parts.length > 1); assert.equal(parts.join(''), text);
  assert.ok(parts.every(p => p.length <= 3500));
  assert.ok(parts.every(p => !/[\uD800-\uDBFF]$/.test(p)));
});

test('Delivery resumes after a later report fragment fails and does not repeat already delivered fragments', async () => {
  const h = harness();
  await h.message(1, '/reportchannel @reports_test');
  const session = { survey: 'employees', token: 'abcdef1234', publicIdentity: { kind: 'code', value: '789-856-91' }, stage: 'done', script: 'latin', answers: {}, completedAt: '2026-11-24T12:00:00Z', questionCount: 81 };
  const insights = buildSurveyInsights(definitions[0], session);
  insights.company.conclusion = 'Birinchi qism. '.repeat(500);
  insights.employee.conclusion = 'Ikkinchi qism. '.repeat(300);
  await h.storage.put('channel-report:employees:abcdef1234', { survey: definitions[0], session, insights, summaryChunks:splitReportText(renderSurveyInsights(insights)),summaryMessageIds:[], attempts: 0, nextAttemptAt: 0 });
  const normalCall = h.api.call;
  let count = 0;
  h.api.call = async (method, body) => { if (method === 'sendMessage' && body.chat_id === -100123456 && ++count === 2) throw new Error('Temporary fragment failure'); return normalCall(method, body); };
  await h.bot.flushChannelReports();
  const pending = await h.storage.get('channel-report:employees:abcdef1234');
  assert.equal(pending.summaryMessageIds.length, 1);
  assert.ok(pending.summaryChunks.length > 2);
  const firstPart = pending.summaryChunks[0];
  const restarted = harness(definitions, h.data);
  await restarted.bot.flushChannelReports(true);
  assert.ok(!restarted.messages.some(m => m.method === 'sendMessage' && m.body.text === firstPart));
  assert.ok(restarted.messages.filter(m => m.method === 'sendMessage' && m.body.chat_id === -100123456).every(m => m.body.text.length <= 3500));
  assert.equal(await h.storage.get('channel-report:employees:abcdef1234'), undefined);
  assert.equal(restarted.messages.filter(m => m.method === 'sendDocument').length, 1);
});


test('Equal overall situational scores can produce different dimension findings and recommendations', () => {
  const survey = definitions[0];
  const a = situationSession(survey, 'high');
  const b = situationSession(survey, 'high');
  for (const [session, dimension] of [[a, 'communication'], [b, 'learning']]) {
    const qs = survey.questions.filter(q => q.assessment?.dimension === dimension && q.assessment.scale.some(v => v.score === 1)).slice(0, 2);
    assert.equal(qs.length, 2);
    for (const q of qs) session.answers[q.id] = { choices: [q.options[q.assessment.scale.findIndex(v => v.score === 1)]] };
  }
  const pa = buildSituationalInsights(survey, a);
  const pb = buildSituationalInsights(survey, b);
  assert.equal(pa.score, pb.score);
  assert.notEqual(pa.conclusion, pb.conclusion);
  assert.notDeepEqual(pa.employeeRecommendations, pb.employeeRecommendations);
});


function withDecision(survey, session, key, value) {
  const q = survey.questions.find(q => q.decision === key);
  assert.ok(q, key);
  session.answers[q.id] = { choices: Array.isArray(value) ? value : [value] };
  return session;
}

test('Explicit dissatisfaction is preserved even when other workplace answers are positive', () => {
  const survey = definitions[0];
  const session = { answers: Object.fromEntries(survey.questions.filter(q => q.options).map(q => [q.id, { choices: [q.options[0]] }])) };
  withDecision(survey, session, 'satisfaction', 'Juda noroziman');
  const insights = buildSurveyInsights(survey, session);
  assert.equal(insights.company.score, 10);
  assert.equal(insights.satisfaction.score, 0);
  assert.match(insights.employee.conclusion, /noroziligingizni alohida muhokama/);
  assert.ok(!insights.decisionSupport.title.includes('qolib rivojlanish'));
  assert.match(renderSurveyInsights(insights), /Juda noroziman/);
});

test('Career guidance differentiates unresolved problems, positive work, underused skills and development needs without unsupported market claims', () => {
  const survey = definitions[0];
  const good = { answers: Object.fromEntries(survey.questions.filter(q => q.options).map(q => [q.id, { choices: [q.options[0]] }])) };
  withDecision(survey, good, 'satisfaction', 'Juda qoniqaman');
  withDecision(survey, good, 'skill_use', 'Asosan foydalanaman');
  assert.match(buildDecisionSupport(survey, good, 10).title, /qolib rivojlanish/);
  const poor = structuredClone(good);
  poor.answers[8] = { choices: ['Deyarli hech qachon'] }; poor.answers[31] = { choices: ['Yo‘q'] };
  withDecision(survey, poor, 'satisfaction', 'Juda noroziman');
  withDecision(survey, poor, 'resolution', 'Bir necha marta muhokama qilingan, sezilarli o‘zgarish bo‘lmadi');
  withDecision(survey, poor, 'alternatives', 'Hali boshqa variant qidirmadim');
  const comparison = buildDecisionSupport(survey, poor, 2);
  assert.match(comparison.title, /Boshqa ish variantlarini jiddiy solishtirish/);
  assert.ok(comparison.steps.some(step => step.includes('yozma taklif yo‘q')));
  const underused = structuredClone(good);
  withDecision(survey, underused, 'skill_use', 'Juda kam foydalanaman');
  withDecision(survey, underused, 'satisfaction', 'Hislarim aralash / o‘rtacha');
  assert.match(buildDecisionSupport(survey, underused, 7).title, /Ko‘nikmaga mos vazifa/);
  withDecision(survey, underused, 'skill_use', 'Ko‘nikmalarim hozirgi vazifaga hali yetmaydi');
  assert.match(buildDecisionSupport(survey, underused, 7).title, /ko‘nikmani rivojlantirish/);
});

test('KPI proposals match selected work outcomes and address influence, budget and review rules', () => {
  const survey = definitions[1]; const session = { answers: {} };
  withDecision(survey, session, 'kpi_target', ['Ishni muddatida bajarish','Xatolarni kamaytirish va aniqlik']);
  withDecision(survey, session, 'kpi_control', 'Asosan tashqi omillarga bog‘liq');
  withDecision(survey, session, 'bonus_budget', 'Hali byudjet belgilanmagan');
  withDecision(survey, session, 'kpi_fairness', 'Hali bunday tartib yo‘q');
  const support = buildDecisionSupport(survey, session, 7);
  assert.equal(support.steps.length, 5);
  assert.ok(support.steps.some(s => s.includes('Muddat uchun')));
  assert.ok(support.steps.some(s => s.includes('Aniqlik uchun')));
  assert.ok(support.steps.some(s => s.includes('xodim o‘zi boshqara oladigan')));
  assert.ok(support.steps.some(s => s.includes('byudjet')));
  assert.ok(support.steps.some(s => s.includes('qayta tekshirish')));
});


test('Paused respondents get a working resume button and their text is not silently consumed', async () => {
  const mini = { id: 'mini', title: 'Test', sections: ['Savollar'], questions: [{ id: 1, section: 1, text: 'Fikringiz?', type: 'text' }] };
  const h = harness([mini]);
  await h.message(94, '/start mini'); await h.press(94, 'Boshlash'); await h.message(94, '789-856-94'); await h.press(94, 'Yoshni o‘tkazib');
  await h.press(94, 'Keyinroq');
  await h.message(94, 'Davom etmoqchiman');
  assert.equal(h.sessions()[0].paused, true); assert.equal(h.sessions()[0].index, 0);
  await h.press(94, 'Davom ettirish');
  assert.equal(h.sessions()[0].paused, false);
  await h.message(94, 'Haqiqiy javob');
  assert.equal(h.sessions()[0].answers[1].text, 'Haqiqiy javob');
});

test('A pending script selection cannot accidentally consume a survey answer', async () => {
  const mini = { id: 'mini', title: 'Test', sections: ['Savollar'], questions: [{ id: 1, section: 1, text: 'Fikringiz?', type: 'text' }] };
  const h = harness([mini], undefined, false);
  await h.message(95, '/start mini'); await h.press(95, 'Lotincha'); await h.press(95, 'Boshlash'); await h.message(95, '789-856-95'); await h.press(95, 'Yoshni o‘tkazib');
  await h.press(95, '🔤'); await h.message(95, 'hali tanlamadim');
  assert.equal(h.sessions()[0].index, 0);
  assert.equal(h.sessions()[0].answers[1], undefined);
  await h.press(95, 'Кириллча');
  assert.match(h.messages.at(-1).body.text, /Фикрингиз/);
});

test('No overtime is not penalized for an unused overtime payment policy', () => {
  const employee = { answers: { 8: { choices: ['Har doim'] }, 15: { choices: ['Ha'] }, 23: { choices: ['Hech qachon'] }, 24: { choices: ['To‘lanmaydi'] } } };
  assert.equal(buildSurveyInsights(definitions[0], employee).company.score, 10);
  const employer = { answers: { 18: { choices: ['Har doim vaqtida'] }, 26: { choices: ['Hech qachon'] }, 27: { choices: ['Alohida qoplanmaydi'] }, 34: { choices: ['Ha'] } } };
  assert.equal(buildSurveyInsights(definitions[1], employer).company.score, 10);
});

test('Changing the reports channel restarts partial delivery in the new destination', async () => {
  const h = harness();
  await h.storage.put('report-channel', { id: -100222222, title: 'New reports', username: 'new_reports' });
  const session = { survey: 'employees', token: 'abcde12345', publicIdentity: { kind: 'code', value: '789-856-96' }, stage: 'done', script: 'latin', answers: {}, completedAt: '2026-11-24T12:00:00Z' };
  await h.storage.put('channel-report:employees:abcde12345', { survey: definitions[0], session, insights: buildSurveyInsights(definitions[0], session), deliveryChatId: -100111111, summaryChunks: ['First report part','Second report part'], summaryMessageIds: [77], summaryMessageId: 77, attempts: 1, nextAttemptAt: 0 });
  await h.bot.flushChannelReports(true);
  const sent = h.messages.filter(m => m.method === 'sendMessage' && m.body.chat_id === -100222222);
  assert.equal(sent.length,1); assert.match(sent[0].body.text,/@new_reports/); assert.ok(!sent[0].body.text.includes('First report part'));
  assert.equal(sent[0].body.parse_mode,'HTML');
});


test('Proposal excerpts keep emoji characters valid in both scripts', () => {
  const survey = definitions[0]; const q = survey.questions.find(q => q.proposal === 'company');
  const session = { answers: { [q.id]: { text: '🙂'.repeat(150) } } };
  const insights = buildSurveyInsights(survey, session);
  assert.ok(insights.ideas[0].text.isWellFormed());
  assert.equal(session.answers[q.id].text, '🙂'.repeat(150));
  for (const script of ['latin', 'cyrillic']) assert.ok(toScript(renderSurveyInsights(insights), script).isWellFormed());
});

test('A due report after several pages of future retries is delivered without draining future jobs', async () => {
  const h = harness();
  await h.storage.put('report-channel', { id: -100123456, title: 'Reports' });
  const future = Date.now() + 3_600_000;
  for (let i = 0; i < 250; i++) await h.storage.put('channel-report:future:' + String(i).padStart(5,'0'), { nextAttemptAt: future });
  const mini = { id: 'mini', title: 'Test', sections: ['Savollar'], questions: [{ id: 1, section: 1, type: 'text', text: 'Fikringiz?' }] };
  const session = { survey: 'mini', token: 'abcde12346', publicIdentity: { kind: 'code', value: '789-856-97' }, stage: 'done', script: 'latin', answers: { 1: { text: 'Javob' } }, completedAt: '2026-11-24T12:00:00Z' };
  await h.storage.put('channel-report:zz:due', { survey: mini, session, nextAttemptAt: 0 });
  await h.bot.flushChannelReports();
  assert.equal(h.messages.filter(m => m.method === 'sendDocument').length, 1);
  assert.equal(await h.storage.get('channel-report:zz:due'), undefined);
  assert.equal([...h.data].filter(([key]) => key.startsWith('channel-report:')).length, 250);
  assert.ok(h.data.get('alarmAt') >= future);
});


test('An old owner preview resume button always returns to preview, even after opening admin', async () => {
  const mini = { ...definitions[0], questions: [{ ...definitions[0].questions[8], id: 1 }] };
  const h = harness([mini]);
  await h.message(1, '/admin'); await h.press(1, 'Mijoz rejimi'); await h.press(1, 'Xodim'); await h.press(1, 'Boshlash');
  await h.message(1, '789-856-98'); await h.press(1, 'Yoshni o‘tkazib'); await h.press(1, 'Keyinroq');
  const resume = h.buttons(1).find(b => b.text.includes('Davom ettirish'));
  assert.equal(resume.callback_data, 'a:resumepreview:employees');
  await h.message(1, '/admin');
  await h.bot.handle({ update_id: 5000, callback_query: { id: 'old-preview-resume', from: { id: 1 }, message: { chat: { id: 1, type: 'private' } }, data: resume.callback_data } });
  assert.match(h.messages.at(-1).body.text, /SINOV/);
  assert.equal(h.sessions().length, 0);
  assert.equal([...h.data].filter(([key]) => key.startsWith('preview-session:')).length, 1);
});


test('Employee workplace name is separate from personal code and sector appears in channel report and CSV', async () => {
  const mini = { ...definitions[0], questions: [{ id: 1, section: 1, type: 'text', text: 'Lavozimingiz?' }] };
  const h = harness([mini], undefined, true, false);
  await h.message(1, '/reportchannel @reports_test');
  await h.message(101, '/start employees'); await h.press(101, 'Boshlash'); await h.message(101, '789-856-101'); await h.press(101, 'Yoshni o‘tkazib');
  assert.equal(h.sessions()[0].stage, 'workplace');
  await h.message(101, 'Namuna tashkilot');
  assert.equal(h.sessions()[0].stage, 'sector');
  await h.press(101, 'Davlat tashkiloti');
  assert.equal(h.sessions()[0].publicIdentity.value, '789-856-101');
  assert.deepEqual(h.sessions()[0].workplace, { visibility: 'named', name: 'Namuna tashkilot' });
  assert.equal(h.sessions()[0].sector, 'public');
  await h.message(101, 'Mutaxassis'); await h.press(101, 'Javoblarni yuborish');
  const report = h.messages.filter(m => m.method === 'sendMessage' && m.body.chat_id === -100123456).map(m => m.body.text).join('\n');
  assert.match(report, /Ishxona: Namuna tashkilot/); assert.match(report, /Sektor: Davlat tashkiloti/);
  const pdf=await assertPdfAttachment(h.messages.findLast(m=>m.method==='sendDocument').body); assert.ok(!pdf.includes('MAXFIY_ISHXONA_102'));
  await h.message(1,'/export employees');
  const csv = await h.messages.findLast(m => m.method === 'sendDocument').body.get('document').text();
  assert.match(csv, /Namuna tashkilot/); assert.match(csv, /Davlat tashkiloti/);
});

test('Choosing private after typing workplace removes its name from channel reports and CSV', async () => {
  const mini = { ...definitions[0], questions: [{ id: 1, section: 1, type: 'text', text: 'Lavozimingiz?' }] };
  const h = harness([mini], undefined, true, false);
  await h.message(1, '/reportchannel @reports_test');
  await h.message(102, '/start employees'); await h.press(102, 'Boshlash'); await h.message(102, '789-856-102'); await h.press(102, 'Yoshni o‘tkazib');
  await h.message(102, 'MAXFIY_ISHXONA_102'); await h.press(102, 'Ishxona nomiga qaytish'); await h.press(102, 'Ishxonam nomi sir qolsin'); await h.press(102, 'Ko‘rsatishni istamayman');
  assert.deepEqual(h.sessions()[0].workplace, { visibility: 'private' });
  assert.equal(h.sessions()[0].sector, 'undisclosed');
  await h.message(102, 'Mutaxassis'); await h.press(102, 'Javoblarni yuborish');
  const report = h.messages.filter(m => m.method === 'sendMessage' && m.body.chat_id === -100123456).map(m => m.body.text).join('\n');
  assert.ok(!report.includes('MAXFIY_ISHXONA_102')); assert.match(report, /Ishxona: Sir saqlangan/);
  const pdf=await assertPdfAttachment(h.messages.findLast(m=>m.method==='sendDocument').body); assert.ok(!pdf.includes('MAXFIY_ISHXONA_102'));
  await h.message(1,'/export employees');
  const csv = await h.messages.findLast(m => m.method === 'sendDocument').body.get('document').text();
  assert.ok(!csv.includes('MAXFIY_ISHXONA_102')); assert.match(csv, /Sir saqlangan/);
});

test('Every sector option works for both roles without asking employers for the company name twice', async () => {
  for (const role of ['employees','employers']) for (const sector of ['public','private','mixed','nonprofit','other','undisclosed']) {
    const survey = definitions.find(s => s.id === role);
    const h = harness([{ ...survey, questions: [survey.questions[0]] }], undefined, true, false);
    await h.message(103, '/start ' + role); await h.press(103, 'Boshlash'); await h.message(103, '789-856-103'); await h.press(103, 'Yoshni o‘tkazib');
    if (role === 'employees') await h.press(103, 'Ishxonam nomi sir qolsin');
    assert.equal(h.sessions()[0].stage, 'sector');
    const option = h.buttons(103).find(b => b.callback_data.endsWith(':sector_' + sector));
    await h.press(103, option.text);
    assert.equal(h.sessions()[0].stage, 'questions'); assert.equal(h.sessions()[0].sector, sector);
  }
});

test('Workplace and sector resume in Cyrillic after restart without losing the entered name', async () => {
  const h = harness(definitions, undefined, false, false);
  await h.message(104, '/start employees'); await h.press(104, 'Кириллча'); await h.press(104, 'Бошлаш'); await h.message(104, '789-856-104'); await h.press(104, 'Ёшни ўтказиб');
  assert.match(h.messages.at(-1).body.text, /Қайси корхона/);
  await h.message(104, 'Мактаб намуна');
  const restarted = harness(definitions, h.data, false, false);
  await restarted.message(104, '/survey');
  assert.match(restarted.messages.at(-1).body.text, /қайси секторга/);
  assert.equal(restarted.sessions()[0].workplace.name, 'Мактаб намуна');
  await h.press(104, 'Давлат ташкилоти');
  assert.equal(h.sessions()[0].sector, 'public');
  assert.match(h.messages.at(-1).body.text, /Савол 1[/]84/);
});

test('Older in-progress responses add workplace and sector then return to their existing question', async () => {
  const h = harness(definitions, undefined, true, false);
  await h.message(105, '/start employees'); await h.press(105, 'Boshlash'); await h.message(105, '789-856-105'); await h.press(105, 'Yoshni o‘tkazib');
  await h.press(105, 'Ishxonam nomi sir qolsin'); await h.press(105, 'Xususiy sektor'); await h.press(105, '1.');
  const [key, session] = [...h.data].find(([key]) => key.startsWith('session:'));
  delete session.workplace; delete session.sector;
  await h.storage.put(key, session);
  await h.message(105, '/survey'); assert.equal(h.sessions()[0].stage, 'workplace');
  await h.press(105, 'Ishxonam nomi sir qolsin'); await h.press(105, 'Xususiy sektor');
  assert.equal(h.sessions()[0].index, 1); assert.equal(h.sessions()[0].stage, 'questions');
  assert.equal(h.sessions()[0].answers[1].choices[0], '2 oydan kam');
});

test('Company disclosure and sector never alter employee or company scores', () => {
  const session = situationSession(definitions[0], 'high');
  const base = buildSurveyInsights(definitions[0], session);
  session.workplace = { visibility: 'named', name: 'Different workplace' }; session.sector = 'public';
  assert.deepEqual(buildSurveyInsights(definitions[0], session), base);
  session.workplace = { visibility: 'private' }; session.sector = 'private';
  assert.deepEqual(buildSurveyInsights(definitions[0], session), base);
});

function withKpi(survey, session, key, value) {
  const q = survey.questions.find(q => q.kpi === key);
  assert.ok(q, key);
  session.answers[q.id] = q.type === 'text' ? { text: value } : { choices: Array.isArray(value) ? value : [value] };
  return session;
}

test('KPI reports distinguish current employer practice from future targets and retain concrete calculation examples', () => {
  const survey = definitions[1]; const session = { answers: {} };
  withKpi(survey, session, 'current_types', ['Yig‘ilgan real tushum', 'Bajarilgan ish hajmi']);
  withKpi(survey, session, 'current_basis', ['Asosan rahbar xohlagan raqam olinadi']);
  withKpi(survey, session, 'current_example', 'Operator → tasdiqlangan ishlar → 80 → oy → CRM → shartli bonus 5%');
  withDecision(survey, session, 'kpi_target', ['Xatolarni kamaytirish va aniqlik']);
  const insights = buildSurveyInsights(survey, session);
  const text = renderSurveyInsights(insights);
  assert.match(text, /Amalda qo‘llanayotgan KPI turlari: Yig‘ilgan real tushum; Bajarilgan ish hajmi/);
  assert.match(text, /Operator → tasdiqlangan ishlar → 80 → oy → CRM → shartli bonus 5%/);
  assert.ok(insights.kpi.recommendations.some(t => t.includes('har bir lavozim')));
  assert.ok(insights.kpi.recommendations.some(t => t.includes('sifat')));
  assert.ok(insights.decisionSupport.steps.some(t => t.includes('Aniqlik uchun')));
  assert.equal(insights.method, 'laylo-survey-indicators-v4');
  const absent = { answers: {} };
  withKpi(survey, absent, 'current_types', 'KPI hali joriy etilmagan');
  withKpi(survey, absent, 'current_example', 'Hali yo‘q');
  const result = buildKpiInsights(survey, absent);
  assert.ok(result.recommendations.some(t => t.includes('kichik KPI sinovini')));
  assert.ok(!result.recommendations.some(t => t.includes('Yozgan misolingiz')));
  assert.equal(buildKpiInsights(survey, { answers: {} }), null);
});

test('Employee preferred KPI outcomes and conditions personalize advice without changing either score', () => {
  const survey = definitions[0]; const session = situationSession(survey, 'high');
  const before = buildSurveyInsights(survey, session);
  withKpi(survey, session, 'employee_current', 'KPI yoki natijaviy bonus yo‘q');
  withKpi(survey, session, 'preferred_metrics', ['Ishni muddatida bajarish','Xizmat sifati va mijoz qoniqishi','Bajarilgan ish hajmi','Yig‘ilgan real tushum']);
  withKpi(survey, session, 'preferred_conditions', ['Bonus kelishilgan vaqtda to‘lanishi','Natijaga o‘zim ta’sir qila olishim','Natija soni bilan birga sifati ham baholanishi']);
  const after = buildSurveyInsights(survey, session);
  assert.equal(before.company.score, after.company.score);
  assert.equal(before.employee.score, after.employee.score);
  assert.equal(before.situational.score, after.situational.score);
  assert.equal(after.kpi.records.find(r => r.key === 'preferred_metrics').choices.length, 4);
  assert.ok(after.kpi.recommendations.some(t => t.includes('to‘lash sanasini')));
  assert.ok(after.kpi.recommendations.some(t => t.includes('Sifat mezoni')));
  assert.ok(after.kpi.recommendations.some(t => t.includes('hozircha amaldagi KPI')));
  const cyrillic = toScript(renderSurveyInsights(after), 'cyrillic');
  assert.match(cyrillic, /KPI: амалдаги ҳолат/);
  assert.match(cyrillic, /Ишни муддатида бажариш/);
});

test('Exclusive KPI answers toggle safely, normal metrics allow four choices, and contradictory stored selections cannot submit', async () => {
  const qs = definitions[1].questions.filter(q => ['current_types','current_basis'].includes(q.kpi));
  const mini = { id: 'mini', title: 'KPI', sections: ['Savollar'], questions: qs.map((q,i) => ({ ...q, id: i+1, section: 1 })) };
  const h = harness([mini]);
  await h.message(220, '/start mini'); await h.press(220, 'Boshlash'); await h.message(220, 'KPI sinov'); await h.press(220, 'Yoshni o‘tkazib');
  for (const n of [1,2,3,4]) await h.press(220, n + '.');
  assert.equal(h.sessions()[0].pending.length, 4);
  await h.press(220, 'KPI hali joriy etilmagan');
  assert.deepEqual(h.sessions()[0].pending, ['KPI hali joriy etilmagan']);
  await h.press(220, '1.');
  assert.deepEqual(h.sessions()[0].pending, [qs[0].options[0]]);
  const [key, s] = [...h.data].find(([k]) => k.startsWith('session:'));
  s.pending = [qs[0].options[0], 'KPI hali joriy etilmagan']; await h.storage.put(key, s);
  await h.press(220, 'Davom etish'); assert.equal(h.sessions()[0].index, 0);
  assert.match(h.messages.at(-1).body.text, /zid variantlar/);
  await h.press(220, 'KPI hali joriy etilmagan');
  for (const n of [2,3,4]) await h.press(220, n + '.');
  await h.press(220, 'Davom etish');
  assert.equal(h.sessions()[0].answers[1].choices.length, 4);
  await h.press(220, '1.'); await h.press(220, 'Hali KPI belgilash tartibi yo‘q');
  await h.press(220, 'Davom etish');
  assert.deepEqual(h.sessions()[0].answers[2].choices, ['Hali KPI belgilash tartibi yo‘q']);
  const bad = structuredClone(mini); bad.questions[0].exclusiveOptions = ['Not an option'];
  assert.throws(() => validateSurvey(bad), /Alohida/);
  bad.questions[0].exclusiveOptions = [bad.questions[0].options[0]]; bad.questions[0].kpi = 'unknown';
  assert.throws(() => validateSurvey(bad), /KPI/);
});

test('Previous 81 and 64 question review screens continue through appended KPI questions while completed exports stay historical', async () => {
  for (const [i, survey] of definitions.entries()) {
    const oldCount = survey.questions.length - 3; const user = 230 + i;
    const h = harness();
    await h.message(user, '/start ' + survey.id); await h.press(user, 'Boshlash'); await h.message(user, 'KPI tarixiy'); await h.press(user, 'Yoshni o‘tkazib');
    const [key, s] = [...h.data].find(([k]) => k.startsWith('session:'));
    s.stage = 'review'; s.index = oldCount; s.questionCount = oldCount;
    s.answers = { 1: { text: 'Oldingi javob' } }; await h.storage.put(key, s);
    await h.bot.handle({ update_id: 20000, callback_query: { id: 'old-kpi-review', from: { id: user }, message: { chat: { id: user, type: 'private' } }, data: 's:' + survey.id + ':' + s.token + ':' + s.revision + ':submit' } });
    assert.equal(h.sessions()[0].stage, 'questions'); assert.equal(h.sessions()[0].index, oldCount);
    assert.equal(h.sessions()[0].answers[1].text, 'Oldingi javob');
    const historical = { ...s, stage: 'done', completedAt: '2026-11-24T12:00:00Z' }; await h.storage.put(key, historical);
    assert.equal(surveyStats(survey, h.sessions()).questions[oldCount].skipped, 0);
    await h.message(1, '/export ' + survey.id);
    const csv = await h.messages.findLast(m => m.method === 'sendDocument').body.get('document').text();
    assert.equal(csv.trim().split('\r\n').length, oldCount + 1);
  }
});

function reportModelForTest(survey=definitions[0], session={answers:{}}) {
  return {survey,session:{token:'abcdef1234',stage:'done',script:'latin',questionCount:survey.questions.length,...session},insights:buildSurveyInsights(survey,session),identity:'789-856-77',workplace:'Sir saqlangan',sector:'Xususiy sektor',date:'24/11/2026, 20:01',channel:{username:'reports_test'},questionCount:session.questionCount??survey.questions.length};
}
test('Report status describes response patterns, handles missing evidence and never turns unknown into zero',()=>{
  const high=buildSurveyInsights(definitions[0],situationSession(definitions[0],'high'));
  assert.equal(reportProfile(high).key,'leadership');
  const steady=structuredClone(high);steady.situational.score=6.5;assert.equal(reportProfile(steady).key,'steady');
  steady.situational.score=8;assert.equal(reportProfile(steady).key,'strong');
  steady.situational.score=3;assert.equal(reportProfile(steady).key,'develop');
  assert.equal(reportProfile(buildSurveyInsights(definitions[0],{answers:{}})).key,'unknown');
  assert.equal(reportPercent(null),null);assert.equal(reportPercent(NaN),null);assert.equal(reportPercent(0),0);assert.equal(reportPercent(9.4),94);
});
test('Channel report escapes public inputs, stays compact, distinguishes satisfaction, and contains subscription link',()=>{
  const session=situationSession(definitions[0],'high');withDecision(definitions[0],session,'satisfaction','Hislarim aralash / o‘rtacha');
  const model=reportModelForTest(definitions[0],session);model.identity='Ali <b>test</b> & Co';model.workplace='Ishxona <a href="x">';
  const html=renderChannelReport(model);
  assert.match(html,/Ali &lt;b&gt;test&lt;\/b&gt; &amp; Co/);assert.ok(!html.includes('<a href="x">'));
  assert.match(html,/50%/);assert.match(html,/100%/);assert.match(html,/@reports_test/);assert.match(html,/https:\/\/t.me\/reports_test/);
  assert.ok(html.length<4096);assert.match(html,/<b>/);
});
test('Vector PDFs embed Uzbek and Cyrillic fonts, preserve anonymous profile and expose a clickable channel link',()=>{
  for(const script of ['latin','cyrillic']){
    const session=situationSession(definitions[0],'high');session.questionCount=81;
    const model=reportModelForTest(definitions[0],session);
    model.identity='789-856-77';model.session.name='PRIVATE_TELEGRAM_NAME';model.session.workplace={visibility:'private',name:'PRIVATE_COMPANY_NAME'};
    const pdf=createSurveyPdf(model,text=>toScript(text,script));
    const raw=Buffer.from(pdf.bytes).toString('latin1'), text=pdfText(pdf.bytes);
    assert.match(raw,/^%PDF-1.7/);assert.match(raw,/\/FontFile2/);assert.match(raw,/\/ToUnicode/);assert.match(raw,/https:\/\/t.me\/reports_test/);
    assert.match(text,script==='latin'?/Xodim rivojlanish profili/:/Ходим ривожланиш профили/);
    assert.match(text,/789-856-77/);assert.ok(!text.includes('PRIVATE_TELEGRAM_NAME'));assert.ok(!text.includes('PRIVATE_COMPANY_NAME'));
    assert.ok(pdf.pages>=6 && pdf.pages<20);assert.ok(pdf.bytes.length<500_000);
    assert.ok(pdf.layout.every(l=>l.x>=0 && l.x+l.width<=960.1 && l.y>=0 && l.y+l.height<=540));
    const xref=Number(raw.match(/startxref\n(\d+)/)[1]);assert.equal(raw.slice(xref,xref+4),'xref');
  }
  const named=reportModelForTest();named.identity='Sardor Gʻaniyev';assert.match(pdfText(createSurveyPdf(named).bytes),/Sardor Gʻaniyev/);
});
test('Long respondent proposals and KPI examples paginate within the PDF without truncation',()=>{
  const survey=definitions[1], session=situationSession(survey,'low');
  const long='W'.repeat(900)+' YAKUNIY_BELGI';
  session.answers[survey.questions.find(q=>q.proposal==='company').id]={text:long};
  withKpi(survey,session,'current_example','Hisobchi > aniqlik > oy > tekshiruv '+long);
  const model=reportModelForTest(survey,session);const pdf=createSurveyPdf(model);
  const text=pdfText(pdf.bytes);assert.match(text,/YAKUNIY_BELGI/);
  assert.ok(pdf.layout.every(l=>l.x+l.width<=960.1&&l.y+l.height<=540));assert.ok(pdf.pages<35);
});
test('Owner can regenerate a historical PDF privately and deliberately resend it once without changing response counts',async()=>{
  const mini={...definitions[0],questions:[{id:1,section:1,type:'text',text:'Fikringiz?'}]};const h=harness([mini]);
  await h.message(1,'/reportchannel @reports_test');await h.message(280,'/start employees');await h.press(280,'Boshlash');await h.message(280,'789-856-280');await h.press(280,'Yoshni o‘tkazib');await h.message(280,'Fikrim');await h.press(280,'Javoblarni yuborish');
  const token=h.sessions()[0].token;
  await h.message(1,'/pdf');await h.press(1,'789-856-280');
  const privatePdf=h.messages.findLast(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='1');assert.ok(privatePdf);await assertPdfAttachment(privatePdf.body);
  const button=h.buttons(1).find(b=>b.callback_data?.startsWith('a:pdfchannel:'));
  const before=h.messages.filter(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='-100123456').length;
  await h.bot.handle({update_id:30000,callback_query:{id:'forged-pdf',from:{id:281},message:{chat:{id:281,type:'private'}},data:button.callback_data}});
  assert.equal(h.messages.filter(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='-100123456').length,before);
  const update=await h.press(1,'Kanalga qayta yuborish');await h.bot.handle(update);
  assert.equal(h.messages.filter(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='-100123456').length,before+1);
  assert.equal(surveyStats(mini,h.sessions()).completed,1);
  await h.message(1,'/pdf '+token);assert.ok(h.messages.findLast(m=>m.method==='sendDocument').body.get('chat_id')==='1');
});
test('Participant resends only their completed report to the channel and receives a link instead of a private PDF',async()=>{
  const mini={...definitions[0],questions:[{id:1,section:1,type:'text',text:'Fikringiz?'}]};const h=harness([mini]);
  await h.message(1,'/reportchannel @reports_test');await h.message(282,'/start employees');await h.press(282,'Boshlash');await h.message(282,'789-856-282');await h.press(282,'Yoshni o‘tkazib');await h.message(282,'Fikrim');await h.press(282,'Javoblarni yuborish');
  const before=h.messages.filter(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='-100123456').length;
  const update=await h.press(282,'Hisobotni qayta yuborish');await h.bot.handle(update);
  assert.equal(h.messages.filter(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='-100123456').length,before+1);
  assert.equal(h.messages.filter(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='282').length,0);
  assert.ok(h.buttons(282).some(b=>b.url==='https://t.me/reports_test'));
  await h.message(282,'/survey');await h.press(282,'Hisobotni qayta yuborish');
  assert.equal(h.messages.filter(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='-100123456').length,before+1);
  assert.equal(surveyStats(mini,h.sessions()).completed,1);
  await h.message(282,'/pdf '+h.sessions()[0].token);
  assert.equal(h.messages.filter(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='282').length,0);
});


test('Customer home always exposes report resend and explains when no completed response exists',async()=>{
  const h=harness();await h.message(310,'/start');
  assert.ok(h.buttons(310).some(b=>b.text.includes('Hisobotni qayta yuborish')));
  await h.press(310,'Hisobotni qayta yuborish');
  assert.match(h.messages.at(-1).body.text,/Hali yakunlangan/);
  assert.equal(h.messages.filter(m=>m.method==='sendDocument').length,0);
});
test('Returning customer can resend an old completed survey from home even when that survey is closed',async()=>{
  const mini={...definitions[0],questions:[{id:1,section:1,type:'text',text:'Fikringiz?'}]};const h=harness([mini]);
  await h.message(1,'/reportchannel @reports_test');await h.message(311,'/start employees');await h.press(311,'Boshlash');await h.message(311,'789-856-311');await h.press(311,'Yoshni o‘tkazib');await h.message(311,'Oldingi fikrim');await h.press(311,'Javoblarni yuborish');
  await h.storage.put('open:employees',false);await h.message(311,'/start');
  assert.ok(h.buttons(311).some(b=>b.callback_data==='myreports'));
  const before=h.messages.filter(m=>m.method==='sendDocument').length;
  const update=await h.press(311,'Hisobotni qayta yuborish');await h.bot.handle(update);
  assert.equal(h.messages.filter(m=>m.method==='sendDocument').length,before+1);
  assert.equal(h.messages.filter(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='311').length,0);
  assert.equal(surveyStats(mini,h.sessions()).completed,1);
});
test('Owner preview shows the resend entry but does not publish test responses and offers actual reports',async()=>{
  const h=harness();await h.message(1,'/reportchannel @reports_test');await h.message(1,'/admin');await h.press(1,'Mijoz rejimi');
  assert.ok(h.buttons(1).some(b=>b.text.includes('Hisobotni qayta yuborish')));
  const before=h.messages.filter(m=>m.body.chat_id===-100123456).length;
  await h.press(1,'Hisobotni qayta yuborish');
  assert.match(h.messages.at(-1).body.text,/Sinov hisobotlari kanalga yuborilmaydi/);
  assert.ok(h.buttons(1).some(b=>b.callback_data==='a:pdfs:all'));
  assert.equal(h.messages.filter(m=>m.body.chat_id===-100123456).length,before);
});
test('Customers with both roles choose their own report and cannot retrieve another participant token',async()=>{
  const mini=definitions.map(s=>({...s,questions:[{id:1,section:1,type:'text',text:'Fikringiz?'}]}));const h=harness(mini);
  await h.message(1,'/reportchannel @reports_test');
  for(const [user,roles] of [[312,['employees','employers']],[313,['employees']]]) for(const id of roles){
    await h.message(user,'/start '+id);await h.press(user,'Boshlash');await h.message(user,'789-856-'+user);await h.press(user,'Yoshni o‘tkazib');await h.message(user,'Fikrim');await h.press(user,'Javoblarni yuborish');
  }
  await h.message(312,'/start');await h.press(312,'Hisobotni qayta yuborish');
  assert.equal(h.buttons(312).filter(b=>b.callback_data?.startsWith('myreport:')).length,2);
  const alien=h.sessions().find(s=>s.publicIdentity.value==='789-856-313');
  const before=h.messages.filter(m=>m.method==='sendDocument').length;
  await h.bot.handle({update_id:40000,callback_query:{id:'cross-user-report',from:{id:312},message:{chat:{id:312,type:'private'}},data:'myreport:employees:'+alien.token}});
  assert.equal(h.messages.filter(m=>m.method==='sendDocument').length,before);
  assert.match(h.messages.at(-1).body.text,/hisobot topilmadi/);
});


test('A brand new non-owner sees report resend on the first /start screen before choosing script',async()=>{
 const h=harness(definitions,undefined,false);
 await h.message(320,'/start');
 assert.ok(h.buttons(320).some(b=>b.callback_data==='script:latin'));
 assert.ok(h.buttons(320).some(b=>b.callback_data==='script:cyrillic'));
 assert.ok(h.buttons(320).some(b=>b.callback_data==='myreports'));
 assert.ok(!h.buttons(320).some(b=>b.callback_data?.startsWith('a:')));
 await h.press(320,'Hisobotni qayta yuborish');
 assert.match(h.messages.at(-1).body.text,/Hali yakunlangan/);
 assert.equal(h.messages.filter(m=>m.method==='sendDocument').length,0);
});
test('Public /reports and /menu commands work from a script chooser and never expose admin reports',async()=>{
 const h=harness(definitions,undefined,false);
 await h.message(321,'/start');await h.message(321,'/reports');
 assert.match(h.messages.at(-1).body.text,/Hali yakunlangan/);
 assert.ok(!h.buttons(321).some(b=>b.callback_data?.startsWith('a:')));
 await h.message(321,'/menu');await h.press(321,'Кириллча');
 assert.ok(h.buttons(321).some(b=>b.callback_data==='myreports'));
 await h.message(321,'/reports');assert.match(h.messages.at(-1).body.text,/Ҳали якунланган/);
});
