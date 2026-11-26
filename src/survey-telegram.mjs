export function surveyTelegram(token, fetcher = fetch) {
  return {
    async call(method, body) {
      const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, body instanceof FormData
        ? { method: 'POST', body, signal: AbortSignal.timeout(15000) }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        const error = new Error(`Telegram ${method} returned ${result.error_code ?? response.status}`);
        error.status = result.error_code ?? response.status;
        error.retryAfter = Number(result.parameters?.retry_after ?? 0);
        throw error;
      }
      return result.result;
    },
  };
}

/** Fair outbound scheduler: a slow channel never reserves future global slots. */
export function pacedSurveyTelegram(api, {
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  globalMs = 45, privateMs = 1100, channelMs = 3100,
} = {}) {
  let nextGlobal = 0, cooldown = 0, running = false, wake = null;
  const chats = new Map(), pending = [];
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        if (cooldown - now() > 3000) {
          const error = new Error('Telegram cooldown'); error.status = 429;
          error.retryAfter = Math.ceil((cooldown - now()) / 1000);
          for (const item of pending.splice(0)) item.reject(error);
          break;
        }
        const current = now();
        let chosen = 0, earliest = Infinity;
        for (let i = 0; i < pending.length; i++) {
          const at = Math.max(nextGlobal, cooldown, chats.get(pending[i].chat) ?? 0);
          if (at < earliest) { earliest = at; chosen = i; }
        }
        if (earliest > current) {
          await Promise.race([sleep(earliest - current), new Promise(resolve => { wake = resolve; })]);
          wake = null; continue;
        }
        const item = pending.splice(chosen, 1)[0];
        nextGlobal = current + globalMs;
        chats.set(item.chat, current + (item.chat.startsWith('-') ? channelMs : privateMs));
        // Do not wait for a network response before scheduling a different recipient.
        Promise.resolve().then(() => api.call(item.method, item.body)).then(item.resolve, error => {
          if (error.status === 429) cooldown = Math.max(cooldown, now() + Math.max(1000, Number(error.retryAfter ?? 1) * 1000));
          item.reject(error); wake?.();
        });
        if (chats.size > 2048) for (const [key, until] of chats) if (until <= current) chats.delete(key);
      }
    } finally { running = false; }
  }
  return {
    call(method, body) {
      if (!/^(send|editMessage)/.test(method)) return api.call(method, body);
      const chat = String(body instanceof FormData ? body.get('chat_id') : body.chat_id);
      return new Promise((resolve, reject) => {
        pending.push({ method, body, chat, resolve, reject }); wake?.(); void pump();
      });
    },
  };
}
