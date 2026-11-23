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
        throw error;
      }
      return result.result;
    },
  };
}
