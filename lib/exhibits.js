import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { readJSON } from './store.js';
import { allRevivals } from './revive.js';

// Real exhibits once the curator has run, demo exhibits until then (or with FIXTURES=1).
export async function loadExhibits() {
  if (!config.fixtures) {
    const data = await readJSON('exhibits.json');
    if (data?.exhibits?.length) return { ...data, demo: false };
  }
  const demo = JSON.parse(await fs.readFile(path.join(ROOT, 'fixtures', 'exhibits.json'), 'utf8'));
  return { ...demo, demo: true };
}

const summarize = (r) =>
  r
    ? { status: r.status, url: r.url, attempts: r.attempts, simulated: r.simulated, finishedAt: r.finishedAt, log: r.log.slice(-60) }
    : { status: 'idle', log: [] };

export async function exhibitsWithRevivals() {
  const data = await loadExhibits();
  const revivals = await allRevivals();
  return { ...data, exhibits: data.exhibits.map((e) => ({ ...e, revival: summarize(revivals[e.id]) })) };
}
