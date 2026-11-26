import { pdfFonts } from './pdf-fonts.mjs';
import { reportPercent, reportProfile, reportChannelLink, reportBotLink } from './report-format.mjs';

// A small, dependency-free vector PDF writer. Fonts are bundled and pre-compressed at build time.
// No browser, external conversion API, Node API, paid service or network request is needed at runtime.
const pdfEncoder = new TextEncoder();
const PW = 960, PH = 540;
const palette = { navy: '#13263e', teal: '#087f83', mint: '#ddf3ed', ink: '#203047', muted: '#596c80', bg: '#f2f5f9', white: '#ffffff', line: '#dce4ed', amber: '#a55c0b', pale: '#fff1dc' };
const fontBytes = pdfFonts.map(f => ({ data: Uint8Array.from(atob(f.data), c => c.charCodeAt(0)), map: Uint8Array.from(atob(f.cidMap), c => c.charCodeAt(0)) }));
const hex = value => value.toString(16).padStart(4, '0').toUpperCase();
const numeric = value => String(Math.round(value * 100) / 100);
const color = value => value.match(/[0-9a-f]{2}/gi).map(x => numeric(parseInt(x,16)/255)).join(' ');
function pdfSafe(text) {
  return Array.from(String(text ?? '').normalize('NFC').replaceAll('→', ' > ')).filter(c => !/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufe0f]/u.test(c)).map(c => c === '\n' || c === '\r' || c === '\t' ? ' ' : pdfFonts[0].glyphs[c.codePointAt(0)] ? c : c.codePointAt(0) > 0xffff ? '' : '?').join('');
}
function pdfWidth(text, size, font = 0) { return Array.from(text).reduce((sum,c) => sum + (pdfFonts[font].glyphs[c.codePointAt(0)]?.[1] ?? 600), 0) * size / 1000; }
function pdfWrap(text, width, size, font = 0) {
  const words = pdfSafe(text).trim().split(/\s+/u).filter(Boolean), lines = [];
  let line = '';
  for (const word of words) {
    if (pdfWidth((line ? line + ' ' : '') + word, size, font) <= width) { line += (line ? ' ' : '') + word; continue; }
    if (line) { lines.push(line); line = ''; }
    if (pdfWidth(word, size, font) <= width) { line = word; continue; }
    for (const char of word) {
      if (line && pdfWidth(line + char, size, font) > width) { lines.push(line); line = ''; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}
function pdfJoin(chunks) { const out = new Uint8Array(chunks.reduce((n,b) => n + b.length,0)); let offset = 0; for (const b of chunks) { out.set(b,offset); offset += b.length; } return out; }
function pdfStream(bytes, extra = '') { return pdfJoin([pdfEncoder.encode('<< /Length ' + bytes.length + ' ' + extra + ' >>\nstream\n'), bytes, pdfEncoder.encode('\nendstream')]); }
function pdfUnicode(text) { return '<FEFF' + Array.from(pdfSafe(text)).map(c => hex(c.codePointAt(0))).join('') + '>'; }
export function createSurveyPdf(model, transform = value => String(value)) {
  const { survey, session, insights, identity, workplace, sector, date, channel } = model;
  const t = text => pdfSafe(transform(String(text ?? '')));
  const count = Math.min(survey.questions.length, model.questionCount ?? session.questionCount ?? survey.questions.length);
  const answered = Object.entries(session.answers ?? {}).filter(([id,a]) => Number(id) <= count && a).length;
  const pages = [], used = [new Set(), new Set()], layout = [];
  let page;
  function rect(x,y,w,h,fill,r=0) {
    const a = x, b = PH-y-h, k = r*0.55228475;
    let shape = [a,b,w,h].map(numeric).join(' ') + ' re';
    if(r) shape = [a+r,b,'m',a+w-r,b,'l',a+w-r+k,b,a+w,b+r-k,a+w,b+r,'c',a+w,b+h-r,'l',a+w,b+h-r+k,a+w-r+k,b+h,a+w-r,b+h,'c',a+r,b+h,'l',a+r-k,b+h,a,b+h-r+k,a,b+h-r,'c',a,b+r,'l',a,b+r-k,a+r-k,b,a+r,b,'c','h'].map(v=>typeof v==='number'?numeric(v):v).join(' ');
    page.commands.push(color(fill)+' rg '+shape+' f');
  }
  function line(x,y,x2,y2,stroke=palette.line,weight=1) { page.commands.push(color(stroke)+' RG '+numeric(weight)+' w '+numeric(x)+' '+numeric(PH-y)+' m '+numeric(x2)+' '+numeric(PH-y2)+' l S'); }
  function text(value,x,y,size=16,bold=false,fill=palette.ink,width=880,limit=Infinity) {
    const font=bold?1:0, rows=pdfWrap(t(value),width,size,font); let output=rows.slice(0,limit);
    if(rows.length>limit && output.length) {
      let last=output.at(-1); while(last && pdfWidth(last+'…',size,font)>width) last=last.slice(0,-1); output[output.length-1]=last+'…';
    }
    output.forEach((row,i)=>{
      for(const c of row) used[font].add(c.codePointAt(0));
      page.commands.push('BT /F'+font+' '+numeric(size)+' Tf '+color(fill)+' rg 1 0 0 1 '+numeric(x)+' '+numeric(PH-y-size-i*size*1.38)+' Tm <'+Array.from(row).map(c=>hex(c.codePointAt(0))).join('')+'> Tj ET');
      layout.push({ page: pages.length, x, y:y+i*size*1.38, width:pdfWidth(row,size,font), height:size*1.38, text:row });
    });
    return y+output.length*size*1.38;
  }
  function fresh(title,kicker='LAYLO / HR HISOBOT') {
    page={commands:[],links:[]}; pages.push(page); rect(0,0,PW,PH,palette.bg); rect(0,0,PW,6,palette.teal);
    text(kicker,40,25,11,true,palette.teal); text(title,40,56,28,true,palette.navy,880,2);
    return 142;
  }
  function link(url,x,y,w,h) { if(/^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}$/.test(url)) page.links.push({url,x,y,w,h}); }
  function flow(title,items,kicker) {
    let y=fresh(title,kicker), sequence=0;
    for(const item of items) {
      let bodyRows=pdfWrap(t(item.body),832,16), first=true;
      if(!bodyRows.length) bodyRows=[''];
      while(bodyRows.length) {
        const titleRows=pdfWrap(t(item.title+(first?'':' · davomi')),832,18,1);
        const headingHeight=titleRows.length*24.84;
        if(y+headingHeight+64>474) y=fresh(title+' · davomi',kicker);
        const available=Math.max(1,Math.floor((474-y-headingHeight-42)/22.08));
        const rows=bodyRows.splice(0,available), h=headingHeight+rows.length*22.08+32;
        rect(40,y,880,h,palette.white,10); rect(40,y,4,h,item.accent??palette.teal,0);
        text(item.title+(first?'':' · davomi'),58,y+13,18,true,item.accent??palette.navy,832);
        rows.forEach((row,i)=>text(row,58,y+18+headingHeight+i*22.08,16,false,palette.ink,832));
        y+=h+14; first=false; sequence++;
      }
    }
    if(!sequence) text('Bu yo‘nalish uchun yetarli javob olinmagan.',40,y,18,false,palette.muted,880);
  }

  function columns(title,left,right) {
    const pending=[left,right].map(items=>items.map(item=>({ title:t(item.title), rows:pdfWrap(t(item.body),384,15), accent:item.accent??palette.navy })));
    let continuation=false;
    do {
      fresh(title+(continuation?' · davomi':''));
      for(let col=0;col<2;col++) {
        const x=40+col*452; rect(x,140,428,342,palette.white,10); let y=153;
        while(pending[col].length) {
          const item=pending[col][0], titleRows=pdfWrap(item.title,384,16,1);
          const th=titleRows.length*22.08, available=Math.floor((470-y-th-10)/20.7);
          if(available<1 || (item.rows.length<=10 && item.rows.length>available && y>153)) break;
          text(item.title,x+22,y,16,true,item.accent,384); y+=th+6;
          const rows=item.rows.splice(0,Math.max(1,available));
          rows.forEach(row=>{text(row,x+22,y,15,false,palette.ink,384);y+=20.7;});
          y+=14;
          if(!item.rows.length) pending[col].shift();
          else {item.title=t('Davomi');break;}
        }
      }
      continuation=true;
    } while(pending.some(items=>items.length));
  }

  function bars(title,rows,subtitle,businessMode=false) {
    const groups=[]; for(let i=0;i<rows.length;i+=6) groups.push(rows.slice(i,i+6));
    if(!groups.length) groups.push([]);
    for(const group of groups) {
      fresh(title); text(subtitle,40,105,13,false,palette.muted,880,2);
      for(let n=0;n<=10;n+=2) { const x=348+n/10*420; line(x,153,x,457,palette.line,0.6); text(businessMode?n*10+'%':n+'',x-4,137,9,false,palette.muted,35); }
      group.forEach((row,i)=>{
        const y=173+i*47, pct=reportPercent(row.score), c=pct===null?palette.muted:pct>=80?palette.teal:pct>=60?palette.navy:palette.amber;
        text(row.title,44,y-3,14,true,palette.ink,285,2);
        rect(348,y+3,420,12,palette.line,5); if(pct!==null && pct>0) rect(348,y+3,420*pct/100,12,c,Math.min(5,420*pct/100/2));
        text(pct===null?'Ma’lumot yetarli emas':businessMode?pct+'% / '+row.points+'/'+row.max:pct+'%  /  '+String(row.score).replace('.',',')+'/10',790,y-5,pct===null?11:14,true,c,135,2);
        if(row.measured!==undefined) text('Asos: '+row.measured+'/'+row.total+' javob',348,y+18,10,false,palette.muted,420);
      });
      if(!group.length) text('Baholanadigan javoblar hali yetarli emas.',44,190,20,false,palette.muted,840);
      text(businessMode?'Ballar ulushi. O‘tkazilgan va noma’lum javoblar 0 ball hisoblanmaydi. Har yo‘nalishda qamrov alohida ko‘rsatiladi.':'0–100% — 0–10 ballik indeks ko‘rinishi. Noma’lum javoblar 0 emas.',40,475,11,false,palette.muted,880);
    }
  }
  let profile;
  if (insights?.business) {
    const audit=insights.business;
    profile={key:audit.band??'unknown',title:audit.status,percent:audit.percent,note:audit.methodNote};
    fresh('');rect(0,0,PW,PH,palette.navy);rect(0,0,12,PH,palette.teal);
    text('HR HISOBOT',44,30,13,true,'#81d9cc');
    text('Korxona biznes tahlili',44,78,34,true,palette.white,860,2);
    text(identity,44,170,27,true,palette.white,860,2);
    text(audit.status,44,254,20,true,'#81d9cc',860,2);
    text('Javoblar: '+audit.measured+'/100 · '+date+' (Toshkent)',44,311,13,false,'#c5d3e3',860,2);
    const cards=[['Ball',audit.points+'/'+audit.max],['Ballar ulushi',(audit.percent??'—')+'%'],['Javoblar qamrovi',audit.measured+'/100']];
    cards.forEach(([label,value],i)=>{const x=44+i*294;rect(x,370,278,116,'#203b55',10);text(label,x+17,383,15,true,palette.white,244,2);text(value,x+17,426,29,true,'#81d9cc',244,1);});
    columns('Ma’lumotlar va asosiy xulosalar',[
      {title:'Nom yoki maxfiy raqam',body:identity},{title:'Ishxona va sektor',body:workplace+' · '+sector},
      {title:'Javoblar qamrovi',body:audit.measured+'/100'},
    ],[{title:audit.status,body:audit.conclusion},{title:'Natijani qanday o‘qiymiz?',body:'A = 3, B = 2, C = 1 ball. Foiz — berilgan aniq javoblar ballining mumkin bo‘lgan maksimal ballga nisbati. Bu korxona muvaffaqiyati ehtimoli emas.'}]);
    bars('Yo‘nalishlar bo‘yicha natijalar',audit.domains,'Kamida 5 ta aniq javobli yo‘nalishlar taqqoslanadi.',true);
    columns('Kuchli tomonlar va o‘sish nuqtalari',
      audit.strongest.some(d=>d.percent>=80)?audit.strongest.filter(d=>d.percent>=80).map(d=>({title:d.title,body:d.points+'/'+d.max+' · '+d.percent+'% · Javob: '+d.measured+'/10'})):[{title:'Kuchli ko‘ringan yo‘nalishlar',body:audit.measured?'Baholangan yo‘nalishlarda 80% va undan yuqori natija yo‘q. Pastroq yo‘nalishlar bo‘yicha amaliy choralarni ko‘rib chiqing.':'Baholash uchun aniq variantli javob olinmagan. Savollarni to‘ldirib, natijani qayta ko‘ring.'}],
      audit.weakest.length?audit.weakest.map(d=>({title:d.title,body:d.tip,accent:palette.amber})):[{title:'Ustuvor e’tibor yo‘nalishlari',body:'Taqqoslashga olingan yo‘nalishlarda pastroq natija aniqlanmadi. Qamrov va amaliy dalillarni tekshiring.'}]);
    if(audit.observations.length) flow('Javoblar bo‘yicha aniqlashtiriladigan holatlar',audit.observations.map(r=>({
      title:'Savol '+r.id,body:r.question+' '+ 'Tanlangan javob'+': «'+t(r.selected)+'». '+ 'Amaliy chora'+': '+r.action,
    })));
    else if(audit.measured) flow('Javoblar bo‘yicha aniqlashtiriladigan holatlar',[{title:'Saqlash va tekshirish',body:'Baholangan javoblar eng yuqori variantga mos. Mustaqil ish, zaxiradan tiklash va inqiroz rejalarini amaliy sinovda tekshiring.'}]);
    columns('Keyingi 30 kun uchun qadamlar',audit.plan30.map((body,i)=>({title:'Amaliy qadam '+(i+1),body})),[
      {title:'Reja',body:'Har bir qadam uchun mas’ul, muddat va boshlang‘ich ko‘rsatkichni yozing. Natijani 30 kundan keyin tekshiring.'},
      {title:'Saqlash va tekshirish',body:'Eng past foizlar teng bo‘lishi mumkin. Teng natijada yo‘nalishlar savolnomadagi tartibda ko‘rsatiladi.'},
    ]);
    flow('Keyingi 90 kun uchun yo‘nalish',[
      ...audit.plan90.map((body,i)=>({title:'Amaliy qadam '+(i+1),body})),
      {title:'Reja',body:'Amalda joriy qilingan o‘zgarishlarni tekshirib, shu savolnomani bir xil sharoitda qayta baholang.'},
    ]);
    flow('Istiqbol va shartli reja',[
      {title:'Natijani qanday o‘qiymiz?',body:audit.forecast},
      {title:'Reja',body:'Past natijali jarayonlarni yaxshilash va natijani o‘lchash boshqaruvning takrorlanuvchanligini oshirishga yordam berishi mumkin. Bu daromad yoki o‘sish kafolati emas.'},
    ]);
  } else {
  // Cover, with large text and generous separation between the three independent indices.
  fresh(''); rect(0,0,PW,PH,palette.navy); rect(0,0,12,PH,palette.teal);
  text('LAYLO  /  HR HISOBOT',44,30,13,true,'#81d9cc');
  text(survey.id==='employers'?'Rahbarlik va korxona profili':'Xodim rivojlanish profili',44,78,34,true,palette.white,720,2);
  text(identity,44,170,27,true,palette.white,860,2);
  profile=reportProfile(insights);
  text(profile.title,44,254,20,true,'#81d9cc',860,2);
  text('Javoblar: '+answered+'/'+count+'  ·  '+date+' (Toshkent)',44,311,13,false,'#c5d3e3',860,2);
  const cards=[['Korxona sharoitlari',insights?.company],['Ish tajribasi',insights?.employee],[survey.id==='employers'?'Rahbarlik yondashuvi':'Vaziyatli yondashuv',insights?.situational]];
  cards.forEach(([label,data],i)=>{
    const x=44+i*294, p=reportPercent(data?.score);
    rect(x,370,278,116,'#203b55',10); text(label,x+17,383,15,true,palette.white,244,2);
    text(p===null?'—':p+'%',x+17,418,32,true,'#81d9cc',240,1);
    text(p===null?'Ma’lumot yetarli emas':String(data.score).replace('.',',')+'/10 · '+data.measured+'/'+data.total+' ko‘rsatkich',x+17,463,10,false,'#d2ddeb',244,1);
  });
  const facts=[
    {title:'Nom yoki maxfiy raqam',body:identity+' · Yosh: '+(session.age??'Ko‘rsatilmagan')},
    {title:'Ishxona va sektor',body:workplace+' · '+sector},
  ];
  if(survey.id==='employees') {
    const value=id=>{const a=session.answers?.[id];return a?[...(a.choices??[]).map(t),a.text].filter(Boolean).join(' / '):'Ko‘rsatilmagan';};
    facts.push({title:'Lavozim va tajriba',body:value(2)+' · Shu ish joyida: '+value(1)});
    facts.push({title:'O‘zingiz ko‘rsatgan maosh',body:value(6)});
  }
  const conclusions=insights?[
    {title:'Korxona haqida xulosa',body:insights.company.conclusion},
    {title:'Ish tajribasi haqida xulosa',body:insights.employee.conclusion},
  ]:[];
  if(insights?.satisfaction) facts.push({title:'O‘zi bildirgan qoniqish',body:insights.satisfaction.label+(reportPercent(insights.satisfaction.score)===null?'':' · '+reportPercent(insights.satisfaction.score)+'% / '+insights.satisfaction.score+'/10'),accent:palette.amber});
  columns('Ma’lumotlar va asosiy xulosalar',facts,conclusions);
  if(insights) {
    const dims=insights.situational?.dimensions??[];
    bars('Ishdagi yondashuv: 5 yo‘nalish',dims,'Har yo‘nalish uchun kamida 2 ta baholanadigan javob kerak.');
    const strong=dims.filter(d=>Number.isFinite(d.score)&&d.score>=8).sort((a,b)=>b.score-a.score).slice(0,3);
    const needs=dims.filter(d=>Number.isFinite(d.score)&&d.score<8).sort((a,b)=>a.score-b.score).slice(0,3);
    columns('Kuchli tomonlar va o‘sish nuqtalari',
      strong.length?strong.map(d=>({title:d.title,body:reportPercent(d.score)+'% / '+d.score+'/10 · Asos: '+d.measured+'/'+d.total+' javob.'})):[{title:'Kuchli tomonlar',body:'Yetarli javob yoki 8 balldan yuqori yo‘nalish olinmagan. Qo‘shimcha amaliy misol va suhbat kerak.'}],
      needs.length?needs.map(d=>({title:'Rivojlantirish: '+d.title,body:reportPercent(d.score)+'% / '+d.score+'/10. Aniq ish odati, yordam va qayta fikr olish muddatini kelishing.',accent:palette.amber})):[{title:strong.length?'Keyingi rivojlanish qadami':'Qo‘shimcha ma’lumot kerak',body:strong.length?'Baholangan yo‘nalishlarda 8 balldan past indeks aniqlanmadi. Kuchli javoblarni real ish natijalari va hamkasblar fikri bilan tekshirib boring.':'Kuchli yoki zaif xulosa chiqarish uchun yetarli baholanadigan javob yo‘q.'},{title:'Status nimani anglatadi?',body:profile.note}]);
    if(insights.company.indicators?.length) bars('Korxona sharoitlari: ko‘rsatkichlar',insights.company.indicators,'Bu respondent bildirgan sharoitlar. Korxona haqidagi mustaqil tekshiruv emas.');
    columns('Amaliy tavsiyalar va rivojlanish rejasi',insights.company.recommendations.map((s,i)=>({title:'Korxona · Tavsiya '+(i+1),body:s})),insights.employee.recommendations.map((s,i)=>({title:'Xodim · Qadam '+(i+1),body:s})));
    if(insights.decisionSupport) columns('Keyingi qaror uchun yo‘nalish',[
      {title:insights.decisionSupport.title,body:insights.decisionSupport.conclusion},
      ...(insights.priorities?.length?[{title:'Siz uchun muhim imtiyozlar',body:insights.priorities.join('; ')}]:[]),
    ],insights.decisionSupport.steps.map((s,i)=>({title:'Amaliy qadam '+(i+1),body:s})));
    const ideas=insights.ideas??[], observations=insights.situational?.observations??[];
    if(ideas.length || observations.length) columns('Javoblar va ishtirokchining o‘z takliflari',[
      ...observations.map(o=>({title:'Savol '+o.id+' · '+o.title,body:'«'+o.selected+'»'})),
      ...ideas.filter(i=>i.category==='experience').map(i=>({title:i.title,body:'«'+(session.answers?.[i.question]?.text??i.text)+'»'})),
    ],ideas.filter(i=>i.category!=='experience').map(i=>({title:i.title,body:'«'+(session.answers?.[i.question]?.text??i.text)+'»'})));
    if(insights.kpi) columns('KPI: amaldagi holat va takliflar',insights.kpi.records.map(r=>({title:r.title,body:[...r.choices,r.text].filter(Boolean).join('; ')})),insights.kpi.recommendations.map((s,i)=>({title:'KPI tavsiyasi '+(i+1),body:s})));
  }
  }
  // Optional complete appendix for archival exports; channel PDFs focus on the visual analysis.
  if(model.includeAnswers) flow('Ilova: barcha savollar va javoblar',survey.questions.slice(0,count).map(q=>{const a=session.answers?.[q.id];return {title:'Savol '+q.id,body:q.text+' Javob: '+(a?[...(a.choices??[]),a.text].filter(Boolean).join(' / ')||'Hech biri':'O‘tkazib yuborilgan')};}),'LAYLO / TO‘LIQ JAVOBLAR');
  fresh('Natijadan qanday foydalanamiz?');
  text(insights?.business?'Natijani qanday o‘qiymiz?':'Xulosa → suhbat → amaliy o‘zgarish',44,134,25,true,palette.navy,860,2);
  text(insights?.business?insights.business.methodNote:'Baholar berilgan javoblarga asoslangan rivojlanish indeksidir. Ular kasbiy malaka, klinik tashxis yoki ishga olish bo‘yicha yakuniy hukm emas. O‘tkazilgan va noma’lum javoblar past baho hisoblanmaydi.',44,195,18,false,palette.ink,860);
  text(insights?.business?'O‘tkazilgan va noma’lum javoblar 0 ball hisoblanmaydi. Har yo‘nalishda qamrov alohida ko‘rsatiladi.':'Tavsiyalarni haqiqiy ish misollari va suhbat bilan tekshiring. Bitta o‘zgarishni tanlab, kelishilgan muddatdan so‘ng natijani qayta ko‘rib chiqing.',44,309,18,false,palette.ink,860);
  const channelLink=reportChannelLink(channel), botLink=reportBotLink(model.botUsername);
  if(channelLink) { rect(40,405,428,73,palette.teal,10);text('Yangi tahlillar uchun obuna bo‘ling',59,416,15,true,palette.white,390,1);text(channelLink.username,59,446,18,true,palette.white,390,1);link(channelLink.url,40,405,428,73); }
  const botX=channelLink?492:40, botW=channelLink?428:880;
  rect(botX,405,botW,73,palette.navy,10);text('So‘rovnomani boshlash',botX+19,416,16,true,palette.white,botW-38,1);text(botLink.username,botX+19,446,18,true,palette.white,botW-38,1);link(botLink.url,botX,405,botW,73);
  pages.forEach((p,i)=>{page=p;line(40,499,920,499,palette.line,0.8);text('LAYLO · '+session.token,40,510,9,false,i===0?'#d2ddeb':palette.muted,240,1);text(botLink.username,315,510,9,true,i===0?'#81d9cc':palette.teal,240,1);link(botLink.url,315,506,240,20);text((i+1)+' / '+pages.length,858,510,9,true,i===0?'#d2ddeb':palette.muted,62,1);if(channelLink){text(channelLink.username,575,510,9,true,i===0?'#81d9cc':palette.teal,250,1);link(channelLink.url,575,506,230,20);}});
  // Construct standards-based PDF objects with exact byte offsets and Unicode text maps.
  const objects=[null,'',''];
  const add=value=>{objects.push(typeof value==='string'?pdfEncoder.encode(value):value);return objects.length-1;};
  const fonts=pdfFonts.map((f,i)=>{
    const file=add(pdfStream(fontBytes[i].data,'/Filter /FlateDecode /Length1 '+f.length));
    const map=add(pdfStream(fontBytes[i].map,'/Filter /FlateDecode'));
    const descriptor=add('<< /Type /FontDescriptor /FontName /'+f.name+' /Flags 32 /FontBBox ['+f.bbox.join(' ')+'] /ItalicAngle 0 /Ascent '+f.ascent+' /Descent '+f.descent+' /CapHeight 714 /StemV '+(i?120:80)+' /FontFile2 '+file+' 0 R >>');
    const codes=[...used[i]].sort((a,b)=>a-b);
    const widths=codes.map(c=>c+' ['+(f.glyphs[c]?.[1]??600)+']').join(' ');
    const cid=add('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /'+f.name+' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor '+descriptor+' 0 R /DW 600 /W ['+widths+'] /CIDToGIDMap '+map+' 0 R >>');
    let cmap='/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /LayloUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for(let k=0;k<codes.length;k+=100){const group=codes.slice(k,k+100);cmap+=group.length+' beginbfchar\n'+group.map(c=>'<'+hex(c)+'> <'+hex(c)+'>').join('\n')+'\nendbfchar\n';}
    cmap+='endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    const unicode=add(pdfStream(pdfEncoder.encode(cmap)));
    return add('<< /Type /Font /Subtype /Type0 /BaseFont /'+f.name+' /Encoding /Identity-H /DescendantFonts ['+cid+' 0 R] /ToUnicode '+unicode+' 0 R >>');
  });
  const pageIds=pages.map(p=>{
    const contents=add(pdfStream(pdfEncoder.encode(p.commands.join('\n'))));
    const annotations=p.links.map(l=>add('<< /Type /Annot /Subtype /Link /Rect ['+[l.x,PH-l.y-l.h,l.x+l.w,PH-l.y].map(numeric).join(' ')+'] /Border [0 0 0] /A << /S /URI /URI ('+l.url+') >> >>'));
    return add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+PW+' '+PH+'] /Resources << /Font << /F0 '+fonts[0]+' 0 R /F1 '+fonts[1]+' 0 R >> >> /Contents '+contents+' 0 R'+(annotations.length?' /Annots ['+annotations.map(a=>a+' 0 R').join(' ')+']':'')+' >>');
  });
  objects[1]=pdfEncoder.encode('<< /Type /Catalog /Pages 2 0 R /PageLayout /SinglePage >>');
  objects[2]=pdfEncoder.encode('<< /Type /Pages /Count '+pageIds.length+' /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] >>');
  const info=add('<< /Title '+pdfUnicode(t(identity+' hisoboti'))+' /Author (Laylo HR) /Creator (Laylo survey PDF v1) >>');
  const chunks=[new Uint8Array([37,80,68,70,45,49,46,55,10,37,226,227,207,211,10])], offsets=[0];let length=chunks[0].length;
  for(let id=1;id<objects.length;id++){offsets.push(length);const bytes=pdfJoin([pdfEncoder.encode(id+' 0 obj\n'),objects[id],pdfEncoder.encode('\nendobj\n')]);chunks.push(bytes);length+=bytes.length;}
  const xref=length; chunks.push(pdfEncoder.encode('xref\n0 '+objects.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+objects.length+' /Root 1 0 R /Info '+info+' 0 R >>\nstartxref\n'+xref+'\n%%EOF\n'));
  const bytes=pdfJoin(chunks);
  return { bytes, pages:pages.length, layout, profile };
}
