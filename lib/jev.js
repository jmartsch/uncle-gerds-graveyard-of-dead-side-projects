// Jev (TypeSafe AI) makes the typed decisions: revival odds, whether it is worth it, and Uncle Gerd's mood.
// System One decides, the LLM only writes. https://docs.typesafe.ai/api
import { call } from './connectors.js';
import { config } from './config.js';

export const MOODS = {
  told_you_so: 'He predicted from day one that it would never be finished.',
  proud: 'Surprisingly solid work that deserved a better fate.',
  nostalgic: 'It reminds him of the good old days of simple software.',
  baffled: 'He has no idea what it was even supposed to do.',
};

const prob = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function decide(facts) {
  const state = {
    repo: facts.fullName,
    description: facts.description,
    language: facts.language,
    created: facts.created,
    lastCommit: facts.died,
    lifespanDays: facts.lifespanDays,
    stars: facts.stars,
    archived: facts.archived,
    openIssues: facts.issues.length,
    lastCommits: facts.commits.map((c) => `${(c.date || '').slice(0, 10)} ${c.message}`),
    openIssueTitles: facts.issues.slice(0, 10).map((i) => i.title),
    readmeExcerpt: facts.readme.slice(0, 1500),
  };
  const res = await call('typesafe', '/v1/systemone', {
    method: 'POST',
    timeoutMs: 30_000,
    json: {
      model: config.jevModel,
      state,
      questions: {
        revivable: {
          type: 'noul',
          instructions: 'A developer can get this abandoned project running again with less than 30 minutes of fixes.',
        },
        worth_it: {
          type: 'noul',
          instructions: "Reviving this project would be worth its author's time.",
        },
        mood: {
          type: 'choice',
          instructions: 'How does Uncle Gerd, a grumpy but loving German uncle, feel about this abandoned project?',
          criteria: MOODS,
        },
      },
    },
  });
  const a = res.answers || {};
  const mood = typeof a.mood?.choice === 'string' && a.mood.choice in MOODS ? a.mood.choice : null;
  return {
    revival: prob(a.revivable?.noul),
    worthIt: prob(a.worth_it?.noul),
    mood,
    moodConfidence: prob(a.mood?.confidence) ?? prob(mood ? a.mood?.probabilities?.[mood] : null),
    model: res.model || config.jevModel,
  };
}
