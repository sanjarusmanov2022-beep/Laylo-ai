// Versioned, deterministic survey indicators. Identity, age and salary amounts never affect scores.
const answer = (session, id) => session.answers?.[id];
const choices = (session, id) => answer(session, id)?.choices ?? [];
const first = (session, id) => choices(session, id)[0];
const yes = { 'Ha': 10, 'Qisman': 5, 'Yo‘q': 0 };
const frequency = { 'Har doim': 10, 'Ko‘pincha': 7, "Ba'zan": 4, 'Deyarli hech qachon': 1 };
const overtime = { 'Hech qachon': 10, 'Kamdan-kam': 8, "Ba'zan": 5, 'Tez-tez': 2, 'Har kuni': 0 };
function metric(session, id, title, values, tip, weight = 1) {
  const value = first(session, id);
  const score = value !== undefined ? values[value] : undefined;
  return { id, title, score: Number.isFinite(score) ? score : null, value, tip, weight };
}
function index(metrics, minimum = 3) {
  const valid = metrics.filter(m => m.score !== null);
  const weight = valid.reduce((sum, m) => sum + m.weight, 0);
  return { score: valid.length >= minimum ? Math.round(valid.reduce((sum, m) => sum + m.score * m.weight, 0) / weight * 10) / 10 : null, measured: valid.length, total: metrics.length };
}
function unique(items, limit = 3) { return [...new Set(items.filter(Boolean))].slice(0, limit); }
function companySummary(score) {
  if (score === null) return 'Ish sharoitlariga umumiy baho berish uchun yetarli ko‘rsatkich olinmagan. Mavjud javoblar asosidagi tavsiyalar quyida.';
  if (score >= 8) return 'Javoblarda barqaror va qo‘llab-quvvatlovchi ish muhitining bir nechta kuchli tomoni ko‘rinadi. Shu sharoitlarni izchil saqlash foydali.';
  if (score >= 6) return 'Ish sharoitlarining yaxshi tomonlari bor. Ayrim jarayonlarni yaxshilash xodimlar tajribasini yanada qulay qilishi mumkin.';
  return 'Javoblarda ish sharoitlari bo‘yicha e’tibor kutayotgan jihatlar ko‘rinadi. Eng zarur o‘zgarishlarni ketma-ket rejalashtirish foydali.';
}
function experienceSummary(score) {
  if (score === null) return 'Xodimning ish tajribasi ko‘rsatkichlarini baholash uchun yetarli javob yo‘q. Berilgan fikrlar baribir muhim va tavsiyalarda hisobga olinadi.';
  if (score >= 8) return 'Javoblaringizda jamoa, e’tirof yoki rivojlanish bilan bog‘liq ijobiy tajribalar ko‘rinadi. Sizga foyda berayotgan sharoitlarni saqlab qolish muhim.';
  if (score >= 6) return 'Ish tajribangizda ijobiy tomonlar ham, e’tibor kutayotgan ehtiyojlar ham bor. Siz uchun eng muhim o‘zgarishlarni aniq aytish foydali bo‘ladi.';
  return 'Javoblaringiz ayrim ehtiyojlaringiz yetarlicha qondirilmayotganini ko‘rsatmoqda. O‘z fikringizni bildirish va sizga mos sharoitlarni muhokama qilish muhim.';
}

