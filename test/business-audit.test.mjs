import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSurvey, toScript, surveyStats } from '../src/surveys.mjs';
import { buildBusinessInsights, renderBusinessText, businessMethodNote } from '../src/business-insights.mjs';
import { buildSurveyInsights } from '../src/survey-insights.mjs';
import { renderChannelReport, reportBotLink } from '../src/report-format.mjs';
import { createSurveyPdf } from '../src/survey-pdf.mjs';
import { russianCatalogue, translateRussian } from '../src/locale-ru.mjs';
import { harness, definitions } from './helpers/survey-harness.mjs';

const business = JSON.parse(await readFile(new URL('../config/surveys/business.json', import.meta.url), 'utf8'));
function sessionFor(points = 300) {
  let remaining = points - 100;
  const answers = {};
  for (const q of business.questions) {
    const extra = Math.min(2, remaining); remaining -= extra;
    answers[q.id] = { choices: [q.options[2 - extra]] };
  }
  return { survey: 'business', token: 'abc1234567', stage: 'done', revision: 105, index: 100,
    publicIdentity: { kind: 'code', value: '789-456-85' }, sector: 'private', questionCount: 100,
    completedAt: '2026-11-26T05:00:00.000Z', answers };
}
function modelFor(session) {
  return { survey: business, session, identity: session.publicIdentity.value,
    workplace: 'Maxfiy raqam bilan', sector: 'Xususiy sektor', date: '26/11/2026, 10:00',
    questionCount: 100, botUsername: 'SurveyTestBot',
    channel: { id: -100123456, title: 'HR hisobot', username: 'hr_hisobot' },
    insights: buildSurveyInsights(business, session) };
}
function assertRussian(text) {
  const stripped = String(text).replace(/https?:\/\/\S+|@[A-Za-z][A-Za-z0-9_]+|\/[a-z]+|[a-f0-9]{10}/g, '');
  assert.doesNotMatch(stripped, /[ЎўҚқҒғҲҳ]|[oOgG][‘ʻʼ]|\b(?:Ishxona|Ishxonangiz|Korxona|savol|savollar|tavsiya|javob|rahbar|xodim|yo‘nalish|boshlash|davomi)\b/iu);
}
function driver(h, user) {
  let id = 100_000;
  return {
    async say(text) { return h.bot.handle({ update_id: ++id, message: { message_id: id, text,
      from: { id: user }, chat: { id: user, type: 'private' } } }); },
    async press(match) {
      const b = h.buttons(user).find(b => typeof match === 'function' ? match(b) : b.callback_data === match || b.callback_data?.endsWith(':'+match));
      assert.ok(b, 'Button missing: '+String(match));
      return h.bot.handle({ update_id: ++id, callback_query: { id: 'cb'+id, from: { id: user },
        message: { message_id: id, chat: { id: user, type: 'private' } }, data: b.callback_data } });
    },
  };
}

test('Business audit is a separate complete 100-question definition and preserves the two HR surveys', () => {
  assert.equal(validateSurvey(business).questions.length, 100);
  assert.equal(business.sections.length, 10);
  assert.deepEqual(definitions.map(s=>s.questions.length), [84,67]);
  for (let i=0;i<100;i++) {
    const q = business.questions[i];
    assert.equal(q.id,i+1); assert.equal(q.section,Math.floor(i/10)+1);
    assert.equal(q.type,'single'); assert.equal(q.options.length,3);
  }
  assert.match(business.questions[38].text,/Marketing/);
  assert.match(business.questions[46].options.join(' '),/KPI/);
  assert.match(business.questions[73].text,/Backup/);
  assert.match(business.questions[90].text,/3–5 yillik/);
});

test('All score-band boundaries use the 100–300 point rubric without fabricated financial forecasts', () => {
  for(const [points,band] of [[100,'manual'],[150,'manual'],[151,'uneven'],[210,'uneven'],[211,'developing'],[260,'developing'],[261,'systematic'],[300,'systematic']]) {
    const b=buildBusinessInsights(business,sessionFor(points)).business;
    assert.equal(b.points,points);assert.equal(b.max,300);assert.equal(b.measured,100);
    assert.equal(b.band,band); assert.equal(b.percent,Math.round(points/3));
    assert.match(b.forecast,/prognozi chiqarilmadi/);
    assert.ok(!/20.?30%.*oshiradi|bozor yetakchisi/.test(b.conclusion));
    assert.equal(b.domains.reduce((n,d)=>n+d.points,0),points);
  }
});

