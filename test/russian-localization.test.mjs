import assert from 'node:assert/strict';
import test from 'node:test';
import { definitions, harness } from './helpers/survey-harness.mjs';
import { translateRussian, russianCatalogue } from '../src/locale-ru.mjs';

async function auditRussianScenarios(roundCount=10) {

const auditIssues=new Map(),auditStats={flows:0,questions:0,messages:0,pdfs:0};
const allowed=new Set(['LAYLO','Laylo','HR','PDF','KPI','CSV','UZS','USD','EUR','ID','API','SHA','KORA','GROUP','Ali','Valiyev','Hisobotlar']);
function inspect(text,where){
 if(typeof text!=='string')return;
 const cleaned=text.replaceAll('Drop Logistics LLC','').replace(/\bt\.me\b/g,'').replace(/https?:\/\/[^\s<>]+|@[A-Za-z0-9_]+|\/[a-z][a-z0-9_]*|\b[a-f0-9]{10}\b|HR_hisobot_[\w-]+\.pdf/gu,' ').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot);/g,' ');
 const words=cleaned.match(/[A-Za-z][A-Za-z‘’ʻʼ']*/gu)??[];
 const bad=[...new Set([...words.filter(w=>!allowed.has(w)),...(cleaned.match(/[ЎўҚқҒғҲҳ][\p{L}]*/gu)??[])])];
 if(bad.length){const key=bad.join(',');if(!auditIssues.has(key))auditIssues.set(key,{bad,where,text});}
}
async function plainPdf(file){const bytes=new Uint8Array(await file.arrayBuffer());const parts=[];for(let i=0;i<bytes.length;i+=4096)parts.push(String.fromCharCode(...bytes.subarray(i,i+4096)));return [...parts.join('').matchAll(/<([A-F0-9]+)> Tj/g)].map(m=>m[1].match(/.{4}/g).map(h=>String.fromCharCode(parseInt(h,16))).join('')).join('\n');}
async function inspectMessages(h,scope,skip=new Set()){
 for(let i=0;i<h.messages.length;i++){
  if(skip.has(i))continue;const m=h.messages[i],body=m.body;
  if(m.method==='sendMessage'||m.method==='editMessageText'){
   if(body.chat_id!==scope&&body.chat_id!==-100123456)continue;
   const bs=body.reply_markup?.inline_keyboard.flat()??[];
   if(bs.some(b=>b.callback_data==='script:russian'))continue;
   auditStats.messages++;inspect(body.text,'message:'+scope+':'+i);
   for(const b of bs)inspect(b.text,'button:'+scope+':'+i);
  }
  if(m.method==='sendDocument'&&[String(scope),'-100123456'].includes(body.get('chat_id'))){
   inspect(body.get('caption'),'caption:'+scope+':'+i);
   if(body.get('document').type==='application/pdf'){auditStats.pdfs++;inspect(await plainPdf(body.get('document')),'pdf:'+scope+':'+i);}
  }
 }
}
async function pressCb(h,user,predicate){const b=h.buttons(user).find(b=>typeof predicate==='string'?b.callback_data===predicate:predicate(b.callback_data??''));assert.ok(b,'Missing callback '+predicate);return h.press(user,b.text);}
let firstHarness;
for(let round=0;round<roundCount;round++)for(const survey of definitions){
 const h=harness(definitions,undefined,false,false),user=400+round*2+(survey.id==='employers'?1:0),skip=new Set();
 await h.message(1,'/reportchannel @reports_test');for(let i=0;i<h.messages.length;i++)skip.add(i);
 await h.message(user,'/start '+survey.id);await pressCb(h,user,'script:russian');await pressCb(h,user,c=>c.endsWith(':begin'));
 await h.message(user,'!');await h.message(user,'900-900-'+user);await h.message(user,'0');await h.message(user,'121');
 if(round%2)await pressCb(h,user,c=>c.endsWith(':skip'));else await h.message(user,'39');
 if(survey.id==='employees'){
  await h.message(user,'#');await h.message(user,'Я'.repeat(151));await h.message(user,'Drop Logistics LLC');
  if(round%2){await pressCb(h,user,c=>c.endsWith(':profile_back'));await pressCb(h,user,c=>c.endsWith(':workplace_private'));}
 }
 await h.message(user,'??');const sectors=['public','private','mixed','nonprofit','other','undisclosed'];await pressCb(h,user,c=>c.endsWith(':sector_'+sectors[round%sectors.length]));
 for(const q of survey.questions){
  if(q.id===2&&round===4){await pressCb(h,user,c=>c.endsWith(':pause'));await h.message(user,'Позже');await pressCb(h,user,'resume:'+survey.id);}
  if(q.id===3&&round===6){await pressCb(h,user,c=>c.endsWith(':back'));const previous=survey.questions[q.id-2];if(previous.options)await pressCb(h,user,c=>c.endsWith(':v0'));else await h.message(user,'Предыдущий ответ');}
  if(q.type==='single')await pressCb(h,user,c=>c.endsWith(':v'+(round===8&&q.assessment?q.options.length-1:round%q.options.length)));
  else if(q.type==='multi'){
   await pressCb(h,user,c=>c.endsWith(':next'));
   for(let n=0;n<(q.choose??Math.min(4,q.options.length));n++)await pressCb(h,user,c=>c.endsWith(':v'+n));
   if(q.choose&&q.options.length>q.choose)await pressCb(h,user,c=>c.endsWith(':v'+q.choose));
   if(q.exclusiveOptions&&round===7)await pressCb(h,user,c=>c.endsWith(':v'+q.options.indexOf(q.exclusiveOptions[0])));
   if(round===5&&q.id===9){await pressCb(h,user,'script:choose:resume');const from=h.messages.length;await pressCb(h,user,'script:latin');await pressCb(h,user,'script:choose:resume');for(let j=from;j<h.messages.length;j++)skip.add(j);await pressCb(h,user,'script:russian');}
   await pressCb(h,user,c=>c.endsWith(':next'));
  }else{
   await h.message(user,q.type==='money'?'ошибка':q.type==='number'?'-1':'Я'.repeat(1001));
   await h.message(user,q.type==='money'?'3,5 млн. сум':q.type==='number'?'30':'Улучшить обучение и прозрачность премий.');
  }
  auditStats.questions++;
 }
 await pressCb(h,user,c=>c.endsWith(':submit'));assert.equal(h.sessions()[0].stage,'done');
 await inspectMessages(h,user,skip);auditStats.flows++;if(!firstHarness)firstHarness=h;
}
const h=firstHarness;const ownerStart=h.messages.length;
await h.message(1,'/start');await pressCb(h,1,'script:russian');
for(const command of ['/report','/surveys','/export','/pdf','/reportchannel','/help','/menu'])await h.message(1,command);
await h.message(1,'/newsurvey');await h.message(1,'Тестовый опрос');await h.message(1,'Как дела? | Хорошо | Плохо');await pressCb(h,1,'a:publish');
await h.message(1,'/reportchannel');await pressCb(h,1,'a:channelsetup');await h.message(1,'bad target');await h.message(1,'/cancel');
await inspectMessages(h,1,new Set(Array.from({length:ownerStart},(_,i)=>i)));
return {...auditStats,issueGroups:auditIssues.size,issues:[...auditIssues.values()]};

}