const dimensionLabels = { communication: 'Ochiq muloqot', accountability: 'Mas’uliyat va adolat', pressure: 'Bosimda ishni tashkil qilish', collaboration: 'Jamoa bilan hamkorlik', learning: 'O‘rganish va tashabbus' };
const ideaLabels = { experience: 'Amaliy tajribangiz', company: 'Korxona uchun taklifingiz', reward: 'Bonus va imtiyoz taklifingiz', development: 'Rivojlanish taklifingiz' };
function excerpt(text, length = 130) { const chars = Array.from(String(text).replace(/\s+/g, ' ').trim()); return chars.length > length ? chars.slice(0, length - 1).join('') + '…' : chars.join(''); }
export function buildSituationalInsights(survey, session) {
  const questions = survey.questions.filter(q => q.assessment);
  if (!questions.length) return null;
  const evaluated = [];
  let answered = 0;
  for (const q of questions) {
    const response = answer(session, q.id);
    if (response) answered++;
    const option = q.options.indexOf(response?.choices?.[0]);
    const rule = q.assessment.scale[option];
    if (!rule || rule.score === null) continue;
    evaluated.push({ id: q.id, title: q.assessment.title, dimension: q.assessment.dimension, score: rule.score, weight: 1, tip: rule.tip, selected: q.options[option] });
  }
  const dimensions = Object.entries(dimensionLabels).map(([id, title]) => {
    const related = evaluated.filter(e => e.dimension === id);
    return { id, title, ...index(related, 2), total: questions.filter(q => q.assessment.dimension === id).length };
  });
  const total = index(evaluated, 8);
  if (dimensions.filter(d => d.score !== null).length < 3) total.score = null;
  const weakest = [...evaluated].filter(e => e.score < 8).sort((a, b) => a.score - b.score || a.id - b.id);
  const strongest = [...evaluated].filter(e => e.score >= 8).sort((a, b) => b.score - a.score || a.id - b.id);
  const positiveDimensions = dimensions.filter(d => d.score !== null && d.score >= 8).sort((a, b) => b.score - a.score).slice(0, 2);
  const attention = [...dimensions].filter(d => d.score !== null && d.score < 8).sort((a, b) => a.score - b.score)[0];
  let conclusion = total.score === null ? 'Umumiy vaziyatli xulosa uchun kamida 8 ta baholanadigan javob va 3 yo‘nalish bo‘yicha yetarli javob kerak.' : 'Tanlagan javoblaringiz ishdagi yondashuvingizni muhokama qilish uchun asos beradi.';
  if (positiveDimensions.length) conclusion += ' Kuchli ko‘ringan yo‘nalishlar: ' + positiveDimensions.map(d => d.title.toLowerCase()).join(', ') + '.';
  if (attention) conclusion += ' Rivojlantirish uchun birinchi yo‘nalish: ' + attention.title.toLowerCase() + '.';
  const observations = unique([...weakest.slice(0, 2), ...strongest.slice(0, 1)].map(e => e.id), 3).map(id => evaluated.find(e => e.id === id));
  const contextualCompanyTips = {
    communication: 'Xodimlar savol va e’tirozini hurmat bilan ayta oladigan alohida suhbat va aniq murojaat tartibini yo‘lga qo‘ying.',
    accountability: 'Xato haqida erta xabar berish, ma’lumotni tekshirish va natijaga qo‘shilgan hissani tan olish tartibini jamoa bilan kelishing.',
    pressure: 'Bosim paytida xodimlarga ustuvorlik, yordam va tanaffusni kelishish uchun aniq imkoniyat bering.',
    collaboration: 'Vazifa, vakolat, yordam va jamoa qaroriga e’tiroz bildirish chegaralarini birga aniqlashtiring.',
    learning: 'Yangi usul va takliflarni o‘qitish, kichik sinov hamda xotirjam fikr-mulohaza bilan qo‘llab-quvvatlang.',
  };
  const contextualEmployeeTips = {
    communication: 'Rahbar bilan suhbatga aniq misol, savol va sizga kerakli keyingi qadamni tayyorlab boring.',
    accountability: 'Vazifa va natija bo‘yicha kelishuvlarni yozib, xato yoki noaniqlikni erta aniqlashtiring.',
    pressure: 'Ish hajmi va sifatga xavfni erta aytib, ustuvorlik va kerakli yordamni rahbar bilan kelishing.',
    collaboration: 'Jamoada vazifa, yordam va mustaqil qaror chegaralarini oldindan aniqlashtirib oling.',
    learning: 'O‘z taklifingizni kichik sinov, foyda mezoni va qayta fikr olish muddati bilan tayyorlang.',
  };
  const important = weakest.slice(0, 3);
  const companyRecommendations = survey.id === 'employers' ? important.map(e => e.tip) : important.map(e => contextualCompanyTips[e.dimension]);
  const employeeRecommendations = survey.id === 'employees' ? important.map(e => e.tip) : important.map(e => contextualEmployeeTips[e.dimension]);
  if (!important.length && evaluated.length) {
    companyRecommendations.push('Vaziyatli savollardagi ijobiy yondashuvlarni kundalik ish qoidasi va amaliy misollar orqali mustahkamlang.');
    employeeRecommendations.push('Tanlagan yondashuvlaringizni haqiqiy vaziyatlarda sinab, natija va olingan fikrlarni qayd qilib boring.');
  }
  return { title: survey.id === 'employers' ? 'Rahbarlik yondashuvi' : 'Vaziyatlardagi ish yondashuvi', ...total, total: questions.length, answered, dimensions, conclusion, observations, companyRecommendations: unique(companyRecommendations), employeeRecommendations: unique(employeeRecommendations) };
}


