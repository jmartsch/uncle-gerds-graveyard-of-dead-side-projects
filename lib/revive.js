// Brings a dead project back to life on its own Sprite:
// fresh Sprite → git clone → checkpoint → Claude Code headless → service on :8080 → public URL.
// If the patient flatlines, restore the checkpoint and try again with what we learned.
import { SpritesClient } from '@fly/sprites';
import { config } from './config.js';
import { readJSON, writeJSON } from './store.js';
import { resolve as resolveConnector } from './connectors.js';
import { hold } from './hold.js';

const FILE = 'revivals.json';
const APP_DIR = '/home/sprite/exhibit';
const START = 'museum-start.sh';

let revivals = null; // exhibit id -> record
const running = new Set();
let writeTimer = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const entry = (msg, kind = 'info') => ({ t: new Date().toISOString(), kind, msg });
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export const spriteName = (id) => `${config.exhibitPrefix}${id}`.slice(0, 63).replace(/-+$/, '');

async function load() {
  if (!revivals) {
    revivals = (await readJSON(FILE, {})) || {};
    for (const r of Object.values(revivals)) {
      if (r.status === 'reviving') {
        r.status = 'failed';
        r.log.push(entry('Interrupted: the museum restarted in the middle of the surgery.', 'fail'));
      }
    }
  }
  return revivals;
}

function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    writeJSON(FILE, revivals).catch((err) => console.error('Could not save revivals:', err.message));
  }, 400);
}

export async function allRevivals() {
  return load();
}

export async function getRevival(id) {
  return (await load())[id] || { status: 'idle', log: [] };
}

export async function startRevival(exhibit, { simulate = false } = {}) {
  const all = await load();
  if (running.has(exhibit.id)) return all[exhibit.id];
  const rec = {
    status: 'reviving',
    sprite: null,
    url: null,
    attempts: 0,
    simulated: simulate,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    log: [],
  };
  all[exhibit.id] = rec;
  running.add(exhibit.id);
  const log = (msg, kind) => {
    rec.log.push(entry(msg, kind));
    if (rec.log.length > 400) rec.log.splice(0, rec.log.length - 400);
    persist();
    console.log(`[revive:${exhibit.id}] ${msg}`);
  };
  const release = hold(`ugm-revive-${exhibit.id}`);
  (simulate ? simulateRevival : realRevival)(exhibit, rec, log)
    .catch((err) => {
      rec.status = 'failed';
      log(`Revival failed: ${err.message}`, 'fail');
    })
    .finally(() => {
      rec.finishedAt = new Date().toISOString();
      running.delete(exhibit.id);
      release();
      persist();
    });
  return rec;
}

// Demo mode: the same story with fake steps, so the UI can be built without a Fly.io account.
async function simulateRevival(exhibit, rec, log) {
  const name = spriteName(exhibit.id);
  rec.sprite = name;
  const steps = [
    [700, `Spawning a fresh Sprite: ${name}`, 'step'],
    [900, `Digging up ${exhibit.repo}…`, 'step'],
    [700, 'Checkpoint v1 saved: "before surgery".', 'step'],
    [600, 'Attempt 1: Claude Code is operating…', 'step'],
    [900, '🔧 Bash: npm install', 'agent'],
    [1000, '🔧 Bash: npm start → Error: Cannot find module "left-pad"', 'agent'],
    [700, 'Patient flatlined: Cannot find module "left-pad"', 'fail'],
    [900, 'Restoring checkpoint v1…', 'step'],
    [600, 'Attempt 2: Claude Code is operating…', 'step'],
    [1000, '🔧 Edit: package.json', 'agent'],
    [1000, `🔧 Bash: ./${START} & curl -sf localhost:8080`, 'agent'],
    [700, 'Starting the exhibit as a Sprite service…', 'step'],
    [700, 'Pulse detected on port 8080.', 'ok'],
  ];
  for (const [ms, msg, kind] of steps) {
    await sleep(ms);
    if (msg.startsWith('Attempt')) rec.attempts += 1;
    log(msg, kind);
  }
  rec.url = exhibit.url;
  rec.status = 'live';
  log("IT'S ALIVE! (simulation: no Sprite was harmed)", 'ok');
}

