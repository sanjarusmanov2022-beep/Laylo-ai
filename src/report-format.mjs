// Public report formatting; raw answers and identities are always escaped for Telegram HTML.
const brief = (text, size = 170) => { const chars = Array.from(String(text ?? '').replace(/\s+/g, ' ').trim()); return chars.length > size ? chars.slice(0, size - 1).join('') + '…' : chars.join(''); };
export const reportPercent = score => Number.isFinite(score) ? Math.round(Math.max(0, Math.min(10, score)) * 10) : null;
export function reportProfile(insights) {
  const s = insights?.situational;
  if (!s || !Number.isFinite(s.score) || s.measured < 8) return { key: 'unknown', title: 'Status uchun ma’lumot yetarli emas', note: 'Yetarli vaziyatli javob olinmagan.', percent: null };
  const leadership = ['communication', 'accountability', 'collaboration'].every(id => s.dimensions.find(d => d.id === id)?.score >= 8);
  let key, title;
  if (s.score >= 9 && s.measured / s.total >= 0.75 && leadership) { key = 'leadership'; title = 'Yetakchilikka moyil yondashuv'; }
  else if (s.score >= 8) { key = 'strong'; title = 'Kuchli yondashuv'; }
  else if (s.score >= 6) { key = 'steady'; title = 'Barqaror yondashuv'; }
  else { key = 'develop'; title = 'Rivojlantirish zarur'; }
  return { key, title, percent: reportPercent(s.score), note: 'Status vaziyatli javoblar profilidir; kasbiy malaka yoki ishdagi samaradorlik alohida tekshiriladi.' };
}
export function reportChannelLink(channel) {
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(channel?.username ?? '') ? { username: '@' + channel.username, url: 'https://t.me/' + channel.username } : null;
}
export function renderChannelReport({ survey, session, insights, identity, workplace, sector, date, channel, questionCount }, transform = text => String(text)) {
  const e = text => transform(String(text ?? '')).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const bold = text => '<b>' + e(text) + '</b>';
  const profile = reportProfile(insights);
  const figure = (title, data) => {
    const p = reportPercent(data?.score);
    return bold(title) + '\n' + (p === null ? e('Ma’lumot yetarli emas') : '▰'.repeat(Math.round(p / 10)) + '▱'.repeat(10 - Math.round(p / 10)) + '  ' + bold(p + '% · ' + String(data.score).replace('.', ',') + '/10'));
  };
  const parts = [
    (survey.id === 'employers' ? '🏢 ' : '👤 ') + bold(identity + (session.publicIdentity?.kind === 'code' ? ' raqami' : '') + ' hisoboti'),
    e(survey.id === 'employers' ? 'RAHBAR PROFILI' : 'XODIM PROFILI'),
    '🏷 ' + bold(profile.title),
    '🏢 ' + e('Ishxona: ' + brief(workplace, 90)) + '\n' + e('Sektor: ' + sector),
    '🎂 ' + e('Yosh: ' + (session.age ?? 'Ko‘rsatilmagan')) + ' · ' + e('Javoblar: ') + Object.values(session.answers ?? {}).filter(Boolean).length + '/' + questionCount,
    '🗓 ' + e(date) + ' · ' + e('Toshkent'),
  ];
  if (insights) {
    parts.push('\n' + figure('🏢 Korxona sharoitlari', insights.company), e(brief(insights.company.conclusion, 150)));
    parts.push('\n' + figure('👤 Ish tajribasi', insights.employee));
    if (insights.satisfaction) parts.push('💬 ' + bold('O‘zi bildirgan qoniqish: ') + e(insights.satisfaction.label) + (reportPercent(insights.satisfaction.score) === null ? '' : ' · ' + reportPercent(insights.satisfaction.score) + '%'));
    if (insights.situational) parts.push('\n' + figure(survey.id === 'employers' ? '🧭 Rahbarlik yondashuvi' : '🧭 Vaziyatlardagi yondashuv', insights.situational));
    const strengths = (insights.situational?.dimensions ?? []).filter(d => d.score >= 8 && Number.isFinite(d.score)).sort((a,b) => b.score-a.score).slice(0,3);
    if (strengths.length) parts.push('\n' + bold('💪 Kuchli ko‘ringan tomonlar'), ...strengths.map(d => '✓ ' + e(d.title) + ' · ' + reportPercent(d.score) + '%'));
    const needs = (insights.company.indicators ?? []).filter(d => Number.isFinite(d.score) && d.score < 8).sort((a,b) => a.score-b.score).slice(0,2);
    if (needs.length) parts.push('\n' + bold('🛠 Korxonada e’tibor kerak'), ...needs.map(d => '• ' + e(d.title) + ' · ' + reportPercent(d.score) + '%'));
    parts.push('\n' + bold('🏢 Korxona uchun tavsiyalar'), e(brief(insights.company.recommendations[0], 180)));
    parts.push('\n' + bold('🌱 Xodim uchun tavsiyalar'), e(brief(insights.employee.recommendations[0], 180)));
  }
  parts.push('\n📑 ' + bold('To‘liq tahlil, diagrammalar va tavsiyalar — PDFda.'), 'ℹ️ ' + e('Foizlar 10 ballik indeksning ko‘rinishi; bu malaka sinovi emas.'), e('Hisobot ID: ' + session.token));
  const link = reportChannelLink(channel);
  if (link) parts.push('\n📊 ' + bold('Yangi tahlillar uchun obuna bo‘ling:') + '\n<a href="' + link.url + '">' + e(link.username) + '</a>');
  return parts.join('\n');
}

export function reportPdfName(channel, token, preview = false) {
  const brand = String(channel?.title || 'HR hisobot').normalize('NFKC').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/gu, '').trim().replace(/\s+/gu, '_').slice(0,60).replace(/[ ._]+$/gu,'') || 'HR_hisobot';
  const id = String(token ?? '').replace(/[^A-Za-z0-9_-]/g,'').slice(0,40) || 'hisobot';
  return brand + '_' + (preview ? 'SINOV_' : '') + id + '.pdf';
}
