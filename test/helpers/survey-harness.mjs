import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSurveyBot } from '../../src/surveys.mjs';

export const definitions = await Promise.all(['employees', 'employers'].map(async id => JSON.parse(await readFile(new URL(`../../config/surveys/${id}.json`, import.meta.url), 'utf8'))));

export function harness(defs = definitions, existing, autoScript = true, autoProfile = true) {
  const data = existing ?? new Map();
  const messages = [];
  const storage = {
    get: async key => structuredClone(data.get(key)),
    delete: async key => data.delete(key),
    put: async (key, value) => {
      if (typeof key === 'object') for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v));
      else data.set(key, structuredClone(value));
    },
    setAlarm: async time => data.set('alarmAt', time),
    deleteAlarm: async () => data.delete('alarmAt'),
    list: async ({ prefix, limit, startAfter }) => new Map([...data].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(prefix) && (!startAfter || key > startAfter)).slice(0, limit)),
  };
  const api = { call: async (method, body) => {
    messages.push({ method, body: body instanceof FormData ? body : structuredClone(body) });
    if (method === 'getMe') return { id: 999, username: 'SurveyTestBot' };
    if (method === 'getChat') return { id: -100123456, type: 'channel', title: 'Hisobotlar', username: 'reports_test' };
    if (method === 'getChatMember') return { status: 'administrator', can_post_messages: true };
    return { message_id: messages.length };
  } };
  const bot = createSurveyBot({ storage, api, ownerId: 1, username: 'SurveyTestBot', definitions: defs });
  let updateId = 0;
  const chooseDefaultScript = async user => {
    if (autoScript && messages.findLast(m => m.body.chat_id === user)?.body.reply_markup?.inline_keyboard.flat().some(b => b.callback_data === 'script:latin')) await press(user, 'Lotincha');
  };
  const chooseDefaultProfile = async user => {
    if (!autoProfile) return;
    const lastButtons = messages.findLast(m => m.body.chat_id === user)?.body.reply_markup?.inline_keyboard.flat() ?? [];
    const option = lastButtons.find(b => b.callback_data?.endsWith(':workplace_private')) ?? lastButtons.find(b => b.callback_data?.endsWith(':sector_private'));
    if (option) await press(user, option.text);
  };
  const message = async (user, text) => {
    await bot.handle({ update_id: ++updateId, message: { text, from: { id: user, first_name: 'Telegram name never stored' }, chat: { id: user, type: 'private' } } });
    await chooseDefaultScript(user);
    await chooseDefaultProfile(user);
  };
  const buttons = user => messages.findLast(m => m.body.chat_id === user && m.body.reply_markup)?.body.reply_markup.inline_keyboard.flat() ?? [];
  const press = async (user, text) => {
    const button = buttons(user).find(b => b.text === text || b.text.includes(text));
    assert.ok(button, `Button not found: ${text}`);
    const update = { update_id: ++updateId, callback_query: { id: `cb${updateId}`, from: { id: user }, message: { message_id: messages.length, chat: { id: user, type: 'private' } }, data: button.callback_data } };
    await bot.handle(update);
    await chooseDefaultScript(user);
    await chooseDefaultProfile(user);
    return update;
  };
  const sessions = () => [...data].filter(([key]) => key.startsWith('session:')).map(([, session]) => session);
  return { data, storage, messages, api, bot, message, press, buttons, sessions };
}