function decisionQuestion(survey, key) { return survey.questions.find(q => q.decision === key); }
function decisionValue(survey, session, key) {
  const q = decisionQuestion(survey, key);
  if (!q) return undefined;
  const a = answer(session, q.id);
  return a?.choices?.[0] ?? (q.options.includes(a?.text?.trim()) ? a.text.trim() : undefined);
}
function satisfactionAnswer(survey, session) {
  const q = decisionQuestion(survey, 'satisfaction');
  if (!q || !answer(session, q.id)) return null;
  const value = decisionValue(survey, session, 'satisfaction');
  const scores = { 'Juda qoniqaman': 10, 'Asosan qoniqaman': 8, 'Hislarim aralash / o‘rtacha': 5, 'Asosan noroziman': 2, 'Juda noroziman': 0 };
  return { score: Number.isFinite(scores[value]) ? scores[value] : null, label: value ?? excerpt(answer(session, q.id).text ?? '') };
}
export function buildDecisionSupport(survey, session, companyScore = null) {
  if (survey.id === 'employers') {
    const q = decisionQuestion(survey, 'kpi_target');
    const targets = q ? choices(session, q.id) : [];
    const plans = {
      'Yangi mijozlar va savdo hajmi': 'Savdo uchun: tasdiqlangan kelishuvlar va real tushumni xizmat sifati bilan birga kuzating. Maqsadni oldingi natija va mavjud resursga moslang.',
      'Foyda va xarajat samaradorligi': 'Samaradorlik uchun: xodim ta’sir qila oladigan foyda yoki tasdiqlangan xarajat kamayishini oling. Hisoblash manbasini oldindan kelishing.',
      'Xizmat sifati va mijoz qoniqishi': 'Xizmat uchun: tekshirilgan sifat, asosli shikoyatlar va mijoz fikrini birga kuzating; faqat bajarilgan ishlar soniga tayanmang.',
      'Xatolarni kamaytirish va aniqlik': 'Aniqlik uchun: tekshirilgan ishlardagi xatolar ulushini oling. Ish murakkabligi va qayta ishlash sababini ham hisobga oling.',
      'Ishni muddatida bajarish': 'Muddat uchun: vaqtida tugallangan vazifalar ulushini kuzating. Xodimga bog‘liq bo‘lmagan kechikishni hisoblash tartibini oldindan belgilang.',
      'Jamoani o‘qitish va hamkorlik': 'Rivojlanish uchun: o‘qitish rejasining bajarilishi bilan birga yangi ko‘nikma ishda qo‘llanganini amaliy misol orqali tekshiring.',
    };
    const steps = targets.slice(0, 2).map(t => plans[t]).filter(Boolean);
    const control = decisionValue(survey, session, 'kpi_control');
    const budget = decisionValue(survey, session, 'bonus_budget');
    const fairness = decisionValue(survey, session, 'kpi_fairness');
    if (control && control !== 'Asosiy qismini bevosita boshqara oladi') steps.push('KPI ni xodim o‘zi boshqara oladigan natijaga ajrating; tashqi omil va boshqa bo‘limlar ta’sirini alohida kelishing.');
    if (budget && budget !== 'Byudjet va hisoblash sharti oldindan belgilangan') steps.push('Bonus haqida va’da berishdan avval byudjet, hisoblash sharti va to‘lash imkoniyatini aniqlang.');
    if (fairness && fairness !== 'Yozma mezon, ma’lumot manbasi va qayta tekshirish tartibi bor') steps.push('Formula, ma’lumot manbasi, hisob davri va xodim qayta tekshirishni so‘raydigan tartibni yozib qo‘ying.');
    return steps.length ? { title: 'KPI va ish qoidalari uchun aniq yo‘nalish', conclusion: 'Quyidagilar siz tanlagan maqsad va cheklovlarga mos sinov rejasidir.', steps: unique(steps, 5) } : null;
  }
  if (survey.id !== 'employees') return null;
  const skill = decisionValue(survey, session, 'skill_use');
  const alternative = decisionValue(survey, session, 'alternatives');
  const resolution = decisionValue(survey, session, 'resolution');
  const satisfaction = satisfactionAnswer(survey, session);
  const supplied = [skill, alternative, resolution, satisfaction?.label].filter(Boolean).length;
  if (supplied < 2) return null;
  const flags = [
    ['Deyarli hech qachon', "Ba'zan"].includes(first(session, 8)),
    first(session, 31) === 'Yo‘q',
    first(session, 28) === 'Yo‘q',
    ['Tez-tez', 'Har kuni'].includes(first(session, 23)) && first(session, 24) === 'To‘lanmaydi',
  ].filter(Boolean).length;
  const unresolved = resolution === 'Bir necha marta muhokama qilingan, sezilarli o‘zgarish bo‘lmadi';
  const unhappy = satisfaction?.score !== null && satisfaction?.score <= 2;
  let direction, conclusion, steps;
  if (unhappy && flags >= 2 && unresolved) {
    direction = 'Boshqa ish variantlarini jiddiy solishtirish';
    conclusion = 'Siz norozilik, bir nechta noqulay sharoit va muhokamalardan keyin ham o‘zgarish bo‘lmaganini bildirgansiz. Boshqa ish variantlarini o‘rganish asosli keyingi qadam bo‘lishi mumkin.';
    steps = ['Hozirgi va yangi variantni qo‘lga tegadigan maosh, bonus sharti, ish vaqti, muomala va o‘sish bo‘yicha solishtiring.', 'Ko‘chish qaroridan oldin yangi taklifning aniq shartlari va o‘zingizning o‘tish imkoniyatingizni tekshiring.'];
  } else if (skill === 'Ko‘nikmalarim hozirgi vazifaga hali yetmaydi') {
    direction = 'Avval aniq ko‘nikmani rivojlantirish';
    conclusion = 'Siz hozirgi vazifaga ayrim ko‘nikmalar hali yetmayotganini bildirgansiz. Ustoz va aniq o‘quv rejasi bilan bitta amaliy natijani yaxshilash foydali bo‘ladi.';
    steps = ['Rahbar bilan yetishmayotgan bitta ko‘nikma va uni ko‘rsatadigan amaliy natijani aniqlang.', 'O‘rganish muddati, yordam va qayta fikr olish vaqtini kelishing.'];
  } else if (satisfaction?.score >= 8 && companyScore >= 8 && flags === 0) {
    direction = 'Hozirgi ishda qolib rivojlanishni rejalashtirish';
    conclusion = 'Siz qoniqish va bir nechta qulay ish sharoitini bildirgansiz. Hozirgi ishning siz qadrlagan tomonlarini saqlab, shu joyda rivojlanish rejasini kelishish foydali variant.';
    steps = ['Keyingi mas’uliyat, ko‘nikma va maoshni qayta ko‘rish mezonlarini rahbar bilan aniqlashtiring.', 'Boshqa taklif bo‘lsa, uni taxmin bilan emas, aniq shartlar bilan solishtiring.'];
  } else if (['Qisman foydalanaman', 'Juda kam foydalanaman'].includes(skill)) {
    direction = 'Ko‘nikmaga mos vazifa yoki rolni izlash';
    conclusion = 'Siz ko‘nikmalaringizdan to‘liq foydalanmayotganingizni bildirgansiz. Avval murakkabroq vazifa yoki ichki o‘sish imkonini muhokama qilish, natija bo‘lmasa boshqa rollarni solishtirish mumkin.';
    steps = ['Ko‘rsata oladigan 2–3 amaliy natijangizni tayyorlab, mos vazifa va o‘sish yo‘lini so‘rang.', 'Takliflarni ish mazmuni, o‘rganish, maosh va sharoit bo‘yicha birga baholang.'];
  } else if (alternative === 'Aniq shartlari yozilgan taklif bor') {
    direction = 'Aniq takliflarni mezonlar bilan solishtirish';
    conclusion = 'Sizda yozma shartlari bor boshqa taklif mavjud. Qaysi variant sizga mosligini aynan shu shartlar bilan solishtirish mumkin.';
    steps = ['Asosiy maosh, kafolatlangan va o‘zgaruvchan bonus, ish vaqti, yo‘l va rivojlanish imkonini bir jadvalga yozing.', 'Siz uchun muhim shartlarni aniqlashtirmasdan faqat yuqori summaga qarab xulosa qilmang.'];
  } else if (unhappy || flags > 0 || (companyScore !== null && companyScore < 6)) {
    direction = unresolved ? 'Muqobil variantlar va aniq shartlarni o‘rganish' : 'Sharoitlarni aniq kelishish';
    conclusion = unhappy && companyScore >= 8 ? 'Ayrim sharoitlarga ijobiy javob bergansiz, ammo umumiy noroziligingiz bor. Bu farqning vazifa, ehtiyoj yoki boshqa sababini alohida aniqlash kerak.' : 'Javoblaringizda yaxshilash kerak bo‘lgan jihatlar bor. Siz uchun muhim o‘zgarish va uni tekshirish muddatini aniq kelishish foydali.';
    steps = ['Eng muhim 1–2 ehtiyojni misol bilan aytib, kim nima va qachon o‘zgartirishini kelishing.', 'Kelishilgan muddatdan keyin natijani qayta baholang; o‘zgarish bo‘lmasa boshqa ishlarning real shartlarini o‘rganing.'];
  } else {
    direction = 'Qaror mezonlarini aniqlashtirish';
    conclusion = 'Qolish yoki o‘tish qarori uchun sizga muhim shartlar va mavjud variantlarni aniq solishtirish foydali.';
    steps = ['Sizga eng muhim uchta ish shartini yozib, hozirgi ish va real takliflar bilan taqqoslang.', 'Noaniq shartlarni taxmin qilmasdan tegishli odamdan aniqlashtiring.'];
  }
  if (alternative && alternative !== 'Aniq shartlari yozilgan taklif bor' && direction.includes('solishtirish')) steps.push('Hozircha yozma taklif yo‘q: avval mos vakansiya va aniq shartlar haqida ma’lumot yig‘ing.');
  return { title: direction, conclusion, steps: unique(steps) };
}


