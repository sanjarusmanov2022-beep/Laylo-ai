// Read-only checks of the public Worker and webhook guard. No credentials or real survey updates.
// A ready health response does not prove Telegram delivery or database health.
const base = 'https://laylo-surveys.sanjar-usmanov-2023.workers.dev';
const outcomes = [];
for (let round = 1; round <= 3; round++) {
  for (const check of [
    { name: 'health', path: '/health', init: { method: 'GET' }, expected: 200 },
    { name: 'webhook-guard', path: '/telegram', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, expected: 403 },
  ]) {
    try {
      const response = await fetch(base + check.path, { ...check.init, redirect: 'error', signal: AbortSignal.timeout(8000) });
      const body = await response.text();
      let ready = true;
      if (check.name === 'health') {
        const data = JSON.parse(body);
        ready = data.service === 'laylo-surveys' && data.status === 'ready';
      }
      const pass = response.status === check.expected && ready;
      outcomes.push({ round, check: check.name, status: response.status, expected: check.expected, pass });
    } catch (error) {
      outcomes.push({ round, check: check.name, pass: false, error: String(error.message ?? error).slice(0, 200) });
    }
  }
}
console.log(JSON.stringify({ diagnostic: 'laylo-public-health-v1', scope: 'public HTTP and unauthenticated webhook guard only', outcomes }));
if (outcomes.some(result => !result.pass)) process.exitCode = 1;