test('Skipped, free-text, unknown and forged multi-choice answers are excluded from scores and coverage', () => {
  const s=sessionFor(300);
  s.answers[1]=null; s.answers[2]={text:'I do not know'};
  s.answers[3]={choices:['forged']};s.answers[4]={choices:[business.questions[3].options[0],business.questions[3].options[1]]};
  const b=buildBusinessInsights(business,s).business;
  assert.equal(b.measured,96);assert.equal(b.points,288);assert.equal(b.max,288);assert.equal(b.percent,100);
  assert.equal(b.complete,false);assert.equal(b.band,null);assert.equal(b.status,'Qisman natija');
  assert.equal(b.domains[0].measured,6);assert.equal(b.domains[0].points,18);
  const empty=buildBusinessInsights(business,{answers:{}}).business;
  assert.equal(empty.percent,null);assert.equal(empty.points,0);assert.equal(empty.max,0);
  assert.deepEqual(empty.weakest,[]);assert.deepEqual(empty.plan30,[]);
  assert.ok(empty.domains.every(d=>d.percent===null&&!d.rankable));
});

test('Weak directions require coverage, ties are deterministic and question-specific actions change with answers', () => {
  const s=sessionFor(300);
  for(let id=1;id<=10;id++)s.answers[id]={choices:[business.questions[id-1].options[2]]};
  for(let id=11;id<=20;id++)s.answers[id]={choices:[business.questions[id-1].options[1]]};
  const b=buildBusinessInsights(business,s).business;
  assert.deepEqual(b.weakest.map(d=>d.id),[1,2]);
  assert.equal(b.observations[0].id,1);
  const other=sessionFor(300);other.answers[74]={choices:[business.questions[73].options[2]]};
  const c=buildBusinessInsights(business,other).business;
  assert.match(c.plan30[0],/tiklash/);
  assert.notDeepEqual(b.plan30,c.plan30);
  const allLow=buildBusinessInsights(business,sessionFor(100)).business;
  assert.deepEqual(allLow.weakest.map(d=>d.id),[1,2]);
  for(let id=1;id<=6;id++)s.answers[id]=null;
  assert.ok(!buildBusinessInsights(business,s).business.weakest.some(d=>d.id===1));
});

test('Each business question, choice, domain and recommendation has a full Russian translation', () => {
  for(const q of business.questions)for(const value of[q.text,...q.options]) {
    assert.ok(Object.hasOwn(russianCatalogue,value),value);
    const ru=translateRussian(value);assert.notEqual(ru,value);assertRussian(ru);
  }
  const examples=[sessionFor(100),sessionFor(200),sessionFor(300),{...sessionFor(),answers:{}}];
  for(const s of examples) {
    const model=modelFor(s), b=model.insights.business;
    for(const value of[b.status,b.conclusion,b.forecast,b.methodNote,...b.plan30,...b.plan90,
      ...b.domains.flatMap(d=>[d.title,d.tip]),...b.observations.map(o=>o.action)]) {
      assert.ok(Object.hasOwn(russianCatalogue,value),value);
      assertRussian(translateRussian(value));
    }
    assertRussian(translateRussian(renderBusinessText(model.insights)));
  }
});

test('Business channel reports escape public names, stay within Telegram size and advertise both channel and bot', () => {
  for(const script of['latin','cyrillic','russian'])for(const points of[100,200,300]) {
    const s=sessionFor(points);s.publicIdentity={kind:'name',value:'<b>Company & Co</b>'};
    const report=renderChannelReport(modelFor(s),text=>toScript(text,script));
    assert.ok(report.length<4096,script+': '+report.length);
    assert.ok(!report.includes('<b>Company & Co</b>'));
    assert.ok(report.includes('&lt;'));
    assert.match(report,/https:\/\/t.me\/hr_hisobot/);assert.match(report,/https:\/\/t.me\/SurveyTestBot/);
    if(script==='russian')assertRussian(report);
  }
  assert.equal(reportBotLink('"><script>').url,'https://t.me/Laylo_asistent_bot');
});

test('Business PDFs have ten charts, complete recommendations, valid layout and two clickable Telegram links in all scripts', () => {
  for(const script of['latin','cyrillic','russian']) {
    const model=modelFor(sessionFor(172)),pdf=createSurveyPdf(model,text=>toScript(text,script));
    assert.ok(pdf.pages>=7);
    const text=pdf.layout.map(x=>x.text).join(' ').replace(/\s+/g,' '),raw=Buffer.from(pdf.bytes).toString('latin1');
    assert.match(raw,/^%PDF-1.7/); assert.match(raw,/https:\/\/t.me\/hr_hisobot/);
    assert.match(raw,/https:\/\/t.me\/SurveyTestBot/);
    for(const domain of model.insights.business.domains)
      assert.ok(text.includes(toScript(domain.title,script)),domain.title);
    for(const action of model.insights.business.plan30) {
      const first=toScript(action,script).split(' ').slice(0,3).join(' ');
      assert.ok(text.includes(first),first);
    }
    for(const row of pdf.layout) {
      assert.ok(row.x>=0 && row.x+row.width<=961,JSON.stringify(row));
      assert.ok(row.y>=0 && row.y+row.height<=540,JSON.stringify(row));
    }
    if(script==='russian')assertRussian(text);
  }
});