const kpiLabels = {
  employee_current: 'Hozirgi KPI holati', preferred_metrics: 'Kuchliroq ishlashga undaydigan natijalar',
  preferred_conditions: 'Xodim uchun muhim shartlar', current_types: 'Amalda qo‘llanayotgan KPI turlari',
  current_basis: 'KPI belgilashdagi amaldagi asoslar', current_example: 'Rahbar yozgan amaldagi misol',
};
export function buildKpiInsights(survey, session) {
  const records = survey.questions.filter(q => q.kpi && answer(session, q.id)).map(q => {
    const response = answer(session, q.id);
    return { key: q.kpi, question: q.id, title: kpiLabels[q.kpi], choices: response.choices ?? [], text: excerpt(response.text ?? '', 220) };
  }).filter(r => r.choices.length || r.text);
  if (!records.length) return null;
  const selected = key => records.find(r => r.key === key)?.choices ?? [];
  const tips = [];
  if (survey.id === 'employers') {
    const types = selected('current_types');
    const basis = selected('current_basis');
    if (types.includes('KPI hali joriy etilmagan') || basis.includes('Hali KPI belgilash tartibi yo‘q')) tips.push('Avval bitta lavozimda kichik KPI sinovini rejalashtiring: xodim ta’sir qila oladigan natija, boshlang‘ich daraja, formula va bonus byudjetini birga kelishing.');
    if (basis.includes('Hamma lavozimga bir xil mezon qo‘llanadi') || basis.includes('Asosan rahbar xohlagan raqam olinadi')) tips.push('KPI ni har bir lavozim vazifasiga moslang; maqsadni oldingi haqiqiy natija, mijoz talabi va mavjud resurs bilan asoslang.');
    if (types.some(t => ['Yangi mijozlar va savdo hajmi','Yig‘ilgan real tushum','Bajarilgan ish hajmi'].includes(t))) tips.push('Savdo, tushum yoki ish hajmi ko‘rsatkichini sifat va qayta ishlash/shikoyat nazorati bilan birga kuzating; faqat sonni oshirishni rag‘batlantirmang.');
    if (basis.length && !basis.includes('Xodim bilan oldindan muhokama qilingan kelishuv')) tips.push('Hisoblash mezoni va xodimga bog‘liq bo‘lmagan to‘siqlarni xodim bilan oldindan muhokama qilib, yozma kelishing.');
    if (!types.includes('KPI hali joriy etilmagan') && !basis.includes('Hali KPI belgilash tartibi yo‘q') && records.some(r => r.key === 'current_example' && !/hali yo[‘’']q/i.test(r.text))) tips.push('Yozgan misolingizdagi maqsad, hisob davri, ma’lumot manbasi va bonus shartini xodim ham tekshira oladigan bir varaq qoida bilan mustahkamlang.');
  } else if (survey.id === 'employees') {
    const current = selected('employee_current')[0];
    const metrics = selected('preferred_metrics');
    const conditions = selected('preferred_conditions');
    if (current === 'KPI yoki natijaviy bonus yo‘q') tips.push('Tanlagan natijalaringizni yangi rag‘bat tizimi uchun taklif sifatida rahbar bilan muhokama qiling; hozircha amaldagi KPI deb qabul qilmang.');
    if (current === 'Qanday hisoblanishini aniq bilmayman' || conditions.includes('Mezon va hisoblash formulasi oldindan aniq bo‘lishi')) tips.push('KPI formulasi, hisob davri va bonusni oddiy raqamli misolda tushuntirishni so‘rang; natijani qayerdan tekshirishni aniqlashtiring.');
    if (conditions.includes('Asosiy maosh barqaror saqlanishi') || conditions.includes('Bonus miqdori yoki foizi oldindan ma’lum bo‘lishi') || conditions.includes('Bonus kelishilgan vaqtda to‘lanishi')) tips.push('Barqaror asosiy maosh, bonus summasi yoki foizi va to‘lash sanasini alohida yozma kelishing.');
    if (conditions.includes('Yetarli vaqt, resurs va o‘qitish berilishi') || conditions.includes('Natijaga o‘zim ta’sir qila olishim')) tips.push('Maqsadni bajarish uchun siz boshqara oladigan natija, kerakli vaqt, vosita va o‘qitishni rahbar bilan birga belgilang.');
    if (conditions.includes('Natija soni bilan birga sifati ham baholanishi') || conditions.includes('Xato yoki tashqi to‘siq bo‘lsa hisobni qayta ko‘rish imkoni')) tips.push('Sifat mezoni va tashqi to‘siq yoki hisob xatosida natijani qayta ko‘rib chiqish tartibini oldindan kelishing.');
    if (metrics.length) tips.push('Siz tanlagan «' + metrics.slice(0, 2).join('; ') + '» uchun o‘lchov, maqsad va tekshirish manbasini aniqlab, kichik sinov natijasini solishtiring.');
  }
  return { records, recommendations: unique(tips, 6) };
}

export function buildSurveyInsights(survey, session) {
  if (!['employees', 'employers'].includes(survey.id)) return null;
  let metrics;
  let employeeMetrics = [];
  const extraCompany = [];
  const employeeTips = [];
  let priorities = [];
  if (survey.id === 'employees') {
    metrics = [
      metric(session, 8, 'Maoshning vaqtida to‘lanishi', frequency, 'Maosh to‘lash sanasini aniq belgilang va kechikishlar sababini bartaraf etish rejasini tuzing.', 2),
      metric(session, 15, 'Ish joyining qulayligi', yes, 'Ish joyidagi eng zarur qulayliklarni xodim bilan birga aniqlab, yaxshilash rejasini tuzing.'),
      metric(session, 16, 'Tushlik va tanaffus sharoiti', { 'Vaqt ham, sharoit ham mavjud': 10, 'Faqat vaqt mavjud': 6, 'Faqat sharoit mavjud': 4, 'Ikkalasi ham mavjud emas': 0 }, 'Tushlik uchun qulay joy va aniq tanaffus vaqtini tashkil eting.'),
      metric(session, 23, 'Ish vaqti muvozanati', overtime, 'Kech qolib ishlash sabablarini aniqlang, vazifalar hajmi va ustuvorliklarni qayta ko‘rib chiqing.'),
      metric(session, 24, 'Qo‘shimcha ishning qoplanishi', { 'Har doim': 10, "Ba'zan": 5, 'To‘lanmaydi': 0 }, 'Qo‘shimcha ish va uni qoplash tartibini oldindan aniq kelishib oling.', 2),
      metric(session, 28, 'Dam olish imkoniyati', yes, 'Dam olish va ta’til rejasini xodimlarning ehtiyojlari hamda ish yukiga moslab tuzing.', 2),
      metric(session, 29, 'Rahbar bilan ochiq muloqot', yes, 'Xodim bilan muntazam, xotirjam fikr almashish uchrashuvlarini yo‘lga qo‘ying.'),
      metric(session, 30, 'Takliflarni tinglash', frequency, 'Taklif va muammolarni yig‘ib, ular bo‘yicha qanday choralar ko‘rilganini xodimlarga aytib boring.'),
      metric(session, 31, 'Hurmat va adolat hissi', yes, 'Baholash va rag‘bat mezonlarini tushunarli qiling, xodimning adolat haqidagi fikrlarini tinglang.', 2),
      metric(session, 33, 'Xodim fikrining inobatga olinishi', frequency, 'Xodim takliflaridan amalda qaysilarini joriy qilish mumkinligini birga ko‘rib chiqing.'),
      metric(session, 34, 'Natijaning e’tirof etilishi', frequency, 'Yaxshi natijalarni aniq misollar bilan e’tirof eting va rag‘bat shartlarini oldindan tushuntiring.'),
      metric(session, 41, 'Rivojlanish imkoniyati', yes, 'Lavozimda o‘sish va maoshni qayta ko‘rish mezonlarini xodimga aniq tushuntiring.'),
    ];
    if (first(session, 23) === 'Hech qachon') metrics[4].score = null;
    employeeMetrics = [metrics[6], metrics[7], metrics[8], metrics[9], metrics[10], metrics[11],
      metric(session, 32, 'Jamoa bilan munosabat', { 'Juda yaxshi': 10, 'Yaxshi': 8, 'O‘rtacha': 5, 'Yomon': 2, 'Juda yomon': 0 }, '')];
    priorities = choices(session, 43).map(v => v.replace(/[.]+$/, ''));
    if (priorities.length) {
      extraCompany.push('Xodim tanlagan ustuvor imtiyozlardan imkoniyatga mos 1–2 tasini birga muhokama qilib, kichik sinov joriy qiling.');
      employeeTips.push('Siz tanlagan ustuvor imtiyozlarni rahbar bilan muhokama qilib, qaysilari siz uchun birinchi o‘rinda ekanini tushuntiring.');
    }
    if (['Tez-tez', 'Har kuni'].includes(first(session, 23))) employeeTips.push('Rahbar bilan vazifalar ustuvorligini aniqlab, qo‘shimcha ish va dam olish vaqtini oldindan kelishib oling.');
    if (['Yo‘q', 'Bilmayman', 'Qisman'].includes(first(session, 41))) employeeTips.push('Keyingi bosqichga o‘sish uchun kerakli ko‘nikma va natijalarni rahbaringizdan aniq so‘rang.');
    if (metrics[10].score !== null && metrics[10].score <= 5) employeeTips.push('Erishgan natijalaringizni misollar bilan yozib boring va ular bo‘yicha rahbardan muntazam fikr so‘rang.');
    if (['Yo‘q', 'Qisman'].includes(first(session, 29))) employeeTips.push('Siz uchun muhim 2–3 ish sharoitini aniq misollar bilan tayyorlab, rahbar bilan alohida suhbatda muhokama qiling.');
    if (first(session, 17) === 'O‘z hisobimdan' && priorities.includes('Bepul tushlik')) extraCompany.unshift('Xodim uchun tushlik muhim: byudjetga mos tushlik yoki qisman xarajat qoplash variantini ko‘rib chiqing.');
  } else {
    const compensation = choices(session, 27);
    let overtimeScore = null;
    if (compensation.includes('Qo‘shimcha ishlanmaydi') && compensation.length === 1) overtimeScore = 10;
    else if (compensation.includes('Alohida qoplanmaydi') && compensation.length === 1) overtimeScore = 0;
    else if (compensation.length && compensation.every(c => ['Qo‘shimcha haq to‘lanadi', 'Dam olish vaqti beriladi'].includes(c))) overtimeScore = 10;
    if (first(session, 26) === 'Hech qachon') overtimeScore = null;
    metrics = [
      metric(session, 18, 'Maoshning vaqtida to‘lanishi', { 'Har doim vaqtida': 10, "Ba'zan kechikadi": 4, 'Doimiy sana belgilanmagan': 2 }, 'Maosh to‘lash taqvimini belgilang va shu sanaga mablag‘ni oldindan rejalashtiring.', 2),
      metric(session, 26, 'Ish vaqti muvozanati', overtime, 'Doimiy ortiqcha ish sabablarini o‘rganib, ish yukini va vazifalarni qayta taqsimlashni ko‘rib chiqing.'),
      { id: 27, title: 'Qo‘shimcha ishning qoplanishi', score: overtimeScore, weight: 2, tip: 'Qo‘shimcha ishni hisoblash va uni haq yoki dam olish vaqti bilan qoplash tartibini aniq belgilang.' },
      metric(session, 34, 'Yangi xodimni qo‘llab-quvvatlash', { 'Ha': 10, 'Yo‘q': 2, 'Lavozimga bog‘liq': 7 }, 'Yangi xodim uchun dastlabki oy rejasi va yordam beradigan ustozni belgilang.'),
    ];
    if (['Hech biri', '1–25%'].includes(first(session, 17))) extraCompany.push('KPI maqsadlarining tushunarliligi va erishish imkoniyatini xodimlar bilan qayta ko‘rib chiqing.');
    if (answer(session, 35)?.amount === 0) extraCompany.push('Ichki tajriba almashish, ustozlik yoki bepul o‘quv materiallari bilan kasbiy rivojlanishni boshlang.');
    if (first(session, 20) === 'Xodim o‘z hisobidan ovqatlanadi') extraCompany.push('Xodimlardan tushlik bo‘yicha ehtiyojini so‘rab, byudjetga mos yordam variantini baholang.');
    employeeTips.push('O‘z vazifalaringiz, kutiladigan natija va bonus hisoblash tartibini rahbar bilan oldindan aniqlashtiring.');
    if (first(session, 34) === 'Yo‘q') employeeTips.push('Yangi ishni boshlaganda savollar bilan murojaat qiladigan tajribali hamkasbni aniqlab oling.');
    if (['Tez-tez', 'Har kuni'].includes(first(session, 26))) employeeTips.push('Ish hajmi, ustuvor vazifalar va qo‘shimcha vaqtni qoplash tartibini rahbar bilan kelishib oling.');
  }
  const company = index(metrics);
  const experience = index(employeeMetrics);
  const satisfaction = satisfactionAnswer(survey, session);
  const decisionSupport = buildDecisionSupport(survey, session, company.score);
  let employeeConclusion = survey.id === 'employees' ? experienceSummary(experience.score) : 'Bu so‘rovnomada rahbarning javoblari berilgan. Xodimning qoniqishini baholash uchun uning o‘z javoblari ham kerak.';
  if (satisfaction?.label) {
    employeeConclusion = 'Umumiy qoniqish haqidagi javobingiz: «' + satisfaction.label + '». ' + (satisfaction.score !== null && satisfaction.score <= 2 && experience.score >= 8 ? 'Ayrim sharoitlarga ijobiy javob bergan bo‘lsangiz ham, umumiy noroziligingizni alohida muhokama qilish muhim.' : employeeConclusion);
  }
  const weakest = metrics.filter(m => m.score !== null && m.score < 8).sort((a, b) => a.score - b.score || b.weight - a.weight);
  const strongest = metrics.filter(m => m.score !== null && m.score >= 8).sort((a, b) => b.score - a.score);
  const companyTips = unique([...weakest.map(m => m.tip), ...extraCompany]);
  if (!companyTips.length) companyTips.push(company.score !== null ? 'Kuchli sharoitlarni saqlab, xodimlar fikrini muntazam yig‘ing va eng ko‘p takrorlangan ehtiyojni birinchi bo‘lib ko‘rib chiqing.' : 'Ish vaqti, maosh to‘lash tartibi, dam olish va xodim bilan muloqot haqida ko‘proq javob yig‘ing.');
  if (!employeeTips.length) employeeTips.push('Sizga eng ko‘p foyda berayotgan ish sharoitlari va yaxshilanishini istagan 2–3 ehtiyojingizni yozib, rahbar bilan muhokama qiling.');
  const situational = buildSituationalInsights(survey, session);
  const ideas = survey.questions.filter(q => q.proposal && answer(session, q.id)?.text?.trim()).map(q => ({ question: q.id, category: q.proposal, title: ideaLabels[q.proposal], text: excerpt(answer(session, q.id).text) }));
  const selectedCompanyTips = unique([companyTips[0], ...(situational?.companyRecommendations ?? []), ...companyTips.slice(1)]);
  const selectedEmployeeTips = unique([...(situational?.employeeRecommendations ?? []), ...employeeTips]);
  return {
    method: 'laylo-survey-indicators-v4',
    situational, ideas, satisfaction, decisionSupport, kpi: buildKpiInsights(survey, session),
    company: { ...company, indicators: metrics.map(m => ({ id: m.id, title: m.title, score: m.score })), conclusion: companySummary(company.score), strengths: unique(strongest.map(m => m.title), 2), recommendations: selectedCompanyTips },
    employee: { ...experience, indicators: employeeMetrics.map(m => ({ id: m.id, title: m.title, score: m.score })), conclusion: employeeConclusion, recommendations: selectedEmployeeTips },
    priorities: priorities.slice(0, 3),
  };
}
const scoreText = data => data.score === null ? 'Ma’lumot yetarli emas' : String(data.score).replace('.', ',') + '/10';
export function renderSurveyInsights(insights) {
  if (!insights) return '';
  const lines = [
    '📊 Xulosa, baho va tavsiyalar',
    '\n🏢 Korxona sharoitlari — ' + scoreText(insights.company),
    insights.company.conclusion,
  ];
  if (insights.company.measured) lines.push('Asos: ' + insights.company.measured + '/' + insights.company.total + ' ko‘rsatkich.');
  if (insights.company.strengths.length) lines.push('Kuchli tomonlar: ' + insights.company.strengths.join('; ') + '.');
  lines.push('\n👤 Xodimning ish tajribasi — ' + scoreText(insights.employee), insights.employee.conclusion);
  if (insights.satisfaction) lines.push('O‘zingiz bildirgan qoniqish — ' + scoreText(insights.satisfaction) + ' · ' + insights.satisfaction.label);
  if (insights.employee.measured) lines.push('Asos: ' + insights.employee.measured + '/' + insights.employee.total + ' ko‘rsatkich.');
  if (insights.decisionSupport) lines.push('\n🎯 ' + insights.decisionSupport.title, insights.decisionSupport.conclusion, ...insights.decisionSupport.steps.map((v, i) => (i + 1) + '. ' + v));

  if (insights.kpi) {
    lines.push('\n📈 KPI: amaldagi holat va takliflar');
    lines.push(...insights.kpi.records.map(r => 'Savol ' + r.question + ' · ' + r.title + ': ' + [...r.choices, r.text].filter(Boolean).join('; ')));
    if (insights.kpi.recommendations.length) lines.push('KPI bo‘yicha tavsiyalar:', ...insights.kpi.recommendations.map((t, i) => (i + 1) + '. ' + t));
  }
  if (insights.priorities.length) lines.push('Siz uchun muhim: ' + insights.priorities.join('; ') + '.');
  if (insights.situational) {
    const scenario = insights.situational;
    lines.push('\n🧭 ' + scenario.title + ' — ' + scoreText(scenario), scenario.conclusion);
    lines.push(...scenario.dimensions.map(d => d.title + ': ' + scoreText(d) + ' (' + d.measured + '/' + d.total + ')'));
    lines.push(...scenario.observations.map(o => 'Savol ' + o.id + ' · ' + o.title + ': «' + excerpt(o.selected, 105) + '»'));
  }
  if (insights.ideas?.length) {
    lines.push('\n🗣 Siz yozgan fikrlar va takliflar');
    lines.push(...insights.ideas.map(idea => 'Savol ' + idea.question + ' · ' + idea.title + ': «' + idea.text + '»'));
  }
  lines.push('\n📌 Korxona uchun tavsiyalar', ...insights.company.recommendations.map((v, i) => (i + 1) + '. ' + v));
  lines.push('\n💡 Xodim uchun tavsiyalar', ...insights.employee.recommendations.map((v, i) => (i + 1) + '. ' + v));
  lines.push('\nBaholar berilgan javoblarga asoslangan rivojlanish indeksidir. O‘tkazilgan va noma’lum javoblar past baho hisoblanmaydi. Natijani amaliy misollar va suhbat bilan muhokama qilish foydali.');
  return lines.join('\n');
}
