import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createSurveyBot } from './surveys.mjs';
import { surveyTelegram } from './survey-telegram.mjs';

for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_ID']) {
  if (!process.env[name]) throw new Error(`Missing setting: ${name}`);
}
const ownerId = Number(process.env.TELEGRAM_OWNER_ID);
if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error('Invalid TELEGRAM_OWNER_ID');
const path = resolve(process.env.LAYLO_SURVEY_STATE_FILE || '.laylo/survey-state.json');
await mkdir(dirname(path), { recursive: true });
let data = {};
try { data = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const save = async () => {
  await writeFile(path + '.tmp', JSON.stringify(data), { mode: 0o600 });
  await rename(path + '.tmp', path);
};
const storage = {
  get: async key => structuredClone(data[key]),
  put: async (key, value) => {
    if (typeof key === 'object') Object.assign(data, structuredClone(key));
    else data[key] = structuredClone(value);
    await save();
  },
  delete: async key => { delete data[key]; await save(); },
  list: async ({ prefix, startAfter, limit }) => new Map(Object.keys(data).sort().filter(key => key.startsWith(prefix) && (!startAfter || key > startAfter)).slice(0, limit).map(key => [key, structuredClone(data[key])])),
};
const api = surveyTelegram(process.env.TELEGRAM_BOT_TOKEN);
const me = await api.call('getMe', {});
const webhook = await api.call('getWebhookInfo', {});
if (webhook.url) throw new Error('Webhook is active. Run the configured serverless deployment.');
const definitions = await Promise.all(['employees', 'employers', 'business'].map(async id => JSON.parse(await readFile(new URL(`../config/surveys/${id}.json`, import.meta.url), 'utf8'))));
const bot = createSurveyBot({ storage, api, ownerId, username: me.username, definitions });
await bot.ready;
console.log('Laylo surveys started.');
while (true) {
  let updates;
  try { updates = await api.call('getUpdates', { offset: data.offset ?? 0, timeout: 10, allowed_updates: ['message', 'callback_query'] }); }
  catch (error) {
    if ([401, 409].includes(error.status)) throw error;
    console.error('Survey polling failed', error.status ?? error.name);
    await new Promise(resolve => setTimeout(resolve, 3000));
    continue;
  }
  await bot.flushChannelReports();
  for (const update of updates) {
    await bot.handle(update);
    data.offset = update.update_id + 1;
    await save();
  }
}