async function realRevival(exhibit, rec, log) {
  if (!config.spritesToken) throw new Error('SPRITES_TOKEN is missing on the museum Sprite.');
  const auth = await reviverAuth();
  const client = new SpritesClient(config.spritesToken);
  const name = spriteName(exhibit.id);
  rec.sprite = name;

  log(`Spawning a fresh Sprite: ${name}`, 'step');
  let sprite;
  try {
    sprite = await client.getSprite(name);
    log('That Sprite already exists, reusing it.');
    await sprite.updateURLSettings({ auth: 'public' });
  } catch {
    sprite = await client.createSprite(name, {
      labels: ['ugm', 'exhibit'],
      urlSettings: { auth: 'public' },
      waitForCapacity: true,
    });
  }

  log(`Digging up ${exhibit.repo}…`, 'step');
  await sh(sprite, await cloneScript(exhibit), { timeout: 5 * 60_000 });

  log('Checkpoint before surgery…', 'step');
  const checkpoint = await createCheckpoint(sprite, `ugm: before reviving ${exhibit.repo}`);
  log(`Checkpoint ${checkpoint} saved.`);

  let lastError = '';
  for (let attempt = 1; attempt <= config.reviveAttempts; attempt++) {
    rec.attempts = attempt;
    log(`Attempt ${attempt}: Claude Code is operating…`, 'step');
    const operated = await runAgent(sprite, exhibit, { attempt, lastError, auth, log });
    if (operated.ok) {
      log('Starting the exhibit as a Sprite service…', 'step');
      const served = await serve(sprite, log);
      if (served.ok) {
        rec.url = (await client.getSprite(name)).url || null;
        rec.status = 'live';
        log(`IT'S ALIVE! ${rec.url || ''}`.trim(), 'ok');
        return;
      }
      lastError = served.error;
    } else {
      lastError = operated.error;
    }
    log(`Patient flatlined: ${lastError.slice(0, 240)}`, 'fail');
    if (attempt < config.reviveAttempts) {
      log(`Restoring checkpoint ${checkpoint}…`, 'step');
      await restoreCheckpoint(sprite, checkpoint);
      await waitForSprite(sprite);
    }
  }
  rec.status = 'failed';
  log('Uncle Gerd: "Told you so."', 'fail');
}

// Claude Code on the exhibit Sprite talks to Anthropic through the gateway, so no key lands there.
async function reviverAuth() {
  const anthropic = await resolveConnector('anthropic');
  if (anthropic?.mode === 'gateway') {
    return { ANTHROPIC_BASE_URL: anthropic.base, ANTHROPIC_API_KEY: process.env.REVIVE_DUMMY_KEY || 'sprites-gateway' };
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN };
  throw new Error('Claude Code has no way in: set up the Anthropic connector (or CLAUDE_CODE_OAUTH_TOKEN).');
}

async function cloneScript(exhibit) {
  if (!exhibit.private) {
    return `rm -rf ${APP_DIR} && git clone --depth 50 ${q(`https://github.com/${exhibit.repo}.git`)} ${APP_DIR}`;
  }
  // Private repos: download the tarball through the GitHub connector (untested; the exhibit Sprite needs access).
  const github = await resolveConnector('github');
  if (github?.mode !== 'gateway') throw new Error('Private repos need the GitHub connector.');
  return [
    'set -e',
    `rm -rf ${APP_DIR} && mkdir -p ${APP_DIR}`,
    `curl -fsSL ${q(`${github.base}/repos/${exhibit.repo}/tarball`)} | tar xz --strip-components=1 -C ${APP_DIR}`,
    `cd ${APP_DIR} && git init -q && git add -A && git -c user.name=museum -c user.email=museum@localhost commit -qm exhumed`,
  ].join('\n');
}

async function sh(sprite, script, { timeout = 120_000, env } = {}) {
  try {
    return await sprite.execFile('bash', ['-lc', script], { timeout, env });
  } catch (err) {
    const detail = String(err.stderr || err.stdout || err.message || '').trim().slice(-500);
    throw new Error(detail || `command failed with exit code ${err.exitCode}`);
  }
}

async function drain(stream, onMessage = () => {}) {
  for (let msg = await stream.next(); msg; msg = await stream.next()) onMessage(msg);
}

async function createCheckpoint(sprite, comment) {
  await drain(await sprite.createCheckpoint(comment), (m) => {
    if (m.type === 'error') throw new Error(m.error || m.data || 'checkpoint failed');
  });
  const mine = (await sprite.listCheckpoints())
    .filter((c) => c.comment === comment && c.id !== 'Current')
    .sort((a, b) => new Date(b.createTime) - new Date(a.createTime));
  if (!mine[0]) throw new Error('Checkpoint was created but does not show up in the list');
  return mine[0].id;
}

async function restoreCheckpoint(sprite, id) {
  await drain(await sprite.restoreCheckpoint(id), (m) => {
    if (m.type === 'error') throw new Error(m.error || m.data || 'restore failed');
  });
}

async function waitForSprite(sprite) {
  for (let i = 0; i < 20; i++) {
    try {
      await sprite.execFile('true', [], { timeout: 15_000 });
      return;
    } catch {
      await sleep(1500);
    }
  }
  throw new Error('The Sprite did not come back after the restore');
}

