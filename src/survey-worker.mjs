import employees from '../config/surveys/employees.json' with { type: 'json' };
import employers from '../config/surveys/employers.json' with { type: 'json' };
import { createSurveyBot } from './surveys.mjs';
import { surveyTelegram } from './survey-telegram.mjs';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') return Response.json({ service: 'laylo-surveys', status: 'ready' });
    if (path !== '/telegram' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_BOT_USERNAME || !/^[1-9]\d*$/.test(env.TELEGRAM_OWNER_ID ?? '')) return new Response('Configuration required', { status: 503 });
    return env.SURVEYS.get(env.SURVEYS.idFromName('laylo-surveys')).fetch(request);
  },
};

export class SurveyStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.queue = Promise.resolve();
    this.bot = createSurveyBot({
      storage: ctx.storage,
      api: surveyTelegram(env.TELEGRAM_BOT_TOKEN),
      ownerId: Number(env.TELEGRAM_OWNER_ID), username: env.TELEGRAM_BOT_USERNAME,
      definitions: [employees, employers],
    });
  }

  async fetch(request) {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 128_000) return new Response('Too large', { status: 413 });
    let update;
    try { update = JSON.parse(text); } catch { return new Response('Invalid JSON', { status: 400 }); }
    if (!Number.isSafeInteger(update.update_id)) return new Response('Invalid update', { status: 400 });
    const operation = this.queue.then(async () => {
      await this.bot.handle(update);
      return new Response('OK');
    });
    // All writes in this object run in update order, including after I/O awaits.
    this.queue = operation.catch(() => {});
    try { return await operation; }
    catch (error) {
      console.error('Survey processing failed', error.status ?? error.name);
      return new Response('Retry later', { status: 503 });
    }
  }
}