test('Ten Russian flow variations cover every profile stage, navigation, validation, question, report and PDF',async()=>{
 const result=await auditRussianScenarios(10);
 assert.equal(result.flows,20);
 assert.equal(result.questions,1510);
 assert.equal(result.pdfs,20);
 assert.ok(result.messages>2500);
 assert.deepEqual(result.issues,[],JSON.stringify(result.issues,null,2));
});
test('Both roles show a complete Russian sector question after profile data without changing the entered company',async()=>{
 for(const role of ['employees','employers']){
  const h=harness(definitions,undefined,false,false),user=900;
  await h.message(user,'/start '+role);await pressCbTest(h,user,'script:russian');await pressCbTest(h,user,c=>c.endsWith(':begin'));
  await h.message(user,role==='employees'?'900-900':'Drop Logistics LLC');await h.message(user,'39');
  if(role==='employees')await h.message(user,'Drop Logistics LLC');
  const text=h.messages.findLast(m=>m.body.chat_id===user&&m.body.text).body.text;
  assert.match(text,/К какому сектору относится/);
  assert.ok(!/[A-Za-zЎўҚқҒғҲҳ]/u.test(text));
  const lang=h.buttons(user).find(b=>b.callback_data==='script:choose:resume');
  assert.equal(lang.text,'🔤 Язык');
  if(role==='employees')assert.equal(h.sessions()[0].workplace.name,'Drop Logistics LLC');
  else assert.equal(h.sessions()[0].publicIdentity.value,'Drop Logistics LLC');
 }
});
async function pressCbTest(h,user,predicate){const b=h.buttons(user).find(b=>typeof predicate==='string'?b.callback_data===predicate:predicate(b.callback_data??''));assert.ok(b);return h.press(user,b.text);}
test('Russian profile labels use the reviewed HR meaning and working command names stay intact',()=>{
 assert.equal(translateRussian('⬅️ Yoshga qaytish'),'⬅️ Назад к возрасту');
 assert.equal(translateRussian('O‘zgaruvchan jadval'),'Сменный / изменяющийся график');
 const commands=new Set(['/start','/survey','/script','/cancel','/pdf','/reports','/admin','/menu','/help','/reportchannel','/report','/export','/surveys','/newsurvey']);
 for(const[source,target]of Object.entries(russianCatalogue)){
  for(const token of source.match(/\/[a-z][a-z0-9_]*/g)??[])if(commands.has(token))assert.ok(target.includes(token),source+' -> '+target);
 }
 const protectedText='https://example.com/Holat?KPI=test user@example.com @hr_hisobot /cancel abcdef1234';
 assert.equal(translateRussian(protectedText),protectedText);
 const q=definitions[0].questions[82];
 assert.ok(translateRussian('Savol 83/84\n\n'+q.text).includes(translateRussian(q.text)));
});

