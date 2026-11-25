// German grave texts. Ollama translates a whole graveyard once, in Uncle Gerd's German voice;
// the result is cached next to the graveyard and thrown away when the graveyard is dug up again.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { readJSON, writeJSON } from './store.js';
import { call } from './connectors.js';
import { hold } from './hold.js';

export const LANGS = ['en', 'de'];
const RETRY_AFTER_MS = 5 * 60_000;
const running = new Map(); // cache key -> promise
const failedAt = new Map(); // cache key -> timestamp of the last failure

const SYSTEM = `You translate the texts of "Uncle Gerd's Graveyard of Dead Side Projects" from English into German.
Uncle Gerd is a grumpy but loving German uncle in a beige cardigan. In German he may say "Ach, Junge", "Na ja" or "Na also" and calls the developer "Junge". Use "du", never "Sie".
Rules:
- Translate every string value into natural, short, funny German. Keep the tone, the jokes and every fact.
- Do not translate repository names, code, file names, commit messages or issue titles in quotes, numbers or programming languages.
- Return a single JSON object with exactly the same ids and keys as the input, nothing else.`;

const clip = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

function parseJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// The texts Ollama (or the template) wrote for each exhibit, keyed by exhibit id.
function sourceTexts(exhibits) {
  const out = {};
  for (const ex of exhibits) {
    const t = { title: ex.title, plaque: ex.plaque, causeOfDeath: ex.causeOfDeath, uncle: ex.uncle?.line, quip: ex.uncle?.quip, questWhy: ex.quest?.why };
    out[ex.id] = Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'string' && v.trim()));
  }
  return out;
}

function merge(exhibits, texts) {
  return exhibits.map((ex) => {
    const t = texts[ex.id];
    if (!t) return ex;
    return {
      ...ex,
      title: t.title || ex.title,
      plaque: t.plaque || ex.plaque,
      causeOfDeath: t.causeOfDeath || ex.causeOfDeath,
      uncle: ex.uncle && { ...ex.uncle, line: t.uncle || ex.uncle.line, quip: t.quip || ex.uncle.quip },
      quest: ex.quest && { ...ex.quest, why: t.questWhy || ex.quest.why },
    };
  });
}

async function askOllama(source) {
  const body = {
    model: config.ollamaModel,
    temperature: 0.4,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: JSON.stringify(source, null, 2) },
    ],
  };
  let res;
  try {
    res = await call('ollama', '/v1/chat/completions', { method: 'POST', timeoutMs: 180_000, json: { ...body, response_format: { type: 'json_object' } } });
  } catch (err) {
    if (err.status !== 400) throw err;
    res = await call('ollama', '/v1/chat/completions', { method: 'POST', timeoutMs: 180_000, json: body });
  }
  const parsed = parseJSON(res.choices?.[0]?.message?.content || '');
  if (!parsed) throw new Error('The translation was not JSON');
  const texts = {};
  for (const [id, fields] of Object.entries(source)) {
    const got = parsed[id];
    if (!got || typeof got !== 'object') continue;
    texts[id] = {};
    for (const key of Object.keys(fields)) {
      const value = clip(got[key], key === 'plaque' || key === 'uncle' ? 700 : 400);
      if (value) texts[id][key] = value;
    }
  }
  if (!Object.keys(texts).length) throw new Error('The translation came back empty');
  return texts;
}

function translate(key, data) {
  if (running.has(key)) return running.get(key);
  const release = hold(`ugm-translate-${key}`.slice(0, 60));
  const job = askOllama(sourceTexts(data.exhibits))
    .then((texts) => writeJSON(`i18n/de/${key}.json`, { source: data.generatedAt, texts }))
    .then(() => failedAt.delete(key))
    .catch((err) => {
      failedAt.set(key, Date.now());
      console.error(`[translate:${key}] ${err.message}`);
    })
    .finally(() => {
      running.delete(key);
      release();
    });
  running.set(key, job);
  return job;
}

// Returns the graveyard in the wanted language. German texts that are not ready yet come back in English,
// marked translation: 'pending' (or 'failed'), while Ollama works in the background.
export async function localize(data, lang, key) {
  if (lang !== 'de' || !data?.exhibits?.length) return { ...data, lang: 'en' };
  if (data.demo) {
    const demo = JSON.parse(await fs.readFile(path.join(ROOT, 'fixtures', 'exhibits.de.json'), 'utf8'));
    return { ...data, lang: 'de', exhibits: merge(data.exhibits, demo.texts) };
  }
  const cached = await readJSON(`i18n/de/${key}.json`);
  if (cached?.source === data.generatedAt) return { ...data, lang: 'de', exhibits: merge(data.exhibits, cached.texts) };
  if (Date.now() - (failedAt.get(key) || 0) < RETRY_AFTER_MS) return { ...data, lang: 'en', translation: 'failed' };
  translate(key, data);
  return { ...data, lang: 'en', translation: 'pending' };
}
