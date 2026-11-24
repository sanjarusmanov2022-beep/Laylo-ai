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
  if (score === null) return 'Xodimning ish tajribasi va qoniqishini baholash uchun yetarli javob yo‘q. Berilgan fikrlar baribir muhim va tavsiyalarda hisobga olinadi.';
  if (score >= 8) return 'Javoblaringizda jamoa, e’tirof yoki rivojlanish bilan bog‘liq ijobiy tajribalar ko‘rinadi. Sizga foyda berayotgan sharoitlarni saqlab qolish muhim.';
  if (score >= 6) return 'Ish tajribangizda ijobiy tomonlar ham, e’tibor kutayotgan ehtiyojlar ham bor. Siz uchun eng muhim o‘zgarishlarni aniq aytish foydali bo‘ladi.';
  return 'Javoblaringiz ayrim ehtiyojlaringiz yetarlicha qondirilmayotganini ko‘rsatmoqda. O‘z fikringizni bildirish va sizga mos sharoitlarni muhokama qilish muhim.';
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
  const weakest = metrics.filter(m => m.score !== null && m.score < 8).sort((a, b) => a.score - b.score || b.weight - a.weight);
  const strongest = metrics.filter(m => m.score !== null && m.score >= 8).sort((a, b) => b.score - a.score);
  const companyTips = unique([...weakest.map(m => m.tip), ...extraCompany]);
  if (!companyTips.length) companyTips.push(company.score !== null ? 'Kuchli sharoitlarni saqlab, xodimlar fikrini muntazam yig‘ing va eng ko‘p takrorlangan ehtiyojni birinchi bo‘lib ko‘rib chiqing.' : 'Ish vaqti, maosh to‘lash tartibi, dam olish va xodim bilan muloqot haqida ko‘proq javob yig‘ing.');
  if (!employeeTips.length) employeeTips.push('Sizga eng ko‘p foyda berayotgan ish sharoitlari va yaxshilanishini istagan 2–3 ehtiyojingizni yozib, rahbar bilan muhokama qiling.');
  return {
    method: 'laylo-survey-indicators-v1',
    company: { ...company, conclusion: companySummary(company.score), strengths: unique(strongest.map(m => m.title), 2), recommendations: companyTips },
    employee: { ...experience, conclusion: survey.id === 'employees' ? experienceSummary(experience.score) : 'Bu so‘rovnomada rahbarning javoblari berilgan. Xodimning qoniqishini baholash uchun uning o‘z javoblari ham kerak.', recommendations: unique(employeeTips) },
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
  lines.push('\n👤 Xodim tajribasi va qoniqishi — ' + scoreText(insights.employee), insights.employee.conclusion);
  if (insights.employee.measured) lines.push('Asos: ' + insights.employee.measured + '/' + insights.employee.total + ' ko‘rsatkich.');
  if (insights.priorities.length) lines.push('Siz uchun muhim: ' + insights.priorities.join('; ') + '.');
  lines.push('\n📌 Korxona uchun tavsiyalar', ...insights.company.recommendations.map((v, i) => (i + 1) + '. ' + v));
  lines.push('\n💡 Xodim uchun tavsiyalar', ...insights.employee.recommendations.map((v, i) => (i + 1) + '. ' + v));
  lines.push('\nBaholar faqat berilgan javoblarga asoslangan so‘rovnoma indeksidir. O‘tkazilgan yoki noma’lum javoblar past baho sifatida olinmaydi.');
  return lines.join('\n');
}
