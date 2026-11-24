// The curator: finds dead repos, lets Jev judge them, lets Uncle Gerd comment.
// Own museum → data/exhibits.json. Guest museums (any GitHub user) → data/guests/<name>.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { readJSON, writeJSON } from './store.js';
import * as github from './github.js';
import { decide } from './jev.js';
import { writeExhibitTexts, templateTexts } from './llm.js';
import { hold } from './hold.js';

const pct = (p) => (p == null ? '?' : `${Math.round(p * 100)}%`);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'exhibit';
const year = (iso) => (iso ? new Date(iso).getUTCFullYear() : '?');
const now = () => new Date().toISOString();

function makeLogger(target, prefix) {
  return (msg, kind = 'info') => {
    target.log.push({ t: now(), kind, msg });
    if (target.log.length > 200) target.log.splice(0, target.log.length - 200);
    console.log(`[${prefix}] ${msg}`);
  };
}

// ---------- own museum ----------
const own = { running: false, startedAt: null, finishedAt: null, error: null, log: [] };
export const scanState = () => ({ ...own, log: own.log.slice(-200) });

export function startScan(opts = {}) {
  if (own.running) return false;
  Object.assign(own, { running: true, startedAt: now(), finishedAt: null, error: null, log: [] });
  const log = makeLogger(own, 'scan');
  const release = hold('ugm-scan');
  runScan({ ...opts, log })
    .catch((err) => {
      own.error = err.message;
      log(err.message, 'fail');
    })
    .finally(() => {
      own.running = false;
      own.finishedAt = now();
      release();
    });
  return true;
}

// ---------- guest museums ----------
export const GUEST_NAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const guests = new Map(); // name -> { status: queued|running|done|error, error, log, position }
const queue = [];
const recentScans = [];
let pumping = false;

export class GuestLimitError extends Error {
  constructor(message, retryAfter) {
    super(message);
    this.retryAfter = retryAfter; // seconds until it makes sense to try again
  }
}

// Running average of how long an excavation takes, for the "about N minutes" estimate.
const durations = [];
const avgSeconds = () => (durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 80);
let currentStartedAt = 0;

const guestFile = (name) => `guests/${name}.json`;

export async function loadGuest(name) {
  return readJSON(guestFile(name));
}

