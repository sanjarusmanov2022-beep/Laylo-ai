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
  return String(text).replace(/https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|@[\w]+|\/[a-z][a-z0-9_]*|\b(?:CSV|KPI|UZS|USD|EUR|ID|API|SHA)\b|[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ'’‘ʻʼ]+/gu, word => {
    if (/^(?:https?:|@|\/)|@/.test(word) || /^(CSV|KPI|UZS|USD|EUR|ID|API|SHA)$/.test(word)) return word;
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

export function surveyStats(survey, sessions) {
  sessions = sessions.filter(s => !s.preview);
  const completed = sessions.filter(s => s.stage === 'done');
  const started = sessions.filter(s => s.stage !== 'intro');
  return {
    started: started.length, completed: completed.length, unfinished: started.length - completed.length,
    questions: survey.questions.map(question => {
      const answers = completed.map(s => s.answers[question.id]).filter(Boolean);
      const counts = new Map((question.options ?? []).map(o => [o, 0]));
      for (const answer of answers) for (const choice of answer.choices ?? []) counts.set(choice, (counts.get(choice) ?? 0) + 1);
      return { question, answered: answers.length, skipped: completed.length - answers.length, custom: answers.filter(a => a.text).length,
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
    rows.push(scriptButton('menu'));
    if (preview) {
      rows.push([{ text: '⬅️ Admin menyusi', callback_data: 'a:exitpreview' }]);
      return send(chat, '🧪 Mijoz rejimi · SINOV\n\nMijozga beriladigan savollarni o‘zingiz sinab ko‘rasiz. Xodim yoki Rahbarni tanlang.\n\nSinov javoblari haqiqiy qatnashuvchilar soni, hisobot va CSV fayliga qo‘shilmaydi. Har ikki rolni alohida tekshirish va boshidan boshlash mumkin.', rows);
    }
    return send(chat, hasSurveys ? 'Assalomu alaykum! 👋 Men Laylo, so‘rovnoma botiman.\n\nFikrlaringizni o‘rganib, kelajakda yaxshi ish sharoiti yaratmoqchimiz. Iltimos, chin dildan javob bering.\n\nO‘zingizga mos bo‘limni tanlang.' : 'Hozircha ochiq so‘rovnoma yo‘q. Keyinroq qayta kiring.', rows);
  }

  async function prompt(chat, survey, session, editMessageId) {
    let text;
    let keyboard;
    if (session.stage === 'intro') {
      text = `${survey.title}\n\n${survey.introduction ?? ''}\n\n${survey.questions.length} ta savol. Har bir javob saqlanadi. Tanaffusdan keyin shu havola orqali davom etishingiz mumkin. Istalgan savolni o‘tkazib yuborish mumkin.\n\nJavoblar so‘rovnoma egasiga va u belgilagan hisobotlar kanali yoki guruhiga yuboriladi. Telegram texnik identifikatorni botga uzatadi. Biz uning o‘rniga tasodifiy maxfiy kalit bilan hosil qilingan belgini saqlaymiz. Avval ism va yosh alohida so‘raladi; ikkalasini ham o‘tkazib yuborish mumkin. Ish joyi nomi yoki boshqa odamlarning shaxsiy ma'lumotlarini yozishingiz shart emas.\n\n«Boshlash» javoblaringizni shu maqsadda saqlashga roziligingizni bildiradi.`;
      keyboard = [[button('Boshlash ✅', session, 'begin')], [{ text: 'Bosh menyu', callback_data: 'home' }]];
    } else if (session.stage === 'name') {
      text = '👤 Ismingiz nima?\n\nIsmingizni xabar qilib yozing. Ism yozish ixtiyoriy; istamasangiz, pastdagi tugmani bosing.';
      keyboard = [[button('Ismsiz davom etish', session, 'skip')]];
    } else if (session.stage === 'age') {
      text = '🎂 Yoshingiz nechada?\n\nYoshingizni raqam bilan yozing. Masalan: 28. Javob berish ixtiyoriy.';
      keyboard = [[button('Yoshni o‘tkazib yuborish', session, 'skip')], [button('⬅️ Ismga qaytish', session, 'back')]];
    } else if (session.stage === 'review') {
      const answered = Object.values(session.answers).filter(Boolean).length;
      text = `Savollar tugadi ✅\n\nJavob berilgan — ${answered}\nO‘tkazilgan — ${survey.questions.length - answered}\n\n«Yuborish»ni bosing. Savollarni ko‘rib chiqish uchun orqaga qaytishingiz mumkin.`;
      keyboard = [[button('Javoblarni yuborish ✅', session, 'submit')], [button('⬅️ Oldingi savol', session, 'back')]];
    } else if (session.stage === 'done') {
      if (session.preview) return send(chat, '🧪 Sinov yakunlandi ✅\n\nJavoblaringiz asosiy hisobotga qo‘shilmadi. Boshqa rolni tekshiring yoki qayta boshlang.', [...previewNavigation(survey.id), scriptButton('menu')]);
      const channel = await storage.get('report-channel');
      const thanks = survey.thanks ?? 'Rahmat! Javoblaringiz saqlandi ✅';
      const channelUrl = channel?.username ? `https://t.me/${channel.username}` : null;
      return send(chat, thanks + (channelUrl ? `\n\n📊 Hisobotni shu kanalda olasiz:\n@${channel.username}\n${channelUrl}` : ''), [
        ...(channelUrl ? [[{ text: '📊 Hisobotlar kanalini ochish', url: channelUrl }]] : []),
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
    const rows = [['So‘rovnoma', 'Javob raqami', 'Ism (ixtiyoriy)', 'Yosh (ixtiyoriy)', 'Holat', 'Savol raqami', 'Savol', 'Javob', 'Summa', 'Valyuta']];
    for (const survey of surveys.values()) {
      if (id !== 'all' && survey.id !== id) continue;
      const sessions = (await sessionList(survey.id)).filter(s => s.stage !== 'intro');
      for (const [i, session] of sessions.entries()) for (const q of survey.questions) rows.push([
        survey.title, i + 1, session.name ?? '', session.age ?? '', session.stage === 'done' ? 'Yakunlangan' : 'Tugallanmagan', q.id, q.text,
        session.stage === 'done' || Object.hasOwn(session.answers, q.id) ? display(session.answers[q.id]) : 'Hali yetib kelmagan',
        session.answers[q.id]?.amount ?? '', session.answers[q.id]?.currency ?? '',
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


  async function channelSettings(chat) {
    const channel = await storage.get('report-channel');
    const pending = (await listStored(storage, 'channel-report:')).length;
    return send(chat, '📨 Hisobotlar kanali\n\n' + (channel ? 'Ulangan: ' + channel.title + (channel.username ? '\n@' + channel.username : '') : 'Hozircha kanal ulanmagan.') + '\n\nSo‘rovnoma tugaganda ism, yosh, yo‘nalish va barcha javoblar yozilgan CSV shu kanalga yuboriladi. Sinov javoblari yuborilmaydi.\nYuborishni kutayotgan hisobotlar: ' + pending, [
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
      await api.call('sendMessage', { chat_id: channel.id, text: '✅ Laylo so‘rovnoma hisobotlari shu yerga keladi. Har bir yakunlangan so‘rovnoma qisqa ma’lumot va to‘liq javoblar fayli bilan yuboriladi.' });
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
    const pending = await listStored(storage, 'channel-report:');
    if (pending.length && await storage.get('report-channel')) await storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...pending.map(([, job]) => job.nextAttemptAt ?? 0))));
    else if (storage.deleteAlarm) await storage.deleteAlarm();
  }
  async function flushChannelReports(force = false) {
    await ready;
    const channel = await storage.get('report-channel');
    if (!channel) return;
    const jobs = (await listStored(storage, 'channel-report:')).filter(([, job]) => force || (job.nextAttemptAt ?? 0) <= Date.now()).slice(0, 10);
    for (const [key, job] of jobs) {
      if (!force && (job.nextAttemptAt ?? 0) > Date.now()) continue;
      if (await storage.get('report-sent:' + job.session.token)) { await storage.delete(key); continue; }
      const { survey, session } = job;
      const rows = [['So‘rovnoma', 'Javob raqami', 'Ism (ixtiyoriy)', 'Yosh (ixtiyoriy)', 'Savol raqami', 'Savol', 'Javob', 'Summa', 'Valyuta']];
      for (const q of survey.questions) rows.push([survey.title, session.token, session.name ?? '', session.age ?? '', q.id, q.text, display(session.answers[q.id]), session.answers[q.id]?.amount ?? '', session.answers[q.id]?.currency ?? '']);
      const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
      const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' }).format(new Date(session.completedAt));
      const caption = '✅ Yangi so‘rovnoma yakunlandi\n\n' + survey.title + '\nIsm: ' + (session.name ?? 'Ko‘rsatilmagan') + '\nYosh: ' + (session.age ?? 'Ko‘rsatilmagan') + '\nJavob berilgan: ' + Object.values(session.answers).filter(Boolean).length + '/' + survey.questions.length + '\nSana: ' + date + ' (Toshkent)\nJavob raqami: ' + session.token + '\n\nBarcha savollar va javoblar faylda.';
      const form = new FormData();
      form.set('chat_id', String(channel.id));
      form.set('caption', toScript(caption, await getScript(ownerId) ?? 'latin'));
      form.set('document', new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'laylo-' + survey.id + '-' + session.token + '.csv');
      try {
        const sent = await api.call('sendDocument', form);
        await storage.put('report-sent:' + session.token, { chatId: channel.id, messageId: sent.message_id, sentAt: new Date().toISOString() });
        await storage.delete(key);
      } catch {
        job.attempts = (job.attempts ?? 0) + 1;
        job.nextAttemptAt = Date.now() + Math.min(60_000 * 2 ** Math.min(job.attempts - 1, 6), 3_600_000);
        await storage.put(key, job);
        if (job.attempts === 1) await send(ownerId, 'Hisobotni kanalga yubora olmadim. Javoblar saqlangan, avtomatik qayta urinaman. Kanal huquqlarini «Hisobotlar kanali» menyusidan tekshirishingiz mumkin.', adminKeyboard()).catch(() => {});
      }
    }
    await scheduleChannelReports();
  }

  async function adminAction(chat, action, id) {
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
    if (['preview', 'trypreview', 'resetpreview', 'exitpreview', 'new'].includes(action)) {
      const actor = await actorKey(ownerId);
      const preview = action !== 'exitpreview' && action !== 'new';
      await storage.put(`preview-mode:${actor}`, preview);
      await storage.put('draft', null);
      await storage.put('channel-setup', false);
      if (action === 'exitpreview') return menu(chat, true);
      if (action === 'preview') return menu(chat, false, true);
      if (action === 'trypreview' || action === 'resetpreview') {
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
    await flushChannelReports();
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
      const [, action, id] = data.split(':');
      return adminAction(chat, action, id);
    }
    const baseActor = await actorKey(user.id);
    const preview = owner && (await storage.get(`preview-mode:${baseActor}`)) === true;
    const actor = preview ? `preview:${baseActor}` : baseActor;
    if (data.startsWith('role:')) return begin(chat, actor, data.slice(5));
    if (data === 'home') return menu(chat, owner && !preview, preview);
    const input = message.text?.trim() ?? '';
    const [commandWithBot, arg] = input.split(/\s+/);
    const command = commandWithBot?.split('@')[0];
    if (!callback) {
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
        if (owner) { await storage.put('draft', null); await storage.put('channel-setup', false); }
        const id = await storage.get(`active:${actor}`);
        const session = id && await storage.get(sessionKey(id, actor));
        if (session && session.stage !== 'done') { session.paused = true; await storage.put(sessionKey(id, actor), session); }
        return send(chat, 'Tanaffus qilamiz. Javoblaringiz saqlandi. Davom etish uchun /survey yoki dastlabki havolani oching.', preview && id ? previewNavigation(id) : owner ? adminKeyboard() : undefined);
      }
      if (owner && ['/report', '/surveyreport', '/export', '/surveys', '/newsurvey'].includes(command)) {
        const action = { '/report': 'report', '/surveyreport': 'report', '/export': 'export', '/surveys': 'list', '/newsurvey': 'new' }[command];
        return adminAction(chat, action, arg ?? 'all');
      }
      if (owner && input && !input.startsWith('/') && await draftInput(chat, input)) return;
      if (command === '/survey') {
        const id = arg ?? await storage.get(`active:${actor}`);
        return id ? begin(chat, actor, id) : menu(chat, false, preview);
      }
      if (input.startsWith('/')) return menu(chat, owner);
    }
    const id = callback ? data.split(':')[1] : await storage.get(`active:${actor}`);
    const survey = surveys.get(id);
    const session = survey && await storage.get(sessionKey(id, actor));
    if (!session) return menu(chat, owner);
    if (!preview && !await isOpen(id)) return send(chat, 'Bu so‘rovnoma hozir yopiq. Javoblaringiz saqlangan.');
    if (Number.isSafeInteger(session.lastUpdate) && update.update_id <= session.lastUpdate) return prompt(chat, survey, session);
    if (callback) {
      const [prefix, , token, revision, action] = data.split(':');
      if (prefix !== 's' || token !== session.token || Number(revision) !== session.revision) return;
      if (session.paused || session.stage === 'done') return;
      if (action === 'pause') { session.paused = true; await storage.put(sessionKey(id, actor), session); return send(chat, 'Javoblaringiz saqlandi. /survey orqali davom etishingiz mumkin.'); }
      if (action === 'begin' && session.stage === 'intro') { session.stage = 'name'; session.revision++; return persist(chat, actor, survey, session, update.update_id); }
      if (action === 'skip' && ['name', 'age'].includes(session.stage)) {
        const field = session.stage;
        delete session[field];
        session.stage = field === 'name' ? 'age' : 'questions';
        session.revision++;
        return persist(chat, actor, survey, session, update.update_id);
      }
      if (action === 'back' && session.stage === 'age') {
        session.stage = 'name'; session.revision++;
        return persist(chat, actor, survey, session, update.update_id);
      }
      if (action === 'submit' && session.stage === 'review') {
        session.stage = 'done'; session.revision++;
        session.completedAt = new Date().toISOString();
        session.lastUpdate = update.update_id;
        const record = { [sessionKey(id, actor)]: session };
        if (!session.preview && await storage.get('report-channel')) record[`channel-report:${id}:${session.token}`] = { survey, session: structuredClone(session), attempts: 0, nextAttemptAt: Date.now() };
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
        return accept(chat, actor, survey, session, { choices }, update.update_id);
      }
      if (/^v\d+$/.test(action) && q.options) {
        const option = q.options[Number(action.slice(1))];
        if (!option) return;
        if (q.type === 'single') return accept(chat, actor, survey, session, { choices: [option] }, update.update_id);
        const selected = session.pending ?? session.answers[q.id]?.choices ?? [];
        if (!selected.includes(option) && q.choose && selected.length >= q.choose) return send(chat, `Ko‘pi bilan ${q.choose} ta tanlang. Belgini olib tashlash uchun qayta bosing.`);
        session.pending = selected.includes(option) ? selected.filter(o => o !== option) : [...selected, option];
        return persist(chat, actor, survey, session, update.update_id, message.message_id);
      }
      return;
    }
    if (session.paused || session.stage === 'done' || session.stage === 'intro' || session.stage === 'review') return prompt(chat, survey, session);
    if (!input || input.length > 1000) return send(chat, 'Javobingizni 1000 belgigacha matnda yozing yoki variantni tanlang.');
    if (session.stage === 'name') {
      if (input.length > 80) return send(chat, 'Ismni 80 belgigacha yozing yoki o‘tkazing.');
      session.name = input; session.stage = 'age'; session.revision++;
      return persist(chat, actor, survey, session, update.update_id);
    }
    if (session.stage === 'age') {
      if (!/^[0-9]{1,3}$/.test(input) || Number(input) < 1 || Number(input) > 120) return send(chat, 'Yoshingizni 1 dan 120 gacha butun son bilan yozing. Masalan: 28. Yoki «Yoshni o‘tkazib yuborish» tugmasini bosing.');
      session.age = Number(input); session.stage = 'questions'; session.revision++;
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
