import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { validateSurvey } from '../src/surveys.mjs';
import { surveyTelegram } from '../src/survey-telegram.mjs';

const secretFile = '.laylo/cloudflare-surveys.json';
const cf = JSON.parse(await readFile(secretFile, 'utf8'));
for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_ID']) {
  if (!process.env[name]) throw new Error(`Missing setting: ${name}`);
}
const api = surveyTelegram(process.env.TELEGRAM_BOT_TOKEN);
const me = await api.call('getMe', {});
cf.webhookSecret ??= randomBytes(32).toString('hex');
await writeFile(secretFile, JSON.stringify(cf), { mode: 0o600 });
const base = `https://api.cloudflare.com/client/v4/accounts/${cf.account}/workers/scripts/laylo-surveys`;
const headers = { Authorization: `Bearer ${cf.token}` };
const settingsResponse = await fetch(base + '/settings', { headers, signal: AbortSignal.timeout(15000) });
const settings = await settingsResponse.json();
if (!settings.success) throw new Error(`Could not read Worker settings (${settingsResponse.status})`);
const migrationTag = settings.result.migration_tag;
if (migrationTag && migrationTag !== 'v1') throw new Error('Review the existing database migration before deploying.');
const hasSurveyStorage = settings.result.bindings?.some(binding =>
  binding.name === 'SURVEYS' && binding.type === 'durable_object_namespace');

const definitions = await Promise.all(['employees', 'employers'].map(async id => {
  const survey = validateSurvey(JSON.parse(await readFile(`config/surveys/${id}.json`, 'utf8')));
  return `const ${id} = ${JSON.stringify(survey)};`;
}));
const modules = await Promise.all(['src/survey-insights.mjs', 'src/surveys.mjs', 'src/survey-telegram.mjs', 'src/survey-worker.mjs'].map(async path =>
  (await readFile(path, 'utf8')).replace(/^import .*?;\r?\n/gm, '')));
const values = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_OWNER_ID: process.env.TELEGRAM_OWNER_ID,
  TELEGRAM_BOT_USERNAME: me.username,
  TELEGRAM_WEBHOOK_SECRET: cf.webhookSecret,
};
const metadata = {
  main_module: 'worker.js', compatibility_date: '2026-11-01',
  bindings: [
    { type: 'durable_object_namespace', name: 'SURVEYS', class_name: 'SurveyStore' },
    ...Object.entries(values).map(([name, text]) => ({ name, text, type: 'secret_text' })),
  ],
  ...(!hasSurveyStorage && !migrationTag ? { migrations: { new_tag: 'v1', new_sqlite_classes: ['SurveyStore'] } } : {}),
};
const form = new FormData();
form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
form.set('worker.js', new Blob([[...definitions, ...modules].join('\n')], { type: 'application/javascript+module' }), 'worker.js');
const response = await fetch(base, { method: 'PUT', headers, body: form, signal: AbortSignal.timeout(45000) });
const result = await response.json();
if (!result.success) throw new Error(`Worker deployment failed (${response.status}, codes ${(result.errors ?? []).map(e => e.code).join(',')})`);
console.log('Laylo survey Worker deployed. Existing survey storage retained.');
