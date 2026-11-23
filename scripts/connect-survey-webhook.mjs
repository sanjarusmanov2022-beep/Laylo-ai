import { surveyTelegram } from '../src/survey-telegram.mjs';

const endpoint = new URL(process.argv[2]);
if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/telegram') throw new Error('Pass the deployed HTTPS /telegram endpoint.');
for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_ID', 'TELEGRAM_WEBHOOK_SECRET']) {
  if (!process.env[name]) throw new Error(`Missing setting: ${name}`);
}
if (!/^[A-Za-z0-9_-]{32,256}$/.test(process.env.TELEGRAM_WEBHOOK_SECRET)) throw new Error('Use a random webhook secret with at least 32 characters.');
const health = new URL('/health', endpoint);
const response = await fetch(health, { signal: AbortSignal.timeout(15000) });
if (!response.ok || (await response.json()).service !== 'laylo-surveys') throw new Error('The survey Worker health check failed.');
const api = surveyTelegram(process.env.TELEGRAM_BOT_TOKEN);
await api.call('setWebhook', {
  url: endpoint.href, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  max_connections: 1, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false,
});
const commands = [
  { command: 'start', description: 'So‘rovnomalar menyusi' },
  { command: 'survey', description: 'So‘rovnomani davom ettirish' },
  { command: 'cancel', description: 'Tanaffus qilish' },
  { command: 'help', description: 'Yordam' },
];
await api.call('setMyCommands', { commands });
await api.call('setMyCommands', {
  scope: { type: 'chat', chat_id: Number(process.env.TELEGRAM_OWNER_ID) },
  commands: [...commands, { command: 'admin', description: 'Admin menyusi' }, { command: 'report', description: 'So‘rovnomalar hisoboti' }, { command: 'export', description: 'Javoblarni CSV faylida olish' }, { command: 'newsurvey', description: 'Yangi so‘rovnoma yaratish' }],
});
const webhook = await api.call('getWebhookInfo', {});
if (webhook.url !== endpoint.href) throw new Error('Webhook verification failed.');
console.log('Survey webhook connected. Open /start in Telegram to verify both roles and /admin for the owner.');
