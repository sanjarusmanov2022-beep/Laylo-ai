// Installs the audited survey-only release into an existing Laylo workspace.
// Downloaded source is pinned and checked against Git blob hashes. Credentials stay local.
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const revision = '7e8f9b3a59d0279314015958517c059402aec7f4';
const manifest = [
  {
    "path": "config/surveys/employees.json",
    "sha": "773c049d7ff6b9abf2160d0ae0f129fd0a536042"
  },
  {
    "path": "config/surveys/employers.json",
    "sha": "7814f32de2d5af734baf41cccb95f936ed763983"
  },
  {
    "path": "scripts/check-live-health.mjs",
    "sha": "296b6544d73315ab257747c17383e344b47dbb3b"
  },
  {
    "path": "scripts/deploy-surveys.mjs",
    "sha": "50eef834b0a885ca931d43ddc1c952a80f6a8728"
  },
  {
    "path": "src/locale-ru.mjs",
    "sha": "158a8da02c21ca6375c4ff895c868b9e7e7f5af9"
  },
  {
    "path": "src/pdf-fonts.mjs",
    "sha": "1bd7f1064e1eda14938757a0f4af1f0681ef60c9"
  },
  {
    "path": "src/report-format.mjs",
    "sha": "c4c37a7ecf4b41ff5e350cac3a93369b288df8a6"
  },
  {
    "path": "src/survey-insights.mjs",
    "sha": "1b6193d228bd0c52615905d56f85a427262fb9c9"
  },
  {
    "path": "src/survey-pdf.mjs",
    "sha": "cd11a0a95a7245daa7b968a92fc5ed39f1c7a763"
  },
  {
    "path": "src/survey-telegram.mjs",
    "sha": "7ff2f878aa35743e6c3ee5229137575c3dfd4901"
  },
  {
    "path": "src/survey-worker.mjs",
    "sha": "7a0fa1ce402e8fbf66b2521776cd8575648aa4e3"
  },
  {
    "path": "src/surveys.mjs",
    "sha": "bc067e41c55e422f554b1929a633ff5a4be960f7"
  },
  {
    "path": "test/helpers/survey-harness.mjs",
    "sha": "0238d52bdbbafd97524308fff33a4d26e10e5dde"
  },
  {
    "path": "test/russian-localization.test.mjs",
    "sha": "b39aeb9c181a7940138acecd5827cdfed8af9b7f"
  },
  {
    "path": "test/surveys.test.mjs",
    "sha": "01278fe6b860f1744cf39bebe68e9cf80f42ccf3"
  },
  {
    "path": "src/survey-runtime.mjs",
    "sha": "ed6b1bd185d2636268b3e232cf486ccb6c400306"
  },
  {
    "path": "test/survey-capacity.test.mjs",
    "sha": "9299e3705cd085ac07a703f951b2256aed64622f"
  },
  {
    "path": "config/surveys/business.json",
    "sha": "cfc6db1cc93ec002887bed5a2e9984e33439768a"
  },
  {
    "path": "src/business-insights.mjs",
    "sha": "b9fc16418060fa88a4090ea6cfe410b41ac5c2e5"
  },
  {
    "path": "test/business-audit.test.mjs",
    "sha": "1591ef0ba33517e6d2f76c5cccacffc97d122480"
  },
  {
    "path": "src/survey-bot.mjs",
    "sha": "aa098d6fe141c256425df7142610535103e438a0"
  },
  {
    "path": "README.md",
    "sha": "e9060a358d6120dd188f7e7db8cb4ce537b05291"
  }
];
const root = resolve(process.cwd());
const accountId = '01eac3beebc7e29f6b52854f911b1b1f';
const workerUrl = 'https://laylo-surveys.sanjar-usmanov-2023.workers.dev';
let cf;
function safeError(error) {
  let text = String(error?.message ?? error);
  for (const secret of [cf?.token, process.env.TELEGRAM_BOT_TOKEN]) if (secret) text = text.replaceAll(secret, '[redacted]');
  return text;
}
function run(args, cwd, showOutput = false) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120000, windowsHide: true, env: { ...process.env, LAYLO_SKIP_LOAD: '1' }, maxBuffer: 5_000_000 });
  if (result.error) throw new Error('Node execution failed: ' + safeError(result.error));
  if (result.status !== 0) throw new Error('Step failed: ' + args.join(' ') + '\n' + (result.stdout ?? '').slice(-2500) + '\n' + (result.stderr ?? '').slice(-1500));
  if (showOutput) console.log((result.stdout ?? '').trim());
  return result.stdout ?? '';
}
async function cloud(path) {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + cf.account + '/workers/scripts/laylo-surveys' + path, {
    headers: { Authorization: 'Bearer ' + cf.token }, signal: AbortSignal.timeout(20000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Cloudflare read returned HTTP ' + response.status);
  return response;
}
async function settings() {
  const data = await (await cloud('/settings')).json();
  if (!data.success) throw new Error('Cloudflare settings could not be verified');
  return data.result;
}
function storageBinding(value) {
  return value.bindings?.find(b => b.name === 'SURVEYS' && b.type === 'durable_object_namespace');
}
export function assertExistingSurveyStorage(value) {
  const binding = storageBinding(value);
  if (!binding || binding.class_name !== 'SurveyStore' ||
      typeof binding.namespace_id !== 'string' || !binding.namespace_id.trim() ||
      (binding.script_name && binding.script_name !== 'laylo-surveys')) {
    throw new Error('Existing SURVEYS namespace could not be verified; no deployment attempted');
  }
  // /settings may omit migration_tag even when an existing namespace is present.
  // The verified namespace is authoritative; this update never creates a new one.
  if (value.migration_tag != null && value.migration_tag !== 'v1') {
    throw new Error('Unexpected survey migration tag; no deployment attempted');
  }
  return binding;
}
export function assertRetainedSurveyStorage(before, after) {
  const oldBinding = assertExistingSurveyStorage(before);
  const newBinding = assertExistingSurveyStorage(after);
  if (newBinding.namespace_id !== oldBinding.namespace_id ||
      newBinding.class_name !== oldBinding.class_name) {
    throw new Error('Survey storage binding changed; review the deployment');
  }
}

async function main() {
  if (basename(root).toLowerCase() !== 'laylo-ai') throw new Error('Open the Laylo-ai project directory first');
  await access(join(root, '.env'));
  cf = JSON.parse(await readFile(join(root, '.laylo/cloudflare-surveys.json'), 'utf8'));
  if (cf.account !== accountId || !cf.token || !cf.webhookSecret) throw new Error('Existing Laylo account, token and webhook settings are required');
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_OWNER_ID) throw new Error('Run node with --env-file=.env');
  const before = await settings();
  assertExistingSurveyStorage(before);
  const staging = join(root, '.laylo', 'release-' + revision);
  const backup = join(root, '.laylo', 'backup-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(staging, { recursive: true });
  console.log('1/5 Downloading and verifying the audited GitHub release...');
  for (const item of manifest) {
    if (item.path.includes('..') || item.path.startsWith('/')) throw new Error('Invalid release path');
    const response = await fetch('https://raw.githubusercontent.com/sanjarusmanov2022-beep/Laylo-ai/' + revision + '/' + item.path, {
      signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Download failed: ' + item.path + ' (HTTP ' + response.status + ')');
    const bytes = Buffer.from(await response.arrayBuffer());
    const hash = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    if (hash !== item.sha) throw new Error('Source verification failed: ' + item.path);
    const target = join(staging, item.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  console.log('2/5 Running business audit, HR, localization and queue regression checks (full load already checked in GitHub)...');
  const output = run(['--test', 'test/surveys.test.mjs', 'test/russian-localization.test.mjs', 'test/survey-capacity.test.mjs', 'test/business-audit.test.mjs'], staging);
  console.log(output.split(/\r?\n/).filter(line => /^# (tests|pass|fail|skipped) /.test(line)).join('\n'));
  console.log('3/5 Saving a source backup and installing verified files...');
  for (const item of manifest) {
    const target = join(root, item.path), saved = join(backup, item.path);
    await mkdir(dirname(saved), { recursive: true });
    try { await copyFile(target, saved); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(staging, item.path), target);
  }
  console.log('4/5 Updating only the laylo-surveys Worker...');
  run(['--env-file=.env', 'scripts/deploy-surveys.mjs'], root, true);
  console.log('5/5 Verifying live source, survey storage and Telegram webhook...');
  const { validateSurvey } = await import(pathToFileURL(join(staging, 'src/surveys.mjs')).href);
  const definitions = await Promise.all(['employees', 'employers', 'business'].map(async id => {
    const survey = validateSurvey(JSON.parse(await readFile(join(staging, 'config/surveys/' + id + '.json'), 'utf8')));
    return 'const ' + id + ' = ' + JSON.stringify(survey) + ';';
  }));
  const paths = ['src/business-insights.mjs', 'src/locale-ru.mjs', 'src/pdf-fonts.mjs', 'src/report-format.mjs', 'src/survey-pdf.mjs', 'src/survey-insights.mjs', 'src/surveys.mjs', 'src/survey-telegram.mjs', 'src/survey-runtime.mjs', 'src/survey-worker.mjs'];
  const modules = await Promise.all(paths.map(async path => (await readFile(join(staging, path), 'utf8')).replace(/^import .*?;\r?\n/gm, '').replace(path === 'src/survey-worker.mjs' ? /$^/ : /^export /gm, '')));
  const expected = [...definitions, ...modules].join('\n');
  const liveSource = await (await cloud('')).text();
  if (!liveSource.includes(expected)) throw new Error('Live code did not match the audited release; verify deployment before announcing completion');
  const after = await settings();
  assertRetainedSurveyStorage(before, after);
  run(['scripts/check-live-health.mjs'], root, true);
  const response = await fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/getWebhookInfo', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000),
  });
  const info = await response.json();
  if (!response.ok || !info.ok || info.result.url !== workerUrl + '/telegram') throw new Error('Telegram webhook address could not be verified');
  console.log('Telegram webhook verified. Pending updates: ' + info.result.pending_update_count);
  if (info.result.last_error_date) console.log('Last recorded webhook error date: ' + new Date(info.result.last_error_date * 1000).toISOString());
  await writeFile(join(root, '.laylo', 'last-audited-deployment.json'), JSON.stringify({ revision, verifiedAt: new Date().toISOString() }, null, 2));
  console.log('LAYLO UPDATE COMPLETE - live source verified, survey storage retained.');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error('UPDATE STOPPED: ' + safeError(error)); process.exitCode = 1; });
}