test('Reviewed Russian HR wording preserves duration, multiple selection, support direction and evidence limits',()=>{
 const cases=[["Vaqt ham, sharoit ham mavjud","Есть и выделенное время, и условия для обеда"],["Korxonangiz qancha vaqtdan beri faoliyat yuritadi? Yil va oy bilan yozing.","Как долго работает ваша компания? Укажите продолжительность в годах и месяцах."],["Quyidagi imtiyozlardan qaysilari siz uchun eng muhim?","Какие из следующих льгот для вас наиболее важны?"],["Maosh kechikishi xavfini erta aytish, real reja va muntazam xabar berishni saqlang.","Продолжайте заранее предупреждать о риске задержки зарплаты, предлагать реалистичный план и регулярно сообщать о ходе его выполнения."],["Charchoq haqidagi xabarni erta signal sifatida ko‘rib, ish yukini moslang.","Воспринимайте сообщения сотрудников об усталости как ранний сигнал и корректируйте их рабочую нагрузку."],["Ish hajmi va sifatga xavfni erta aytib, ustuvorlik va kerakli yordamni rahbar bilan kelishing.","Заранее сообщайте руководителю о нагрузке и рисках для качества; согласуйте приоритеты и необходимую вам помощь."],["Bu so‘rovnomada rahbarning javoblari berilgan. Xodimning qoniqishini baholash uchun uning o‘z javoblari ham kerak.","В этом опросе приведены ответы руководителя. Чтобы оценить удовлетворённость сотрудника, нужны также ответы самого сотрудника."],["Bu respondent bildirgan sharoitlar. Korxona haqidagi mustaqil tekshiruv emas.","Условия описаны со слов участника опроса. Независимая проверка компании не проводилась."]];
 for(const[source,target]of cases){
  assert.equal(translateRussian(source),target);
  const withoutPeriod=source.replace(/\.$/u,'');
  if(Object.hasOwn(russianCatalogue,withoutPeriod))assert.equal(translateRussian(withoutPeriod),target.replace(/\.$/u,''));
 }
});