function agentPrompt(exhibit, attempt, lastError) {
  return [
    `You are reviving "${exhibit.repo}", an abandoned side project, so it can be shown live in a museum.`,
    'Goal: the project runs and serves something meaningful over HTTP on port 8080, bound to 0.0.0.0.',
    'Rules:',
    '- Work only inside the current directory. Keep the original app and make the smallest changes that get it running (dependency versions, build config, missing scripts, sensible env defaults).',
    '- A static site gets a tiny static server. A CLI or library gets a minimal web page on port 8080 that demonstrates it.',
    `- Do all installs and builds now. Then create an executable ./${START} that starts the app in the foreground on port 8080 without installing anything.`,
    `- Verify: start ./${START} in the background, run curl -sf http://localhost:8080, then stop it again. Leave nothing running.`,
    '- Never read or print secrets. Never push anything anywhere.',
    'End your reply with exactly one line: REVIVED, or DEAD: <short reason>.',
    attempt > 1 ? `\nA previous attempt failed with:\n${lastError.slice(-1500)}\nTry a different approach this time.` : '',
  ].join('\n');
}

function describeTool(block) {
  const i = block.input || {};
  const detail = i.command || i.file_path || i.path || i.pattern || i.url || i.description || '';
  return String(detail).replace(/\s+/g, ' ').slice(0, 160);
}

// Runs Claude Code headless and turns its stream-json events into a live surgery log.
async function runAgent(sprite, exhibit, { attempt, lastError, auth, log }) {
  const args = ['-p', agentPrompt(exhibit, attempt, lastError), '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'];
  if (config.reviveModel) args.push('--model', config.reviveModel);
  const proc = sprite.spawn('bash', ['-lc', `cd ${APP_DIR} && claude ${args.map(q).join(' ')}`], { env: auth });

  let buffer = '';
  let stderrTail = '';
  let result = '';
  let isError = false;
  const onLine = (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      log(line.slice(0, 200), 'agent');
      return;
    }
    if (ev.type === 'system' && ev.subtype === 'init') log(`Claude Code scrubs in${ev.model ? ` (${ev.model})` : ''}.`, 'agent');
    if (ev.type === 'assistant') {
      for (const block of ev.message?.content || []) {
        if (block.type === 'tool_use') log(`🔧 ${block.name}: ${describeTool(block)}`, 'agent');
        else if (block.type === 'text' && block.text?.trim()) log(`💬 ${block.text.trim().split('\n')[0].slice(0, 200)}`, 'agent');
      }
    }
    if (ev.type === 'result') {
      result = String(ev.result || '');
      isError = Boolean(ev.is_error);
    }
  };
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onLine(line);
    }
  });
  proc.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });
  proc.on('error', (err) => {
    stderrTail += `\n${err.message}`;
  });

  const timer = setTimeout(() => {
    log('The surgery takes too long. Pulling the plug.', 'fail');
    proc.kill();
  }, config.reviveTimeoutMin * 60_000);
  let code;
  try {
    code = await proc.wait();
  } finally {
    clearTimeout(timer);
  }
  if (buffer.trim()) onLine(buffer.trim());

  const verdict = result.trim().split('\n').pop() || '';
  if (code === 0 && !isError && /^REVIVED\b/i.test(verdict)) return { ok: true };
  return { ok: false, error: verdict || stderrTail.trim().slice(-400) || `claude exited with code ${code}` };
}

// Runs ./museum-start.sh as a Sprite service, so the exhibit wakes up whenever someone visits its URL.
async function serve(sprite, log) {
  try {
    await sh(sprite, `cd ${APP_DIR} && test -f ./${START} && chmod +x ./${START}`, { timeout: 30_000 });
  } catch (err) {
    return { ok: false, error: `No ./${START} to start: ${err.message}` };
  }
  // Free port 8080 in case the agent left its test server running (kill by port, not by name).
  await sh(sprite, `for p in $(ss -ltnpH 'sport = :8080' 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$p"; done; true`, { timeout: 30_000 }).catch(() => {});
  try {
    await sprite.deleteService('exhibit');
  } catch {}
  try {
    const stream = await sprite.createService('exhibit', { cmd: '/bin/bash', args: [`${APP_DIR}/${START}`], dir: APP_DIR, httpPort: 8080 }, '10s');
    let exited = null;
    await drain(stream, (ev) => {
      if (ev.type === 'exit') exited = `the start script exited with code ${ev.exitCode}`;
      if (ev.type === 'error') exited = ev.data || 'service error';
    });
    if (exited) return { ok: false, error: exited };
  } catch (err) {
    return { ok: false, error: `service: ${err.message}` };
  }
  for (let i = 0; i < 20; i++) {
    try {
      await sh(sprite, 'curl -fsS -o /dev/null --max-time 5 http://localhost:8080', { timeout: 15_000 });
      log('Pulse detected on port 8080.', 'ok');
      return { ok: true };
    } catch {
      await sleep(2000);
    }
  }
  return { ok: false, error: 'Nothing answered on port 8080.' };
}
