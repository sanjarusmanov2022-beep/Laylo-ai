import { buildSurveyInsights, renderSurveyInsights } from './survey-insights.mjs';
import { createSurveyPdf } from './survey-pdf.mjs';
import { renderChannelReport, reportChannelLink } from './report-format.mjs';
const encoder = new TextEncoder();

const latinLetters = { a:'а', b:'б', d:'д', f:'ф', g:'г', h:'ҳ', i:'и', j:'ж', k:'к', l:'л', m:'м', n:'н', o:'о', p:'п', q:'қ', r:'р', s:'с', t:'т', u:'у', v:'в', x:'х', y:'й', z:'з', c:'с', w:'в' };
const cyrillicLetters = { а:'a', б:'b', в:'v', г:'g', д:'d', ж:'j', з:'z', и:'i', й:'y', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f', х:'x', ц:'ts', ч:'ch', ш:'sh', щ:'shch', ы:'i', э:'e', ю:'yu', я:'ya', ё:'yo', ў:'o‘', қ:'q', ғ:'g‘', ҳ:'h', ъ:'’', ь:'' };
const apostrophes = "'’‘ʻʼ";
function letterCase(value, original, word) {
  if (original === original.toLowerCase()) return value;
  return word === word.toUpperCase() ? value.toUpperCase() : value.charAt(0).toUpperCase() + value.slice(1);
}
export function toScript(text, script = 'latin') {
  // Keep links, email addresses, bot handles, commands and technical identifiers intact.
  return String(text).replace(/\b[a-f0-9]{10}\b|https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|@[\w]+|\/[a-z][a-z0-9_]*|\b(?:CSV|PDF|KPI|UZS|USD|EUR|ID|API|SHA)\b|[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ'’‘ʻʼ]+/gu, word => {
    if (/^[a-f0-9]{10}$/.test(word) || /^(?:https?:|@|\/)|@/.test(word) || /^(CSV|PDF|KPI|UZS|USD|EUR|ID|API|SHA)$/.test(word)) return word;
    if (script === 'latin') return word.replace(/[А-Яа-яЁёЎўҚқҒғҲҳ]/gu, (char, offset) => {
      const lower = char.toLowerCase();
      const value = lower === 'е' ? (offset === 0 || /[аеиоуэюяёъь]/i.test(word[offset - 1]) ? 'ye' : 'e') : (cyrillicLetters[lower] ?? char);
      return letterCase(value, char, word);
    });
    return word.replace(/o['’‘ʻʼ]|g['’‘ʻʼ]|sh|ch|yo(?!['’‘ʻʼ])|yu|ya|ye|[a-z]|['’‘ʻʼ]/giu, (part, offset) => {
      const lower = part.toLowerCase();
      let value;
      if (lower.length === 2 && apostrophes.includes(lower[1])) value = lower[0] === 'o' ? 'ў' : 'ғ';
      else value = ({ sh:'ш', ch:'ч', yo:'ё', yu:'ю', ya:'я', ye:'е' })[lower]
        ?? (lower === 'e' ? (offset === 0 || /[aeiou'’‘ʻʼ]/i.test(word[offset - 1]) ? 'э' : 'е') : apostrophes.includes(lower) ? 'ъ' : latinLetters[lower] ?? part);
      return letterCase(value, part, word);
    });
  });
}


export function validateSurvey(survey) {
  if (!/^[a-z][a-z0-9_]{0,19}$/.test(survey.id ?? '') || !survey.title?.trim() || survey.title.length > 200) throw new Error('So‘rovnoma nomi yoki ID noto‘g‘ri');
  if (!Array.isArray(survey.sections) || !survey.sections.length || survey.sections.some(s => typeof s !== 'string' || s.length > 200)) throw new Error('Bo‘limlar noto‘g‘ri');
  if (!Array.isArray(survey.questions) || !survey.questions.length || survey.questions.length > 100) throw new Error('1–100 ta savol kiriting');
  for (const [index, q] of survey.questions.entries()) {
    if (q.id !== index + 1 || !q.text?.trim() || q.text.length > 1000 || !survey.sections[q.section - 1]) throw new Error('Savol raqami, matni yoki bo‘limi noto‘g‘ri');
    if (!['text', 'single', 'multi', 'money', 'number'].includes(q.type)) throw new Error('Savol turi noto‘g‘ri');
    if (['single', 'multi'].includes(q.type) && (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 15 || q.options.some(o => typeof o !== 'string' || !o.trim() || o.length > 150) || new Set(q.options).size !== q.options.length)) throw new Error('Javob variantlari noto‘g‘ri');
    if (q.assessment && (q.type !== 'single' || !['communication','accountability','pressure','collaboration','learning'].includes(q.assessment.dimension) || typeof q.assessment.title !== 'string' || q.assessment.title.length > 100 || !Array.isArray(q.assessment.scale) || q.assessment.scale.length !== q.options.length || q.assessment.scale.some(r => (r.score !== null && (!Number.isFinite(r.score) || r.score < 0 || r.score > 10)) || typeof r.tip !== 'string' || r.tip.length > 300))) throw new Error('Vaziyatli savol mezonlari noto‘g‘ri');
    if (q.decision && !['skill_use','alternatives','resolution','satisfaction','kpi_target','kpi_control','bonus_budget','kpi_fairness'].includes(q.decision)) throw new Error('Qaror uchun savol turi noto‘g‘ri');
    if (q.kpi && !['employee_current','preferred_metrics','preferred_conditions','current_types','current_basis','current_example'].includes(q.kpi)) throw new Error('KPI savoli turi noto‘g‘ri');
    if (q.exclusiveOptions && (q.type !== 'multi' || !Array.isArray(q.exclusiveOptions) || !q.exclusiveOptions.length || new Set(q.exclusiveOptions).size !== q.exclusiveOptions.length || q.exclusiveOptions.some(o => !q.options.includes(o)) || (q.choose && q.choose !== 1))) throw new Error('Alohida tanlanadigan variantlar noto‘g‘ri');
    if (q.proposal && (q.type !== 'text' || !['experience','company','reward','development'].includes(q.proposal))) throw new Error('Taklif savoli noto‘g‘ri');
    if (q.choose && (q.type !== 'multi' || !Number.isInteger(q.choose) || q.choose < 1 || q.choose > q.options.length)) throw new Error('Tanlov soni noto‘g‘ri');
  }
  return survey;
}

export function parseAmount(input) {
  const value = toScript(input, 'latin').trim().toLowerCase().replace(/[’‘ʻʼ]/g, "'");
  const match = value.match(/^(\d[\d ]*(?:[.,]\d+)?)\s*(mln|million|ming)?\s*(uzs|so'm|som|usd|dollar|eur|yevro|€|\$)?$/u);
  if (!match) return null;
  const multiplier = { mln: 1_000_000, million: 1_000_000, ming: 1000 }[match[2]] ?? 1;
  const amount = Number(match[1].replace(/ /g, '').replace(',', '.')) * multiplier;
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e15) return null;
  const currency = ['usd', 'dollar', '$'].includes(match[3]) ? 'USD' : ['eur', 'yevro', '€'].includes(match[3]) ? 'EUR' : 'UZS';
  return { amount, currency };
}


export function parsePublicIdentity(input) {
  const value = String(input ?? '').trim().normalize('NFKC').replace(/[–—]/g, '-');
  if (/^[0-9][0-9 -]{0,39}$/.test(value)) return { kind: 'code', value };
  if (value.length >= 2 && value.length <= 80 && /\p{L}/u.test(value) && !/[\n\r\x00-\x1f]/.test(value)) return { kind: 'name', value };
  return null;
}
function publicIdentity(session) { return session.publicIdentity ?? parsePublicIdentity(session.name) ?? { kind: 'unknown', value: 'Ko‘rsatilmagan' }; }
function identityHeading(survey, session) {
  const identity = publicIdentity(session);
  return identity.kind === 'code' ? '🔢 ' + identity.value + ' raqami hisoboti' : (survey.id === 'employers' ? '🏢 ' : '👤 ') + identity.value + ' hisoboti';
}


const sectorLabels = Object.freeze({ public: 'Davlat tashkiloti', private: 'Xususiy sektor', mixed: 'Davlat-xususiy / aralash', nonprofit: 'Nodavlat notijorat tashkiloti', other: 'Boshqa / aniq bilmayman', undisclosed: 'Ko‘rsatishni istamayman' });
function missingProfile(survey, session) {
  if (survey.id === 'employees' && !['named', 'private'].includes(session.workplace?.visibility)) return 'workplace';
  if (['employees', 'employers'].includes(survey.id) && !Object.hasOwn(sectorLabels, session.sector ?? '')) return 'sector';
  return null;
}
function publicWorkplace(survey, session) {
  if (survey.id === 'employers') return publicIdentity(session).kind === 'name' ? publicIdentity(session).value : 'Maxfiy raqam bilan';
  if (session.workplace?.visibility === 'named') return session.workplace.name;
  return session.workplace?.visibility === 'private' ? 'Sir saqlangan' : 'Ko‘rsatilmagan';
}
function profileContinuation(survey, session) {
  const missing = missingProfile(survey, session);
  if (missing) return missing;
  const next = session.profileReturnStage ?? 'questions';
  delete session.profileReturnStage;
  return next;
}

function randomId() { return crypto.randomUUID().replaceAll('-', '').slice(0, 10); }
function display(answer) {
  if (!answer) return 'O‘tkazib yuborilgan';
  return [...(answer.choices ?? []), answer.text].filter(Boolean).join(' / ') || 'Hech biri';
}
function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s]*[=+@\-\t\r]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export async function listStored(storage, prefix) {
  const entries = [];
  let startAfter;
  while (true) {
    const page = await storage.list({ prefix, limit: 100, ...(startAfter ? { startAfter } : {}) });
    entries.push(...page.entries());
    if (page.size < 100) return entries;
    startAfter = [...page.keys()].at(-1);
  }
}


export function splitReportText(text, limit = 3500) {
  if (!Number.isInteger(limit) || limit < 2) throw new Error('Invalid message limit');
  const parts = [];
  let rest = String(text);
  while (rest.length > limit) {
    let end = rest.lastIndexOf('\n', limit - 1) + 1;
    if (end < limit / 2) end = limit;
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    parts.push(rest.slice(0, end)); rest = rest.slice(end);
  }
  if (rest) parts.push(rest);
  return parts;
}
function applicableQuestionCount(survey, session) {
  const original = { employees: 57, employers: 40 }[survey.id];
  return Math.min(survey.questions.length, session.questionCount ?? (session.stage === 'done' && original ? original : survey.questions.length));
}


function surveyReportModel(survey, session, insights, channel) {
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' }).format(new Date(session.completedAt));
  return { survey, session, insights, channel, date, questionCount: applicableQuestionCount(survey, session), identity: publicIdentity(session).value, workplace: publicWorkplace(survey, session), sector: sectorLabels[session.sector] ?? 'Ko‘rsatilmagan' };
}

export function surveyStats(survey, sessions) {
  sessions = sessions.filter(s => !s.preview);
  const completed = sessions.filter(s => s.stage === 'done');
  const started = sessions.filter(s => s.stage !== 'intro');
  return {
    started: started.length, completed: completed.length, unfinished: started.length - completed.length,
    questions: survey.questions.map(question => {
      const eligible = completed.filter(s => applicableQuestionCount(survey, s) >= question.id);
      const answers = eligible.map(s => s.answers[question.id]).filter(Boolean);
      const counts = new Map((question.options ?? []).map(o => [o, 0]));
      for (const answer of answers) for (const choice of answer.choices ?? []) counts.set(choice, (counts.get(choice) ?? 0) + 1);
      return { question, answered: answers.length, skipped: eligible.length - answers.length, custom: answers.filter(a => a.text).length,
        choices: [...counts].map(([label, count]) => ({ label, count, percent: answers.length ? Math.round(count * 1000 / answers.length) / 10 : 0 })),
        money: ['UZS', 'USD', 'EUR'].flatMap(currency => {
          const values = answers.filter(a => a.currency === currency).map(a => a.amount).sort((a, b) => a - b);
          if (!values.length) return [];
          const mid = Math.floor(values.length / 2);
          return [{ currency, count: values.length, min: values[0], max: values.at(-1), median: values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2 }];
        }),
      };
    }),
  };
}

export function createSurveyBot({ storage, api, ownerId, username, definitions }) {
  const surveys = new Map(definitions.map(s => [s.id, validateSurvey(s)]));
  let secret;
  const ready = (async () => {
    secret = await storage.get('secret');
    if (!secret) { secret = crypto.randomUUID(); await storage.put('secret', secret); }
    for (const [, survey] of await listStored(storage, 'custom:')) surveys.set(survey.id, validateSurvey(survey));
  })();
  const scriptCache = new Map();
  async function getScript(chat) {
    if (!scriptCache.has(chat)) scriptCache.set(chat, await storage.get(`script:${await actorKey(chat)}`) ?? null);
    return scriptCache.get(chat);
  }
  async function messagePayload(chat, text, keyboard) {
    const script = await getScript(chat) ?? 'latin';
    const rows = keyboard?.map(row => row.map(b => ({ ...b, text: b.callback_data?.startsWith('script:') ? b.text : toScript(b.text, script) })));
    return { chat_id: chat, text: toScript(text, script), link_preview_options: { is_disabled: true }, ...(rows ? { reply_markup: { inline_keyboard: rows } } : {}) };
  }
  const send = async (chat, text, keyboard) => api.call('sendMessage', await messagePayload(chat, text, keyboard));
  const scriptButton = target => [{ text: '🔤 Lotin / Кирилл', callback_data: `script:choose:${target}` }];
  async function scriptMenu(chat, target = { type: 'menu' }) {
    await storage.put(`script-next:${await actorKey(chat)}`, target);
    return api.call('sendMessage', { chat_id: chat, text: 'Qaysi yozuv sizga qulay?\nҚайси ёзув сизга қулай?', reply_markup: { inline_keyboard: [
      [{ text: 'Lotincha', callback_data: 'script:latin' }, { text: 'Кириллча', callback_data: 'script:cyrillic' }],
      [{ text: '📨 Hisobotni qayta yuborish / Ҳисоботни қайта юбориш', callback_data: 'myreports' }],
    ] } });
  }
  async function scriptAction(chat, data, owner) {
    const actor = await actorKey(chat);
    if (data.startsWith('script:choose:')) {
      const type = data.split(':')[2];
      if (!['menu', 'resume', 'admin'].includes(type)) return;
      return scriptMenu(chat, { type });
    }
    const script = data.slice(7);
    if (!['latin', 'cyrillic'].includes(script)) return;
    await storage.put(`script:${actor}`, script);
    scriptCache.set(chat, script);
    const target = await storage.get(`script-next:${actor}`) ?? { type: 'menu' };
    await storage.delete(`script-next:${actor}`);
    const preview = owner && await storage.get(`preview-mode:${actor}`) === true;
    const activeActor = preview ? `preview:${actor}` : actor;
    if (target.type === 'begin') return begin(chat, activeActor, target.survey);
    if (target.type === 'resume') {
      const id = await storage.get(`active:${activeActor}`);
      if (id) return begin(chat, activeActor, id);
    }
    if (target.type === 'admin' && owner) return menu(chat, true);
    return menu(chat, owner && !preview, preview);
  }
  const link = id => `https://t.me/${username}?start=${id}`;
  async function actorKey(userId) {
    const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(`${secret}:${userId}`));
    return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
  }
  const isPreviewActor = actor => actor.startsWith('preview:');
  const sessionKey = (id, actor) => isPreviewActor(actor) ? `preview-session:${id}:${actor.slice(8)}` : `session:${id}:${actor}`;
  const isOpen = async id => (await storage.get(`open:${id}`)) !== false;
  const sessionList = async id => (await listStored(storage, `session:${id}:`)).map(([, session]) => session).filter(session => !session.preview);
  const button = (text, session, action) => ({ text, callback_data: `s:${session.survey}:${session.token}:${session.revision}:${action}` });
  const adminKeyboard = () => [
    [{ text: '📊 Qatnashuvchilar va hisobot', callback_data: 'a:report:all' }],
    [{ text: '📑 PDF hisobotlar', callback_data: 'a:pdfs:all' }],
    [{ text: '📥 Barcha javoblar · CSV', callback_data: 'a:export:all' }],
    [{ text: '📋 So‘rovnomalar va havolalar', callback_data: 'a:list' }],
    [{ text: '📨 Hisobotlar kanali', callback_data: 'a:channel' }],
    [{ text: '🧪 Mijoz rejimi', callback_data: 'a:preview' }],
    [{ text: '➕ Yangi so‘rovnoma', callback_data: 'a:new' }],
    scriptButton('admin'),
  ];

  const previewNavigation = id => [
    [{ text: '🔄 Boshidan boshlash', callback_data: `a:resetpreview:${id}` }],
    [{ text: '👥 Xodim / Rahbar tanlash', callback_data: 'a:preview' }],
    [{ text: '⬅️ Admin menyusi', callback_data: 'a:exitpreview' }],
  ];

  async function menu(chat, owner = false, preview = false) {
    if (!owner && !await getScript(chat)) return scriptMenu(chat);
    if (owner) return send(chat, 'Laylo · Admin menyusi\n\nSo‘rovnomalar, qatnashuvchilar va natijalarni shu yerdan boshqarasiz.', adminKeyboard());
    const rows = [];
    for (const survey of surveys.values()) if (preview || await isOpen(survey.id)) rows.push([{ text: survey.id === 'employees' ? '👤 Xodim' : survey.id === 'employers' ? '👔 Rahbar / ish beruvchi' : survey.title.slice(0, 60), callback_data: preview ? `a:trypreview:${survey.id}` : `role:${survey.id}` }]);
    const hasSurveys = rows.length > 0;
    rows.push([{ text: '📨 Hisobotni qayta yuborish', callback_data: preview ? 'a:previewreports' : 'myreports' }]);
    rows.push(scriptButton('menu'));
    if (preview) {
      rows.push([{ text: '⬅️ Admin menyusi', callback_data: 'a:exitpreview' }]);
      return send(chat, '🧪 Mijoz rejimi · SINOV\n\nMijozga beriladigan savollarni o‘zingiz sinab ko‘rasiz. Xodim yoki Rahbarni tanlang.\n\nSinov javoblari haqiqiy qatnashuvchilar soni, hisobot va CSV fayliga qo‘shilmaydi. Har ikki rolni alohida tekshirish va boshidan boshlash mumkin.', rows);
    }
    return send(chat, hasSurveys ? 'Assalomu alaykum! 👋 Men Laylo, so‘rovnoma botiman.\n\nFikrlaringizni o‘rganib, kelajakda yaxshi ish sharoiti yaratmoqchimiz. Iltimos, chin dildan javob bering.\n\nO‘zingizga mos bo‘limni tanlang.' : 'Hozircha ochiq so‘rovnoma yo‘q. Keyinroq qayta kiring.', rows);
  }


  async function previewReportNotice(chat) {
    return send(chat,'🧪 Bu mijoz ko‘rinishidagi SINOV rejimi.\n\nSinov hisobotlari kanalga yuborilmaydi va haqiqiy qatnashuvchilar soniga qo‘shilmaydi. Haqiqiy tugallangan hisobotni kanalga qayta yuborish uchun quyidagi ro‘yxatdan tanlang.',[
      [{text:'📑 Haqiqiy hisobotlar',callback_data:'a:pdfs:all'}],
      [{text:'👥 Sinov rollariga qaytish',callback_data:'a:preview'}],
    ]);
  }
  async function resendCustomerReport(chat,actor,survey,session,updateId) {
    const channel = await storage.get('report-channel'), channelLink = reportChannelLink(channel);
    if (!channel) return send(chat,'Hisobotlar kanali hozircha ulanmagan. Javoblaringiz saqlangan.');
    if ((!Number.isSafeInteger(session.lastUpdate) || updateId>session.lastUpdate) && (!session.lastChannelResendAt || Date.now()-session.lastChannelResendAt>=60_000)) {
      const deliveryKey = 'participant:'+session.token+':'+updateId;
      session.lastChannelResendAt=Date.now(); session.lastUpdate=updateId; session.revision++;
      await storage.put({[sessionKey(survey.id,actor)]:session,['channel-report:'+deliveryKey]:{survey,session:structuredClone(session),insights:buildSurveyInsights(survey,session),deliveryKey,deliveryChatId:channel.id,attempts:0,nextAttemptAt:0}});
      await scheduleChannelReports();await flushChannelReports(true);
    }
    return send(chat,'📊 Hisobotingizni kanalda ko‘rasiz. Hisobotdagi belgingiz: '+publicIdentity(session).value+(channelLink?'\n\n'+channelLink.username+'\n'+channelLink.url:''),[
      ...(channelLink?[[{text:'📊 Hisobotni kanalda ko‘rish',url:channelLink.url}]]:[]),
      [{text:'Bosh menyu',callback_data:'home'}],
    ]);
  }
  async function customerReports(chat,actor,updateId,id,token) {
    const entries=[];
    for (const survey of surveys.values()) {
      const session=await storage.get(sessionKey(survey.id,actor));
      if (session?.stage==='done' && !session.preview) entries.push({survey,session});
    }
    if (!entries.length) return send(chat,'Hali yakunlangan so‘rovnomangiz yo‘q. Avval Xodim yoki Rahbar savollarini tugatib, «Javoblarni yuborish»ni bosing. Shundan keyin hisobotni kanalga qayta yubora olasiz.',[[{text:'👥 So‘rovnomani tanlash',callback_data:'home'}]]);
    if (id) {
      const entry=entries.find(e=>e.survey.id===id && e.session.token===token);
      if (!entry) return send(chat,'Bu hisobot topilmadi. Bosh menyudagi «Hisobotni qayta yuborish» tugmasini bosing.');
      return resendCustomerReport(chat,actor,entry.survey,entry.session,updateId);
    }
    if (entries.length===1) return resendCustomerReport(chat,actor,entries[0].survey,entries[0].session,updateId);
    return send(chat,'📨 Qaysi hisobotingizni kanalga qayta yuboramiz?',entries.map(({survey,session})=>[{text:(survey.id==='employees'?'👤 Xodim':survey.id==='employers'?'👔 Rahbar':survey.title.slice(0,30))+' · '+publicIdentity(session).value.slice(0,35),callback_data:'myreport:'+survey.id+':'+session.token}]));
  }

  async function prompt(chat, survey, session, editMessageId) {
    let text;
    let keyboard;
    if (session.stage === 'intro') {
      text = `${survey.title}\n\n${survey.introduction ?? ''}\n\n${survey.questions.length} ta savol. Har bir javob saqlanadi. Tanaffusdan keyin shu havola orqali davom etishingiz mumkin. Istalgan savolni o‘tkazib yuborish mumkin.\n\nHisobotni tanishingiz uchun ism, korxona nomi yoki o‘zingiz tanlagan maxfiy raqam kiritish shart. Yoshingizni ko‘rsatish ixtiyoriy. Xodimdan ishxona nomi alohida so‘raladi: uni yozish yoki sir saqlash mumkin. Tashkilot sektori ham alohida tanlanadi. Oshkor yozgan nomlaringiz va javoblaringiz so‘rovnoma egasiga hamda hisobotlar kanaliga yuboriladi. Maxfiy qolishini istagan ismlarni boshqa yozma javoblarga ham kiritmang.\n\n«Boshlash» javoblaringizni shu maqsadda saqlashga roziligingizni bildiradi.`;
      keyboard = [[button('Boshlash ✅', session, 'begin')], [{ text: 'Bosh menyu', callback_data: 'home' }]];
    } else if (session.stage === 'name') {
      text = survey.id === 'employers'
        ? '🏢 Korxonangizni hisobotda qanday ko‘rsatamiz?\n\nKorxona nomini YOKI o‘zingiz tanlagan maxfiy raqamni yozing.\nMasalan: KORA GROUP yoki 789-456-85.\n\nKanalda aynan shu nom yoki raqam ko‘rinadi. Nom yoki raqam kiritish shart.'
        : '👤 Hisobotda qanday nom yoki raqam bilan ko‘rinasiz?\n\nIsm-familiyangizni YOKI o‘zingiz tanlagan maxfiy raqamni yozing.\nMasalan: Ali Valiyev yoki 789-856-78.\n\nKanalda aynan shu nom yoki raqam ko‘rinadi. Nom yoki raqam kiritish shart.';
      keyboard = [];
    } else if (session.stage === 'age') {
      text = '🎂 Yoshingiz nechada?\n\nYoshingizni raqam bilan yozing. Masalan: 28. Javob berish ixtiyoriy.';
      keyboard = [[button('Yoshni o‘tkazib yuborish', session, 'skip')], [button('⬅️ Nom yoki raqamga qaytish', session, 'back')]];
    } else if (session.stage === 'workplace') {
      text = '🏢 Qaysi korxona yoki tashkilotda ishlaysiz?\n\nIshxonangiz nomini yozishingiz mumkin. Ko‘rsatsangiz, hisobotda va kanalda chiqadi.\n\nNomini oshkor qilish ixtiyoriy. Istamasangiz, «Ishxonam nomi sir qolsin»ni bosing.';
      keyboard = [[button('🔒 Ishxonam nomi sir qolsin', session, 'workplace_private')], [button('⬅️ Yoshga qaytish', session, 'profile_back')]];
    } else if (session.stage === 'sector') {
      text = '🏛 ' + (survey.id === 'employers' ? 'Korxonangiz' : 'Ishxonangiz') + ' qaysi sektorga kiradi?\n\nMos variantni tanlang. Oshkor qilishni istamasangiz, oxirgi variantni bosing.';
      keyboard = Object.entries(sectorLabels).map(([value, label]) => [button(label, session, 'sector_' + value)]);
      keyboard.push([button(survey.id === 'employees' ? '⬅️ Ishxona nomiga qaytish' : '⬅️ Yoshga qaytish', session, 'profile_back')]);
    } else if (session.stage === 'review') {
      const answered = Object.values(session.answers).filter(Boolean).length;
      text = `Savollar tugadi ✅\n\nJavob berilgan — ${answered}\nO‘tkazilgan — ${survey.questions.length - answered}\n\n«Yuborish»ni bosing. Savollarni ko‘rib chiqish uchun orqaga qaytishingiz mumkin.`;
      keyboard = [[button('Javoblarni yuborish ✅', session, 'submit')], [button('⬅️ Oldingi savol', session, 'back')]];
    } else if (session.stage === 'done') {
      if (session.preview) {
        const channel = await storage.get('report-channel');
        const model = surveyReportModel(survey, session, buildSurveyInsights(survey, session), channel);
        const script = await getScript(chat) ?? 'latin';
        await api.call('sendMessage', { chat_id: chat, text: '🧪 ' + toScript('SINOV', script) + '\n\n' + renderChannelReport(model, text => toScript(text, script)), parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
        const pdf = createSurveyPdf(model, text => toScript(text, script));
        const form = new FormData(); form.set('chat_id', String(chat));
        form.set('document', new Blob([pdf.bytes], { type: 'application/pdf' }), 'laylo-preview-' + survey.id + '-' + session.token + '.pdf');
        form.set('caption', toScript('🧪 SINOV · PDF tahlil. Asosiy hisobot va kanalga qo‘shilmaydi.', script));
        await api.call('sendDocument', form);
        return send(chat, '🧪 Sinov yakunlandi ✅\n\nJavoblaringiz asosiy hisobotga qo‘shilmadi. Boshqa rolni tekshiring yoki qayta boshlang.', [[{text:'📨 Hisobotni qayta yuborish',callback_data:'a:previewreports'}], ...previewNavigation(survey.id), scriptButton('menu')]);
      }
      const channel = await storage.get('report-channel');
      const thanks = survey.thanks ?? 'Rahmat! Javoblaringiz saqlandi ✅';
      const channelUrl = channel?.username ? `https://t.me/${channel.username}` : null;
      return send(chat, thanks + '\n\nHisobotdagi belgingiz: ' + publicIdentity(session).value + (channelUrl ? `\n\n📊 Hisobotni shu kanalda olasiz:\n@${channel.username}\n${channelUrl}` : ''), [
        ...(channelUrl ? [[{ text: '📊 Hisobotlar kanalini ochish', url: channelUrl }], [button('📨 Hisobotni qayta yuborish', session, 'resendreport')]] : []),
        scriptButton('menu'),
      ]);
    } else {
      const q = survey.questions[session.index];
      const selected = session.pending ?? session.answers[q.id]?.choices ?? [];
      const options = q.options ?? [];
      const hint = q.type === 'multi' ? (q.choose ? `Eng muhim ${q.choose} ta variantni belgilang, so‘ng «Davom etish»ni bosing.` : 'Bir nechta javob tanlash mumkin. Sizga mos barcha variantlarni bittadan bosib belgilang, so‘ng «Davom etish»ni bosing. Belgini olib tashlash uchun yana bosing.')
        : q.type === 'money' ? 'Summa va valyutani yozing. Masalan, 3 500 000 UZS yoki 3,5 mln. Valyuta yozilmasa, so‘m hisoblanadi.'
          : q.type === 'number' ? 'Butun son kiriting. Masalan, 5 yoki 30.' : q.type === 'single' ? 'Variantni tanlang yoki javobingizni yozing.' : 'Javobingizni matnda yozing.';
      text = `Savol ${q.id}/${survey.questions.length}\n\n${q.text}\n\n${hint}`;
      if (q.type === 'multi') text += `\n\n✅ Tanlandi: ${selected.length}${q.choose ? `/${q.choose}` : ''} ta`;
      if (options.length) text += '\n\n' + options.map((o, i) => `${q.type === 'multi' ? (selected.includes(o) ? '✅ ' : '☐ ') : ''}${i + 1}. ${o}`).join('\n');
      if (session.answers[q.id]) text += `\n\nAvvalgi javobingiz\n${display(session.answers[q.id])}`;
      keyboard = options.map((o, i) => [button(`${q.type === 'multi' ? (selected.includes(o) ? '✅ ' : '☐ ') : ''}${i + 1}. ${o.slice(0, 46)}`, session, `v${i}`)]);
      if (q.type === 'multi') {
        const confirm = [button(`Davom etish ➡️ (${selected.length} ta tanlandi)`, session, 'next')];
        keyboard.unshift(confirm);
        keyboard.push(confirm, [button('Hech biri', session, 'none')]);
      }
      const navigation = [button('O‘tkazib yuborish', session, 'skip')];
      if (session.index > 0) navigation.unshift(button('⬅️ Orqaga', session, 'back'));
      keyboard.push(navigation, [button('⏸ Keyinroq davom etaman', session, 'pause')]);
    }
    if (session.preview) {
      text = '🧪 Mijoz rejimi · SINOV\n\n' + text;
      keyboard.push(...previewNavigation(survey.id));
    }
    keyboard.push(scriptButton('resume'));
    const payload = await messagePayload(chat, text, keyboard);
    if (editMessageId) {
      try { return await api.call('editMessageText', { ...payload, message_id: editMessageId }); }
      catch (error) { if (error.status !== 400) throw error; }
    }
    return api.call('sendMessage', payload);
  }

  async function begin(chat, actor, id) {
    if (!await getScript(chat)) return scriptMenu(chat, { type: 'begin', survey: id });
    const survey = surveys.get(id);
    if (!survey) return send(chat, 'Bu so‘rovnoma topilmadi. /start orqali menyuni oching.');
    if (!isPreviewActor(actor) && !await isOpen(id)) return send(chat, 'Bu so‘rovnoma hozir yopiq. Javoblaringiz saqlangan.');
    let session = await storage.get(sessionKey(id, actor));
    if (!session) session = { survey: id, token: randomId(), revision: 0, stage: 'intro', index: 0, answers: {}, paused: false };
    if (session.stage === 'review' && session.index < survey.questions.length) { session.stage = 'questions'; session.revision++; }
    if (session.stage !== 'done') session.questionCount = survey.questions.length;
    const profile = missingProfile(survey, session);
    if (profile && ['questions', 'review'].includes(session.stage)) {
      session.profileReturnStage = session.stage; session.stage = profile; session.revision++;
    }
    if (publicIdentity(session).kind === 'unknown' && !['intro', 'name', 'done'].includes(session.stage)) {
      session.identityReturnStage = session.stage;
      session.stage = 'name';
      session.revision++;
    }
    session.preview = isPreviewActor(actor);
    session.paused = false;
    await storage.put(sessionKey(id, actor), session);
    await storage.put(`active:${actor}`, id);
    return prompt(chat, survey, session);
  }

  async function persist(chat, actor, survey, session, updateId, editMessageId) {
    session.lastUpdate = updateId;
    await storage.put(sessionKey(survey.id, actor), session);
    return prompt(chat, survey, session, editMessageId);
  }

  async function accept(chat, actor, survey, session, answer, updateId) {
    session.questionCount = survey.questions.length;
    session.answers[survey.questions[session.index].id] = answer;
    session.index++;
    session.pending = undefined;
    session.revision++;
    if (session.index === survey.questions.length) session.stage = 'review';
    return persist(chat, actor, survey, session, updateId);
  }

  async function report(chat, id = 'all') {
    const selected = id === 'all' ? [...surveys.values()] : [surveys.get(id)].filter(Boolean);
    if (!selected.length) return send(chat, 'So‘rovnoma topilmadi.');
    for (const survey of selected) {
      const stats = surveyStats(survey, await sessionList(survey.id));
      const lines = [survey.title, `Boshlagan — ${stats.started}`, `Yakunlagan — ${stats.completed}`, `Davom etayotgan — ${stats.unfinished}`, '\nFoizlar har bir savolga javob bergan, so‘rovnomani yakunlaganlar orasida hisoblandi. Ko‘p tanlovli savolda foizlar yig‘indisi 100 dan oshishi mumkin.'];
      for (const q of stats.questions) {
        lines.push(`\n${q.question.id}. ${q.question.text}`, `Javob — ${q.answered} · O‘tkazilgan — ${q.skipped}`);
        lines.push(...q.choices.map(c => `${c.label} — ${c.count} (${c.percent}%)`));
        if (q.custom) lines.push(`Yozma javob — ${q.custom}`);
        for (const m of q.money) lines.push(`${m.currency} · ${m.count} javob · eng kam ${m.min.toLocaleString('en-US')} · mediana ${m.median.toLocaleString('en-US')} · eng ko‘p ${m.max.toLocaleString('en-US')}`);
      }
      let chunk = '';
      for (const line of lines) {
        if ((chunk + '\n' + line).length > 3500) { await send(chat, chunk); chunk = ''; }
        chunk += (chunk ? '\n' : '') + line;
      }
      if (chunk) await send(chat, chunk);
    }
    return send(chat, 'Yozma javoblar va to‘liq natijalarni CSV faylida olishingiz mumkin.', adminKeyboard());
  }

  async function exportCsv(chat, id = 'all') {
    const rows = [['So‘rovnoma', 'Javob raqami', 'Nom yoki maxfiy raqam', 'Yosh (ixtiyoriy)', 'Holat', 'Savol raqami', 'Savol', 'Javob', 'Summa', 'Valyuta', 'Ishxona nomi / maxfiylik', 'Sektor']];
    for (const survey of surveys.values()) {
      if (id !== 'all' && survey.id !== id) continue;
      const sessions = (await sessionList(survey.id)).filter(s => s.stage !== 'intro');
      for (const [i, session] of sessions.entries()) for (const q of survey.questions.slice(0, applicableQuestionCount(survey, session))) rows.push([
        survey.title, i + 1, publicIdentity(session).value, session.age ?? '', session.stage === 'done' ? 'Yakunlangan' : 'Tugallanmagan', q.id, q.text,
        session.stage === 'done' || Object.hasOwn(session.answers, q.id) ? display(session.answers[q.id]) : 'Hali yetib kelmagan',
        session.answers[q.id]?.amount ?? '', session.answers[q.id]?.currency ?? '', publicWorkplace(survey, session), sectorLabels[session.sector] ?? 'Ko‘rsatilmagan',
      ]);
    }
    const bytes = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    if (encoder.encode(bytes).length > 40_000_000) return send(chat, 'Fayl hajmi katta. Har bir so‘rovnomani alohida yuklab oling.');
    const form = new FormData();
    form.set('chat_id', String(chat));
    form.set('document', new Blob([bytes], { type: 'text/csv;charset=utf-8' }), `laylo-${id}.csv`);
    form.set('caption', 'Yozma javoblar, sonlar va tanlangan variantlar. Tugallanmagan javoblar alohida belgilangan.');
    return api.call('sendDocument', form);
  }

  async function adminList(chat) {
    for (const survey of surveys.values()) {
      const open = await isOpen(survey.id);
      const stats = surveyStats(survey, await sessionList(survey.id));
      await send(chat, `${survey.title}\n\n${survey.questions.length} savol · ${open ? 'Ochiq' : 'Yopiq'}\nBoshlagan ${stats.started} · Yakunlagan ${stats.completed}\n\nUlashish uchun\n${link(survey.id)}`, [
        [{ text: 'Hisobot', callback_data: `a:report:${survey.id}` }, { text: 'CSV olish', callback_data: `a:export:${survey.id}` }],
        [{ text: open ? 'So‘rovnomani yopish' : 'So‘rovnomani ochish', callback_data: `a:${open ? 'close' : 'open'}:${survey.id}` }],
      ]);
    }
  }



  const pausedKeyboard = (surveyId, preview, owner) => [
    [{ text: '▶️ Davom ettirish', callback_data: preview ? 'a:resumepreview:' + surveyId : 'resume:' + surveyId }],
    ...(preview ? previewNavigation(surveyId) : [[{ text: 'Bosh menyu', callback_data: 'home' }]]),
    ...(owner && !preview ? [[{ text: '⬅️ Admin menyusi', callback_data: 'a:exitpreview' }]] : []),
  ];
  async function scanChannelReports(force = false, limit = 10) {
    let count = 0, nextAttemptAt = Infinity, startAfter;
    const jobs = [];
    while (true) {
      const page = await storage.list({ prefix: 'channel-report:', limit: 100, ...(startAfter ? { startAfter } : {}) });
      for (const [key, job] of page) {
        count++;
        nextAttemptAt = Math.min(nextAttemptAt, job.nextAttemptAt ?? 0);
        if (jobs.length < limit && (force || (job.nextAttemptAt ?? 0) <= Date.now())) jobs.push([key, job]);
      }
      if (page.size < 100) return { count, nextAttemptAt, jobs };
      startAfter = [...page.keys()].at(-1);
    }
  }

  async function channelSettings(chat) {
    const channel = await storage.get('report-channel');
    const pending = (await scanChannelReports(false, 0)).count;
    return send(chat, '📨 Hisobotlar kanali\n\n' + (channel ? 'Ulangan: ' + channel.title + (channel.username ? '\n@' + channel.username : '') : 'Hozircha kanal ulanmagan.') + '\n\nSo‘rovnoma tugaganda nom yoki maxfiy raqam, xulosa, foizli diagrammalar, profil statusi va tavsiyali PDF hisobot shu kanalga yuboriladi. Sinov javoblari yuborilmaydi.\nYuborishni kutayotgan hisobotlar: ' + pending, [
      [{ text: channel ? 'Kanalni almashtirish' : 'Kanalni ulash', callback_data: 'a:channelsetup' }],
      ...(channel ? [[{ text: 'Qayta yuborishga urinish', callback_data: 'a:channelretry' }, { text: 'Kanalni uzish', callback_data: 'a:channeloff' }]] : []),
      [{ text: '⬅️ Admin menyusi', callback_data: 'a:exitpreview' }],
    ]);
  }
  async function configureReportChannel(chat, target) {
    const match = String(target).trim().match(/^(?:https?:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,})(?:\/\d+)?\/?$/);
    if (match) target = '@' + match[1];
    if (!/^@[A-Za-z][A-Za-z0-9_]{4,}$/.test(String(target)) && !/^-\d{5,}$/.test(String(target))) return send(chat, 'Kanalning @username yoki t.me havolasini yozing. Yopiq kanaldan xabarni aynan shu chatga forward qiling.');
    let channel;
    try {
      channel = await api.call('getChat', { chat_id: String(target) });
      if (!['channel', 'group', 'supergroup'].includes(channel.type)) throw new Error('Not a channel or group');
      const me = await api.call('getMe', {});
      const botMember = await api.call('getChatMember', { chat_id: channel.id, user_id: me.id });
      const ownerMember = await api.call('getChatMember', { chat_id: channel.id, user_id: ownerId });
      if (!['creator', 'administrator'].includes(ownerMember.status)) return send(chat, 'Bu kanal yoki guruhda siz administrator bo‘lishingiz kerak. Oldingi ulanish o‘zgarmadi.');
      if (!['creator', 'administrator'].includes(botMember.status) || (channel.type === 'channel' && botMember.can_post_messages === false)) return send(chat, 'Layloni shu kanalga administrator qiling va xabar joylash huquqini bering, keyin qayta yuboring.');
      await api.call('sendMessage', { chat_id: channel.id, text: '✅ Laylo so‘rovnoma hisobotlari shu yerga keladi. Har bir yakunlangan so‘rovnoma qisqa tahlil va diagrammali PDF hisobot bilan yuboriladi.' });
    } catch {
      return send(chat, 'Kanalga ulana olmadim. Laylo kanalda administrator ekanini va xabar joylash huquqi borligini tekshiring. Yopiq kanal bo‘lsa, undan xabar forward qiling. Oldingi ulanish o‘zgarmadi.');
    }
    await storage.put('report-channel', { id: channel.id, title: channel.title, username: channel.username ?? null, type: channel.type });
    await storage.put('channel-setup', false);
    await flushChannelReports(true);
    return send(chat, '✅ Hisobotlar kanali ulandi: ' + channel.title + '\n\nEndi yakunlangan yangi so‘rovnomalar shu yerga avtomatik yuboriladi. Admin menyusidagi hisobot va CSV ham ishlaydi.', adminKeyboard());
  }
  async function scheduleChannelReports() {
    if (!storage.setAlarm) return;
    const pending = await scanChannelReports(false, 0);
    if (pending.count && await storage.get('report-channel')) await storage.setAlarm(Math.max(Date.now() + 1000, pending.nextAttemptAt));
    else if (storage.deleteAlarm) await storage.deleteAlarm();
  }
  async function flushChannelReports(force = false) {
    await ready;
    const channel = await storage.get('report-channel');
    if (!channel) return;
    const { jobs } = await scanChannelReports(force);
    for (const [key, job] of jobs) {
      if (!force && (job.nextAttemptAt ?? 0) > Date.now()) continue;
      if (await storage.get('report-sent:' + (job.deliveryKey ?? job.session.token))) { await storage.delete(key); continue; }
      if (job.deliveryChatId !== undefined && job.deliveryChatId !== channel.id) {
        job.summaryMessageIds = [];
        delete job.summaryMessageId;
        delete job.summaryChunks;
        delete job.summaryFormat;
      }
      job.deliveryChatId = channel.id;
      await storage.put(key, job);
      const { survey, session } = job;
      const script = session.script ?? 'latin';
      const insights = job.insights ?? buildSurveyInsights(survey, session);
      const model = surveyReportModel(survey, session, insights, channel);
      const channelLink = reportChannelLink(channel);
      try {
        if (!job.summaryChunks) {
          job.summaryChunks = [renderChannelReport(model, text => toScript(text, script))];
          job.summaryFormat = 'HTML';
          job.summaryMessageIds = job.summaryMessageId ? [job.summaryMessageId] : [];
          await storage.put(key, job);
        }
        job.summaryMessageIds ??= [];
        for (let i = job.summaryMessageIds.length; i < job.summaryChunks.length; i++) {
          const summary = await api.call('sendMessage', {
            chat_id: channel.id, text: job.summaryChunks[i],
            ...(job.summaryFormat === 'HTML' ? { parse_mode: 'HTML' } : {}),
            ...(channelLink ? { reply_markup: { inline_keyboard: [[{ text: toScript('📊 Kanalga obuna bo‘lish', script), url: channelLink.url }]] } } : {}),
            link_preview_options: { is_disabled: true },
          });
          job.summaryMessageIds.push(summary.message_id);
          job.summaryMessageId ??= summary.message_id;
          await storage.put(key, job);
        }
        const pdf = createSurveyPdf(model, text => toScript(text, script));
        const form = new FormData(); form.set('chat_id', String(channel.id));
        form.set('document', new Blob([pdf.bytes], { type: 'application/pdf' }), 'laylo-' + survey.id + '-' + session.token + '.pdf');
        form.set('caption', toScript('📑 ' + model.identity + ' — diagrammali PDF tahlil\nHisobot ID: ' + session.token + (channelLink ? '\n\n📊 Yangi tahlillar uchun obuna bo‘ling: ' + channelLink.username + '\n' + channelLink.url : ''), script));
        const sent = await api.call('sendDocument', form);
        await storage.put('report-sent:' + (job.deliveryKey ?? session.token), { chatId: channel.id, messageId: sent.message_id, sentAt: new Date().toISOString() });
        await storage.delete(key);
      } catch {
        job.attempts = (job.attempts ?? 0) + 1;
        job.nextAttemptAt = Date.now() + Math.min(60_000 * 2 ** Math.min(job.attempts - 1, 6), 3_600_000);
        await storage.put(key, job);
        if (job.attempts === 1) await send(ownerId, 'Hisobotni kanalga to‘liq yubora olmadim. Javoblar saqlangan, avtomatik qayta urinaman. Kanal huquqlarini «Hisobotlar kanali» menyusidan tekshirishingiz mumkin.', adminKeyboard()).catch(() => {});
      }
    }
    await scheduleChannelReports();
  }


  async function completedPdfEntries() {
    const entries = [];
    for (const survey of surveys.values()) for (const session of await sessionList(survey.id)) {
      if (session.stage === 'done') entries.push({ survey, session });
    }
    return entries.sort((a,b) => String(b.session.completedAt).localeCompare(String(a.session.completedAt)));
  }
  async function pdfList(chat, offset = 0) {
    offset = Number.isSafeInteger(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
    const entries = await completedPdfEntries();
    const rows = entries.slice(offset,offset+10).map(({survey,session}) => [{ text: '📑 ' + publicIdentity(session).value.slice(0,35) + ' · ' + (survey.id === 'employers' ? 'Rahbar' : 'Xodim'), callback_data: 'a:pdf:' + survey.id + ':' + session.token }]);
    if (offset+10<entries.length) rows.push([{text:'Keyingi hisobotlar ➡️',callback_data:'a:pdfs:all:'+(offset+10)}]);
    rows.push([{text:'⬅️ Admin menyusi',callback_data:'a:exitpreview'}]);
    return send(chat, entries.length ? '📑 Saqlangan PDF hisobotlar\n\nIshtirokchini tanlang. PDF shaxsiy chatingizga keladi. Kanalga qayta yuborish uchun keyingi tugmani bosing.\nJami: ' + entries.length : 'Hozircha yakunlangan haqiqiy so‘rovnoma yo‘q. Sinov hisobotlari bu ro‘yxatga kirmaydi.',rows);
  }
  async function savedPdf(chat, id, token, toChannel = false, requestId) {
    const survey = surveys.get(id);
    if (!survey || !/^[a-f0-9]{10}$/.test(token ?? '')) return send(chat,'Hisobot topilmadi. /pdf orqali ro‘yxatni oching.');
    const session = (await sessionList(id)).find(s=>s.stage==='done' && s.token===token);
    if (!session) return send(chat,'Hisobot topilmadi. /pdf orqali ro‘yxatni oching.');
    const channel = await storage.get('report-channel');
    const insights = buildSurveyInsights(survey,session);
    if (toChannel) {
      if (!channel) return send(chat,'Avval «Hisobotlar kanali» menyusidan kanalni ulang.');
      if (!Number.isSafeInteger(requestId)) return;
      const deliveryKey = 'manual:' + token + ':' + requestId;
      const key = 'channel-report:' + deliveryKey;
      if (!await storage.get('report-sent:' + deliveryKey) && !await storage.get(key)) await storage.put(key,{ survey,session:structuredClone(session),insights,deliveryKey,deliveryChatId:channel.id,attempts:0,nextAttemptAt:0 });
      await scheduleChannelReports();
      await flushChannelReports(true);
      return send(chat,await storage.get('report-sent:' + deliveryKey) ? '✅ PDF hisobot va yangi uslubdagi post kanalga qayta yuborildi. Ishtirokchilar soni o‘zgarmadi.' : 'Hisobot qayta yuborish navbatiga saqlandi. Vaqtinchalik xatoda avtomatik yana uriniladi.',adminKeyboard());
    }
    const model = surveyReportModel(survey,session,insights,channel), script = session.script ?? 'latin';
    const pdf = createSurveyPdf(model,text=>toScript(text,script));
    const form = new FormData();form.set('chat_id',String(chat));
    form.set('document',new Blob([pdf.bytes],{type:'application/pdf'}),'laylo-'+id+'-'+token+'.pdf');
    form.set('caption',toScript('📑 '+model.identity+' — PDF tahlil\nHisobot ID: '+token,script));
    await api.call('sendDocument',form);
    return send(chat,'PDF tayyor. Kanalga ham qayta yuborish kerak bo‘lsa, quyidagi tugmani bosing.',[
      ...(channel?[[{text:'📨 Kanalga qayta yuborish',callback_data:'a:pdfchannel:'+id+':'+token}]]:[]),
      [{text:'📑 PDF hisobotlar',callback_data:'a:pdfs:all'},{text:'⬅️ Admin menyusi',callback_data:'a:exitpreview'}],
    ]);
  }

  async function adminAction(chat, action, id, token, requestId) {
    if (action === 'previewreports') return previewReportNotice(chat);
    if (action === 'pdfs') return pdfList(chat,token);
    if (action === 'pdf' || action === 'pdfchannel') return savedPdf(chat,id,token,action==='pdfchannel',requestId);
    if (action === 'channel') return channelSettings(chat);
    if (action === 'channelsetup') {
      await storage.put('draft', null);
      await storage.put('channel-setup', true);
      return send(chat, 'Hisobotlar kanalining @username yoki t.me havolasini yuboring. Kanal yopiq bo‘lsa, undan bitta xabarni shu chatga forward qiling. Siz ham, Laylo ham kanalda administrator bo‘lishingiz kerak. Bekor qilish: /cancel.');
    }
    if (action === 'channeloff') { await storage.put('report-channel', null); await storage.put('channel-setup', false); await scheduleChannelReports(); return channelSettings(chat); }
    if (action === 'channelretry') { await flushChannelReports(true); return channelSettings(chat); }
    if (action === 'report') return report(chat, id);
    if (action === 'export') return exportCsv(chat, id);
    if (action === 'list') return adminList(chat);
    if (['preview', 'trypreview', 'resumepreview', 'resetpreview', 'exitpreview', 'new'].includes(action)) {
      const actor = await actorKey(ownerId);
      const preview = action !== 'exitpreview' && action !== 'new';
      await storage.put(`preview-mode:${actor}`, preview);
      await storage.put('draft', null);
      await storage.put('channel-setup', false);
      if (action === 'exitpreview') return menu(chat, true);
      if (action === 'preview') return menu(chat, false, true);
      if (action === 'trypreview' || action === 'resumepreview' || action === 'resetpreview') {
        if (action === 'resetpreview') await storage.delete(sessionKey(id, `preview:${actor}`));
        return begin(chat, `preview:${actor}`, id);
      }
    }
    if (action === 'new') {
      await storage.put('draft', { id: `s${randomId()}`, questions: [], stage: 'title' });
      return send(chat, 'Yangi so‘rovnoma nomini yozing. Bekor qilish uchun /cancel.');
    }
    if (action === 'publish') {
      const draft = await storage.get('draft');
      if (!draft?.title || !draft.questions.length) return send(chat, 'Avval nom va kamida bitta savol kiriting.');
      const survey = validateSurvey({ id: draft.id, title: draft.title, sections: ['Savollar'], questions: draft.questions });
      await storage.put(`custom:${survey.id}`, survey);
      surveys.set(survey.id, survey);
      await storage.put('draft', null);
      return send(chat, `So‘rovnoma tayyor. ${survey.questions.length} ta savol.\n\n${link(survey.id)}`, adminKeyboard());
    }
    if (['open', 'close'].includes(action) && surveys.has(id)) {
      await storage.put(`open:${id}`, action === 'open');
      return send(chat, action === 'open' ? 'So‘rovnoma ochildi.' : 'So‘rovnoma yopildi. Yig‘ilgan javoblar saqlangan.', adminKeyboard());
    }
    return menu(chat, true);
  }

  async function draftInput(chat, text) {
    const draft = await storage.get('draft');
    if (!draft) return false;
    if (draft.stage === 'title') {
      if (text.length > 200) { await send(chat, 'Nomni 200 belgigacha qisqartiring.'); return true; }
      draft.title = text;
      draft.stage = 'questions';
      await storage.put('draft', draft);
      await send(chat, 'Savollarni bittadan yuboring.\n\nMatnli javob uchun savolning o‘zini yozing. Tugmali savol uchun shu ko‘rinishda yozing\nTushlik beriladimi? | Ha | Yo‘q | Qisman\n\nTugatgach «Tayyor» tugmasini bosing.', [[{ text: 'Tayyor ✅', callback_data: 'a:publish' }]]);
      return true;
    }
    const [question, ...options] = text.split('|').map(s => s.trim());
    const q = { id: draft.questions.length + 1, section: 1, text: question, type: options.length ? 'single' : 'text', ...(options.length ? { options } : {}) };
    try { validateSurvey({ id: draft.id, title: draft.title, sections: ['Savollar'], questions: [...draft.questions, q] }); }
    catch (error) { await send(chat, error.message); return true; }
    draft.questions.push(q);
    await storage.put('draft', draft);
    await send(chat, `${q.id}-savol saqlandi. Keyingi savolni yuboring yoki tugating.`, [[{ text: 'Tayyor ✅', callback_data: 'a:publish' }]]);
    return true;
  }

  async function handle(update) {
    await ready;
    const callback = update.callback_query;
    const message = callback?.message ?? update.message;
    const user = callback?.from ?? message?.from;
    if (message?.chat?.type !== 'private' || message.chat.id !== user?.id) return;
    const chat = message.chat.id;
    const owner = user.id === ownerId;
    if (callback) await api.call('answerCallbackQuery', { callback_query_id: callback.id }).catch(() => {});
    const data = callback?.data ?? '';
    if (data.startsWith('script:')) return scriptAction(chat, data, owner);
    if (data.startsWith('a:')) {
      if (!owner) return;
      const [, action, id, token] = data.split(':');
      await storage.delete(`script-next:${await actorKey(user.id)}`);
      return adminAction(chat, action, id, token, update.update_id);
    }
    const baseActor = await actorKey(user.id);
    const preview = owner && (await storage.get(`preview-mode:${baseActor}`)) === true;
    const actor = preview ? `preview:${baseActor}` : baseActor;
    if (data==='myreports' || data.startsWith('myreport:')) {
      if (preview) return previewReportNotice(chat);
      const [,id,token]=data.split(':');
      return customerReports(chat,baseActor,update.update_id,id,token);
    }
    if (data.startsWith('resume:')) return begin(chat, actor, data.slice(7));
    if (data.startsWith('role:')) return begin(chat, actor, data.slice(5));
    if (data === 'home') return menu(chat, owner && !preview, preview);
    const input = message.text?.trim() ?? '';
    const [commandWithBot, arg] = input.split(/\s+/);
    const command = commandWithBot?.split('@')[0];
    if (!callback) {
      if (command === '/reports') {
        await storage.delete('script-next:'+baseActor);
        if (owner) return pdfList(chat);
        return customerReports(chat,baseActor,update.update_id);
      }
      if (command === '/menu') {
        await storage.delete('script-next:'+baseActor);
        return menu(chat,owner && !preview,preview);
      }
      if (owner && command === '/pdf') {
        if (!arg) return pdfList(chat);
        const entries = (await completedPdfEntries()).filter(e=>e.session.token===arg);
        return entries.length===1 ? savedPdf(chat,entries[0].survey.id,arg) : send(chat,'Hisobot ID topilmadi. /pdf orqali ro‘yxatni oching.');
      }
      if (owner && /^(hisobot(?:ni|lar(?:ni)?)?\s+qayta\s+yubor(?:ing)?|pdf\s+hisobot(?:lar)?)$/iu.test(toScript(input,'latin'))) return pdfList(chat);
      if (owner && command === '/reportchannel') return arg ? configureReportChannel(chat, arg) : channelSettings(chat);
      if (owner && await storage.get('channel-setup') && !input.startsWith('/')) {
        const forwarded = message.forward_origin?.type === 'channel' ? message.forward_origin.chat : message.forward_from_chat;
        return configureReportChannel(chat, forwarded?.id ?? input);
      }
      if (command === '/script') return scriptMenu(chat, { type: 'resume' });
      if (command === '/start' || command === '/help' || command === '/admin') {
        await storage.delete(`script-next:${baseActor}`);
        if (owner) {
          await storage.put('draft', null);
          await storage.put('channel-setup', false);
          await storage.put(`preview-mode:${baseActor}`, false);
        }
        if (command === '/start') return scriptMenu(chat, arg ? { type: 'begin', survey: arg } : { type: 'menu' });
        return menu(chat, owner);
      }
      if (command === '/cancel') {
        await storage.delete(`script-next:${baseActor}`);
        if (owner) { await storage.put('draft', null); await storage.put('channel-setup', false); }
        const id = await storage.get(`active:${actor}`);
        const session = id && await storage.get(sessionKey(id, actor));
        if (session && session.stage !== 'done') { session.paused = true; await storage.put(sessionKey(id, actor), session); }
        return send(chat, 'Tanaffus qilamiz. Javoblaringiz saqlandi. Davom etish tugmasi yoki /survey orqali qaytasiz.', id ? pausedKeyboard(id, preview, owner) : owner ? adminKeyboard() : undefined);
      }
      if (owner && ['/report', '/surveyreport', '/export', '/surveys', '/newsurvey'].includes(command)) {
        const action = { '/report': 'report', '/surveyreport': 'report', '/export': 'export', '/surveys': 'list', '/newsurvey': 'new' }[command];
        return adminAction(chat, action, arg ?? 'all');
      }
      if (!input.startsWith('/')) {
        const pendingScript = await storage.get(`script-next:${baseActor}`);
        if (pendingScript) {
          if (/^lotincha$/iu.test(input)) return scriptAction(chat, 'script:latin', owner);
          if (/^(кириллча|kirilcha|kirillcha)$/iu.test(input)) return scriptAction(chat, 'script:cyrillic', owner);
          return scriptMenu(chat, pendingScript);
        }
      }
      if (owner && input && !input.startsWith('/') && await draftInput(chat, input)) return;
      if (command === '/survey') {
        await storage.delete(`script-next:${baseActor}`);
        const id = arg ?? await storage.get(`active:${actor}`);
        return id ? begin(chat, actor, id) : menu(chat, false, preview);
      }
      if (input.startsWith('/')) return menu(chat, owner);
    }
    const id = callback ? data.split(':')[1] : await storage.get(`active:${actor}`);
    const survey = surveys.get(id);
    const session = survey && await storage.get(sessionKey(id, actor));
    if (!session) return menu(chat, owner);
    if (!preview && session.stage !== 'done' && !await isOpen(id)) return send(chat, 'Bu so‘rovnoma hozir yopiq. Javoblaringiz saqlangan.');
    if (session.stage === 'review' && session.index < survey.questions.length) {
      session.stage = 'questions'; session.questionCount = survey.questions.length; session.revision++;
      return persist(chat, actor, survey, session, update.update_id);
    }
    const profile = missingProfile(survey, session);
    if (profile && ['questions', 'review'].includes(session.stage)) {
      session.profileReturnStage = session.stage; session.stage = profile; session.revision++;
      return persist(chat, actor, survey, session, update.update_id);
    }
    if (publicIdentity(session).kind === 'unknown' && !['intro', 'name', 'done'].includes(session.stage)) {
      session.identityReturnStage = session.stage; session.stage = 'name'; session.revision++;
      return persist(chat, actor, survey, session, update.update_id);
    }
    if (Number.isSafeInteger(session.lastUpdate) && update.update_id <= session.lastUpdate) return prompt(chat, survey, session);
    if (callback) {
      const [prefix, , token, revision, action] = data.split(':');
      if (prefix !== 's' || token !== session.token || Number(revision) !== session.revision) return;
      if (action === 'resendreport' && session.stage === 'done' && !preview) return resendCustomerReport(chat,actor,survey,session,update.update_id);
      if (session.paused || session.stage === 'done') return;
      if (action === 'pause') { session.paused = true; await storage.put(sessionKey(id, actor), session); return send(chat, 'Javoblaringiz saqlandi. Tayyor bo‘lganda davom ettirish tugmasini bosing.', pausedKeyboard(id, preview, owner)); }
      if (action === 'begin' && session.stage === 'intro') { session.stage = 'name'; session.revision++; return persist(chat, actor, survey, session, update.update_id); }
      if (action === 'skip' && session.stage === 'name') return send(chat, 'Nom yoki maxfiy raqam kiritish shart. Masalan: 789-856-78.');
      if (action === 'skip' && session.stage === 'age') {
        delete session.age;
        session.stage = profileContinuation(survey, session);
        session.revision++;
        return persist(chat, actor, survey, session, update.update_id);
      }
      if (action === 'back' && session.stage === 'age') {
        session.stage = 'name'; session.revision++;
        return persist(chat, actor, survey, session, update.update_id);
      }
      if (session.stage === 'workplace' && (action === 'workplace_private' || action === 'skip')) {
        session.workplace = { visibility: 'private' };
        session.stage = profileContinuation(survey, session); session.revision++;
        return persist(chat, actor, survey, session, update.update_id);
      }
      if (session.stage === 'sector' && (action.startsWith('sector_') || action === 'skip')) {
        const sector = action === 'skip' ? 'undisclosed' : action.slice(7);
        if (!Object.hasOwn(sectorLabels, sector)) return;
        session.sector = sector; session.stage = profileContinuation(survey, session); session.revision++;
        return persist(chat, actor, survey, session, update.update_id);
      }
      if (action === 'profile_back' && ['workplace', 'sector'].includes(session.stage)) {
        session.stage = session.stage === 'sector' && survey.id === 'employees' ? 'workplace' : 'age';
        session.revision++;
        return persist(chat, actor, survey, session, update.update_id);
      }
      if (action === 'submit' && session.stage === 'review') {
        session.stage = 'done'; session.revision++;
        session.questionCount = survey.questions.length;
        session.completedAt = new Date().toISOString();
        session.script = await getScript(chat) ?? 'latin';
        session.insights = buildSurveyInsights(survey, session);
        session.lastUpdate = update.update_id;
        const record = { [sessionKey(id, actor)]: session };
        const reportChannel = !session.preview && await storage.get('report-channel');
        if (reportChannel) record[`channel-report:${id}:${session.token}`] = { survey, session: structuredClone(session), insights: session.insights, deliveryChatId: reportChannel.id, attempts: 0, nextAttemptAt: Date.now() };
        await storage.put(record);
        await scheduleChannelReports();
        await prompt(chat, survey, session);
        if (session.preview) return;
        await flushChannelReports();
        const stats = surveyStats(survey, await sessionList(id));
        await send(ownerId, `Yangi so‘rovnoma yakunlandi ✅\n${survey.title}\n\nJami yakunlagan — ${stats.completed}\nDavom etayotgan — ${stats.unfinished}`, adminKeyboard()).catch(() => {});
        return;
      }
      if (action === 'back' && ['questions', 'review'].includes(session.stage) && session.index > 0) {
        session.stage = 'questions'; session.index--; session.pending = undefined; session.revision++;
        return persist(chat, actor, survey, session, update.update_id);
      }
      if (session.stage !== 'questions') return;
      const q = survey.questions[session.index];
      if (action === 'skip') return accept(chat, actor, survey, session, null, update.update_id);
      if (action === 'none' && q.type === 'multi') return accept(chat, actor, survey, session, { choices: [], text: 'Hech biri' }, update.update_id);
      if (action === 'next' && q.type === 'multi') {
        const choices = session.pending ?? session.answers[q.id]?.choices ?? [];
        if (!choices.length || (q.choose && choices.length !== q.choose)) return send(chat, q.choose ? `${q.choose} ta variantni tanlang yoki savolni o‘tkazing.` : 'Variant tanlang yoki «Hech biri»ni bosing.');
        if (choices.some(o => q.exclusiveOptions?.includes(o)) && choices.length > 1) return send(chat, 'Bir-biriga zid variantlar tanlangan. Belgilarni tekshirib, qayta tanlang.');
        return accept(chat, actor, survey, session, { choices }, update.update_id);
      }
      if (/^v\d+$/.test(action) && q.options) {
        const option = q.options[Number(action.slice(1))];
        if (!option) return;
        if (q.type === 'single') return accept(chat, actor, survey, session, { choices: [option] }, update.update_id);
        const selected = session.pending ?? session.answers[q.id]?.choices ?? [];
        if (!selected.includes(option) && q.choose && selected.length >= q.choose) return send(chat, `Ko‘pi bilan ${q.choose} ta tanlang. Belgini olib tashlash uchun qayta bosing.`);
        session.pending = selected.includes(option) ? selected.filter(o => o !== option)
          : q.exclusiveOptions?.includes(option) ? [option]
          : [...selected.filter(o => !q.exclusiveOptions?.includes(o)), option];
        return persist(chat, actor, survey, session, update.update_id, message.message_id);
      }
      return;
    }
    if (session.paused) return send(chat, 'So‘rovnoma tanaffusda. Javoblaringiz saqlangan. Davom ettirish tugmasini bosing.', pausedKeyboard(id, preview, owner));
    if (session.stage === 'done' || session.stage === 'intro' || session.stage === 'review') return prompt(chat, survey, session);
    if (session.stage === 'name') {
      const identity = parsePublicIdentity(input);
      if (!identity) return send(chat, 'Nom yoki maxfiy raqam kiriting. Nom 2–80 belgidan, raqam esa ko‘pi bilan 40 ta raqam, bo‘shliq yoki tiredan iborat bo‘lsin. Masalan: 789-856-78.');
      const codeKey = value => `public-code:${survey.id}:${value.replace(/[ -]/g, '')}`;
      if (identity.kind === 'code' && !preview) {
        const reserved = await storage.get(codeKey(identity.value));
        if (reserved && reserved !== session.token) return send(chat, 'Bu maxfiy raqam allaqachon band. O‘zingiz taniydigan boshqa raqam kiriting.');
        await storage.put(codeKey(identity.value), session.token);
      }
      if (session.publicIdentity?.kind === 'code' && !preview && (identity.kind !== 'code' || codeKey(session.publicIdentity.value) !== codeKey(identity.value))) {
        const oldKey = codeKey(session.publicIdentity.value);
        if (await storage.get(oldKey) === session.token) await storage.delete(oldKey);
      }
      session.publicIdentity = identity;
      delete session.name;
      session.stage = session.identityReturnStage ?? 'age';
      delete session.identityReturnStage;
      session.revision++;
      return persist(chat, actor, survey, session, update.update_id);
    }
    if (!input || input.length > 1000) return send(chat, 'Javobingizni 1000 belgigacha matnda yozing yoki variantni tanlang.');
    if (session.stage === 'age') {
      if (!/^[0-9]{1,3}$/.test(input) || Number(input) < 1 || Number(input) > 120) return send(chat, 'Yoshingizni 1 dan 120 gacha butun son bilan yozing. Masalan: 28. Yoki «Yoshni o‘tkazib yuborish» tugmasini bosing.');
      session.age = Number(input); session.stage = profileContinuation(survey, session); session.revision++;
      return persist(chat, actor, survey, session, update.update_id);
    }
    if (session.stage === 'workplace') {
      const workplace = input.trim();
      if (workplace.length > 150 || !/[\p{L}\p{N}]/u.test(workplace) || /[\n\r\x00-\x1f]/.test(workplace)) return send(chat, 'Ishxona nomini 150 belgigacha bir qatorda yozing yoki «Ishxonam nomi sir qolsin»ni bosing.');
      session.workplace = { visibility: 'named', name: workplace };
      session.stage = profileContinuation(survey, session); session.revision++;
      return persist(chat, actor, survey, session, update.update_id);
    }
    if (session.stage === 'sector') {
      const value = toScript(input, 'latin').toLowerCase();
      const sector = Object.entries(sectorLabels).find(([id, label]) => id === value || label.toLowerCase() === value)?.[0] ?? ({ 'davlat':'public', 'xususiy':'private', 'aralash':'mixed', 'notijorat':'nonprofit', 'boshqa':'other', 'sir qolsin':'undisclosed' })[value];
      if (!sector) return send(chat, 'Sektorni pastdagi tugmalardan tanlang. Oshkor qilishni istamasangiz «Ko‘rsatishni istamayman»ni bosing.');
      session.sector = sector; session.stage = profileContinuation(survey, session); session.revision++;
      return persist(chat, actor, survey, session, update.update_id);
    }
    const q = survey.questions[session.index];
    let extra = {};
    if (q.type === 'money') {
      extra = parseAmount(input);
      if (!extra) return send(chat, 'Summani raqamda yozing. Masalan, 3 500 000 UZS yoki 3,5 mln.');
    }
    if (q.type === 'number') {
      if (!/^\d{1,9}$/.test(input)) return send(chat, 'Butun son yozing. Masalan, 5 yoki 30.');
      extra = { number: Number(input) };
    }
    return accept(chat, actor, survey, session, { text: input, ...extra }, update.update_id);
  }
  return { handle, ready, flushChannelReports };
}
