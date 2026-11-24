// Ollama Cloud writes Uncle Gerd's lines. If it is unavailable, Uncle Gerd uses his spare lines.
import { call } from './connectors.js';
import { config } from './config.js';

const SYSTEM = `You write the exhibit texts for "Uncle Gerd's Museum of Dead Side Projects", a pixel-art museum where a developer's abandoned GitHub repositories are on display.
Uncle Gerd is the curator: a German uncle in a beige cardigan, grumpy but loving. He says things like "Ach, Junge" or "Na ja", compares everything to 1998, is never cruel and always specific.
Write in English. Use ONLY facts from the repository data you get. Never invent features, users, numbers or dates. Short and funny beats long.
Return a single JSON object with exactly these keys:
- "title": exhibit name, at most 6 words, no years
- "plaque": 2 sentences in a dry museum-curator voice about what the project was
- "causeOfDeath": at most 12 words, grounded in the commits or issues
- "uncle": 1-2 sentences (max 45 words) in Uncle Gerd's voice, matching his mood, quoting or referencing one concrete detail (a commit message, an issue, the language or the dates)
- "questWhy": 1 sentence (max 30 words) on why the suggested quest is the best first step back to life
- "doorQuip": what Uncle Gerd mutters when you walk up to this exhibit's door: max 12 words, about one concrete detail of THIS repo (name, language, a commit message, the years, the stars), different from the "uncle" line`;

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

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

// Guests are strangers who typed in their own GitHub name: Uncle Gerd stays extra warm with them.
const GUEST_NOTE = `\nThis museum belongs to a guest visiting for the first time. Tease only very gently, like a proud uncle meeting a new nephew; always end on something kind.`;

export async function writeExhibitTexts(facts, { mood, quest, guest = false }) {
  const repo = {
    name: facts.name,
    description: facts.description,
    language: facts.language,
    created: facts.created,
    lastCommitDate: facts.died,
    lifespanDays: facts.lifespanDays,
    stars: facts.stars,
    archived: facts.archived,
    lastCommits: facts.commits.map((c) => ({ date: (c.date || '').slice(0, 10), message: c.message })),
    openIssues: facts.issues.slice(0, 10).map((i) => i.title),
    readme: facts.readme.slice(0, 3000),
  };
  const messages = [
    { role: 'system', content: guest ? SYSTEM + GUEST_NOTE : SYSTEM },
    { role: 'user', content: JSON.stringify({ uncleMood: mood, suggestedQuest: quest.title, repository: repo }, null, 2) },
  ];
  const body = { model: config.ollamaModel, temperature: 0.9, messages };
  let res;
  try {
    res = await call('ollama', '/v1/chat/completions', {
      method: 'POST',
      timeoutMs: 120_000,
      json: { ...body, response_format: { type: 'json_object' } },
    });
  } catch (err) {
    if (err.status !== 400) throw err;
    // Some models reject response_format: ask again without it.
    res = await call('ollama', '/v1/chat/completions', { method: 'POST', timeoutMs: 120_000, json: body });
  }
  const parsed = parseJSON(res.choices?.[0]?.message?.content || '');
  if (!parsed) throw new Error('Uncle Gerd mumbled something that was not JSON');
  return {
    title: clip(parsed.title, 60),
    plaque: clip(parsed.plaque, 600),
    causeOfDeath: clip(parsed.causeOfDeath, 120),
    uncle: clip(parsed.uncle, 500),
    questWhy: clip(parsed.questWhy, 320),
    doorQuip: clip(parsed.doorQuip, 120),
    source: `ollama:${config.ollamaModel}`,
  };
}

const prettify = (name) => name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function templateTexts(facts, { mood } = {}) {
  const last = facts.commits[0]?.message || '';
  const n = facts.issues.length;
  const causeOfDeath = /tomorrow|later|todo|wip|tmp|temp|fixme/i.test(last)
    ? 'Died mid-sentence, as one does.'
    : n
      ? `Buried under ${n} open issue${n === 1 ? '' : 's'}.`
      : 'Natural causes: a shinier idea came along.';
  const lines = {
    told_you_so: `Ach, Junge. "${last || 'Initial commit'}" – and then nothing. I told you so.`,
    proud: 'Na ja, this one was actually not bad. A pity, really.',
    nostalgic: `${facts.language}! In 1998 we had one server, and it ran. Those were the days.`,
    baffled: "I looked at this for ten minutes and I still don't know what it does.",
  };
  return {
    title: prettify(facts.name),
    plaque: facts.description
      ? `${facts.description.replace(/\.?\s*$/, '.')} Written in ${facts.language}.`
      : `A ${facts.language} project whose purpose has been lost to history.`,
    causeOfDeath,
    uncle: lines[mood] || lines.told_you_so,
    questWhy: 'It is the smallest step back to life.',
    source: 'template',
  };
}