for(const script of['latin','cyrillic','russian'])test('A respondent completes all 100 business questions in '+script+' and gets a channel link without resend/admin controls',async()=>{
  const h=harness([...definitions,business],undefined,false,false),d=driver(h,40);
  await h.storage.put('report-channel',{id:-100123456,title:'HR hisobot',username:'hr_hisobot'});
  await d.say('/start business');
  await d.press('script:'+script);
  if(script==='russian')assertRussian(h.messages.findLast(m=>m.body.chat_id===40)?.body.text);
  await d.press('begin');
  await d.say('789-456-85');
  assert.equal(h.sessions()[0].stage,'sector','Business profile must not ask the owner age');
  await d.press('sector_private');
  for(const q of business.questions) {
    const last=h.messages.findLast(m=>m.body.chat_id===40)?.body.text;
    assert.ok(last.includes(toScript(q.text,script)));
    if(script==='russian')assertRussian(last);
    await d.press('v'+(q.id%3));
  }
  assert.equal(h.sessions()[0].stage,'review');await d.press('submit');
  const s=h.sessions()[0];assert.equal(s.stage,'done');assert.equal(s.insights.business.measured,100);
  assert.equal(s.script,script);assert.equal(surveyStats(business,h.sessions()).completed,1);
  assert.ok(!h.buttons(40).some(b=>b.callback_data?.startsWith('a:')||b.callback_data?.includes('resend')));
  assert.ok(h.buttons(40).some(b=>b.url==='https://t.me/hr_hisobot'));
  const report=h.messages.find(m=>m.method==='sendMessage'&&m.body.chat_id===-100123456);
  assert.ok(report);assert.match(report.body.text,/https:\/\/t.me\/SurveyTestBot/);
  const file=h.messages.find(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='-100123456');
  assert.ok(file);assert.match(file.body.get('document').name,/^HR_hisobot_.*\.pdf$/);
  assert.match(file.body.get('caption'),/https:\/\/t.me\/hr_hisobot/);
  assert.match(file.body.get('caption'),/https:\/\/t.me\/SurveyTestBot/);
  if(script==='russian'){assertRussian(report.body.text);assertRussian(file.body.get('caption'));}
});

test('The owner can preview the new audit without public reports or participant counts',async()=>{
  const h=harness([...definitions,business],undefined,false,false),d=driver(h,1);
  await h.storage.put('report-channel',{id:-100123456,title:'HR hisobot',username:'hr_hisobot'});
  await d.say('/admin');await d.press('a:preview');
  await d.press('script:russian');await d.press('a:trypreview:business');
  await d.press('begin');await d.say('Test Company');await d.press('sector_private');
  for(const q of business.questions)await d.press('v0');
  await d.press('submit');
  assert.equal(h.sessions().length,0);
  assert.ok(!h.messages.some(m=>m.body.chat_id===-100123456||m.body.get?.('chat_id')==='-100123456'));
  assert.ok(h.messages.some(m=>m.method==='sendDocument'&&m.body.get('chat_id')==='1'));
});

test('The existing employee channel summary and PDF also advertise the survey bot',()=>{
  const survey=definitions[0],session={...sessionFor(),survey:survey.id,answers:{},questionCount:84};
  const model={...modelFor(session),survey,questionCount:84,insights:buildSurveyInsights(survey,session)};
  const post=renderChannelReport(model);
  assert.match(post,/https:\/\/t.me\/SurveyTestBot/);
  assert.match(Buffer.from(createSurveyPdf(model).bytes).toString('latin1'),/https:\/\/t.me\/SurveyTestBot/);
  assert.match(model.insights.method,/laylo-survey-indicators-v4/);
});

test('Full high-score PDFs recommend verifying strengths instead of claiming that answers are missing',()=>{
  for(const script of ['latin','russian']) {
    const pdf=createSurveyPdf(modelFor(sessionFor(300)),text=>toScript(text,script));
    const text=pdf.layout.map(x=>x.text).join(' ').replace(/\\s+/g,' ');
    assert.ok(!text.includes(toScript('Bu yo‘nalish uchun yetarli javob olinmagan.',script)));
    assert.ok(text.includes(toScript('Saqlash va tekshirish',script)));
    if(script==='russian')assertRussian(text);
  }
});