// Every guest graveyard dug so far, newest first.
export async function listGuests() {
  let files = [];
  try {
    files = await fs.readdir(path.join(config.dataDir, 'guests'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const rows = await Promise.all(
    files
      .filter((f) => f.endsWith('.json'))
      .map(async (f) => {
        const name = f.slice(0, -5);
        const data = await loadGuest(name).catch(() => null);
        if (!data) return null;
        return { name: data.owner || name, slug: name, count: data.exhibits?.length || 0, generatedAt: data.generatedAt || null };
      }),
  );
  return rows.filter(Boolean).sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
}

export function guestState(name) {
  const s = guests.get(name);
  if (!s) return null;
  const position = s.status === 'queued' ? queue.indexOf(name) + 1 : 0;
  let etaSeconds = 0;
  if (position) {
    // Whatever is left of the running dig, plus one full dig per museum ahead, plus our own.
    const avg = avgSeconds();
    const runningLeft = pumping ? Math.max(10, avg - (Date.now() - currentStartedAt) / 1000) : 0;
    etaSeconds = Math.round(runningLeft + (position - 1) * avg + avg);
  }
  return { status: s.status, error: s.error, position, total: queue.length, etaSeconds, log: s.log.slice(-30) };
}

export function startGuestScan(name) {
  const existing = guests.get(name);
  if (existing && (existing.status === 'queued' || existing.status === 'running')) return guestState(name);
  const hourAgo = Date.now() - 3_600_000;
  while (recentScans.length && recentScans[0] < hourAgo) recentScans.shift();
  if (recentScans.length >= config.guestScansPerHour) {
    const retryAfter = Math.max(30, Math.ceil((recentScans[0] + 3_600_000 - Date.now()) / 1000));
    throw new GuestLimitError('Uncle Gerd has dug enough graves this hour.', retryAfter);
  }
  if (queue.length >= config.guestQueueMax) {
    throw new GuestLimitError('The cemetery gate is crowded.', 30);
  }
  recentScans.push(Date.now());
  guests.set(name, { status: 'queued', error: null, log: [] });
  queue.push(name);
  pump();
  return guestState(name);
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const name = queue.shift();
    const s = guests.get(name);
    s.status = 'running';
    currentStartedAt = Date.now();
    const log = makeLogger(s, `guest:${name}`);
    const release = hold(`ugm-guest-${name}`);
    try {
      await runScan({ owner: name, guest: true, max: config.maxExhibits, log, out: guestFile(name) });
      s.status = 'done';
      durations.push((Date.now() - currentStartedAt) / 1000);
      if (durations.length > 10) durations.shift();
    } catch (err) {
      s.status = 'error';
      s.error = err.message;
      log(err.message, 'fail');
    } finally {
      release();
    }
  }
  pumping = false;
}

// ---------- the actual excavation ----------
export async function runScan({
  repos = config.exhibitRepos,
  max = config.maxExhibits,
  owner = null,
  guest = false,
  out = 'exhibits.json',
  log = (msg) => console.log(`[scan] ${msg}`),
} = {}) {
  log(
    owner
      ? `Looking for ${owner}'s public repos without a push in ${config.deadAfterDays} days…`
      : repos.length
        ? `Fetching ${repos.length} hand-picked repos…`
        : `Looking for public repos without a push in ${config.deadAfterDays} days…`,
    'step',
  );
  const picked = await github.pickDeadRepos({
    explicit: owner ? [] : repos,
    max,
    owner,
    deadAfterDays: config.deadAfterDays,
    includePrivate: !owner && config.includePrivate,
  });

  const exhibits = [];
  const ids = new Set();
  for (const repo of picked) {
    log(`Exhuming ${repo.full_name}…`, 'step');
    const facts = await gatherFacts(repo);
    const quest = pickQuest(facts);

    let decisions = null;
    try {
      decisions = await decide(facts);
      log(`Jev: revival ${pct(decisions.revival)}, worth it ${pct(decisions.worthIt)}, mood ${decisions.mood ?? '?'}`);
    } catch (err) {
      log(`Jev is unavailable (${err.message}), so no odds for this one.`, 'warn');
    }

    let texts;
    try {
      texts = await writeExhibitTexts(facts, { mood: decisions?.mood || 'told_you_so', quest, guest });
      log('Uncle Gerd has written his commentary.');
    } catch (err) {
      log(`Ollama is unavailable (${err.message}), so Uncle Gerd uses his spare lines.`, 'warn');
      texts = templateTexts(facts, { mood: decisions?.mood });
    }

    let id = slug(facts.name);
    while (ids.has(id)) id = `${id}-x`;
    ids.add(id);
    exhibits.push(buildExhibit(id, facts, quest, decisions, texts));
  }

  if (!exhibits.length && !owner) {
    throw new Error('No dead repos found. Lucky you. (Try DEAD_AFTER_DAYS=180 or EXHIBIT_REPOS=owner/repo)');
  }
  await writeJSON(out, {
    generatedAt: now(),
    owner: owner || picked[0]?.owner?.login || null,
    guest,
    exhibits,
  });
  log(exhibits.length ? `Museum ready: ${exhibits.length} exhibits.` : 'Not a single dead repo. Uncle Gerd is almost disappointed.', 'ok');
  return exhibits;
}

async function gatherFacts(repo) {
  const fullName = repo.full_name;
  const [readme, commits, issues] = await Promise.all([
    github.getReadme(fullName),
    github.getCommits(fullName, 5),
    github.getOpenIssues(fullName, 20),
  ]);
  const died = commits[0]?.date || repo.pushed_at;
  return {
    fullName,
    name: repo.name,
    owner: repo.owner?.login,
    description: repo.description || '',
    language: repo.language || 'mystery code',
    stars: repo.stargazers_count || 0,
    archived: Boolean(repo.archived),
    private: Boolean(repo.private),
    url: repo.html_url,
    created: repo.created_at,
    died,
    lifespanDays: Math.max(1, Math.round((new Date(died) - new Date(repo.created_at)) / 86_400_000)),
    readme: typeof readme === 'string' ? readme.slice(0, 4000) : '',
    commits,
    issues,
  };
}

// The revival quest: the open issue with the least discussion and the shortest description.
function pickQuest(facts) {
  const size = (i) => i.body.length + i.comments * 50;
  const issue = [...facts.issues].sort((a, b) => size(a) - size(b))[0];
  if (issue) return { title: `#${issue.number} ${issue.title}`, url: issue.url, kind: 'issue' };
  return { title: 'Make it start again on a modern runtime', url: facts.url, kind: 'generic' };
}

function buildExhibit(id, facts, quest, decisions, texts) {
  return {
    id,
    repo: facts.fullName,
    url: facts.url,
    private: facts.private,
    title: texts.title || facts.name,
    years: `${year(facts.created)}–${year(facts.died)}`,
    born: facts.created,
    died: facts.died,
    lifespanDays: facts.lifespanDays,
    language: facts.language,
    stars: facts.stars,
    openIssues: facts.issues.length,
    lastWords: facts.commits[0]?.message || '(no last words)',
    causeOfDeath: texts.causeOfDeath,
    plaque: texts.plaque,
    uncle: { line: texts.uncle, mood: decisions?.mood || null, quip: texts.doorQuip || null },
    odds: decisions
      ? { revival: decisions.revival, worthIt: decisions.worthIt, moodConfidence: decisions.moodConfidence, model: decisions.model }
      : null,
    quest: { ...quest, why: texts.questWhy },
    artifacts: [
      ...facts.commits.slice(0, 3).map((c) => ({ kind: 'commit', label: c.message, date: c.date, url: c.url })),
      ...facts.issues.slice(0, 2).map((i) => ({ kind: 'issue', label: `#${i.number} ${i.title}`, date: i.created, url: i.url })),
    ],
    textSource: texts.source,
  };
}
