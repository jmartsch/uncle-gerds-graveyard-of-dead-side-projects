// Run inside the museum Sprite: checks every connector and the Sprites token with one cheap call each.
//   node scripts/check.js
import { SpritesClient } from '@fly/sprites';
import { status, call } from '../lib/connectors.js';
import { config } from '../lib/config.js';

console.log(`Inside a Sprite: ${config.inSprite ? 'yes' : 'no (connectors fall back to direct keys from .env)'}\n`);

for (const [name, s] of Object.entries(await status())) {
  console.log(`${name.padEnd(10)} ${s ? `${s.mode} via ${s.source}` : 'not configured'}`);
}
console.log('');

const checks = {
  github: async () => `hello ${(await call('github', '/user', { headers: { accept: 'application/vnd.github+json' } })).login}`,
  ollama: async () => {
    const r = await call('ollama', '/v1/chat/completions', {
      method: 'POST',
      json: { model: config.ollamaModel, messages: [{ role: 'user', content: 'Reply with exactly: Na ja.' }] },
    });
    return `${config.ollamaModel} says "${r.choices?.[0]?.message?.content?.trim()}"`;
  },
  typesafe: async () => {
    const r = await call('typesafe', '/v1/systemone', {
      method: 'POST',
      json: { model: config.jevModel, state: 'It is Thanksgiving and the pie is on the table.', questions: { pie: { type: 'noul', instructions: 'There is pie.' } } },
    });
    return `Jev: p(pie) = ${r.answers?.pie?.noul}`;
  },
  anthropic: async () => {
    const r = await call('anthropic', '/v1/models', { headers: { 'anthropic-version': '2023-06-01' } });
    return `${r.data?.length ?? '?'} Claude models visible`;
  },
  sprites: async () => {
    if (!config.spritesToken) throw new Error('SPRITES_TOKEN is not set');
    await new SpritesClient(config.spritesToken).listSprites({ prefix: 'ugm-' });
    return 'token works';
  },
};

let failed = 0;
for (const [name, check] of Object.entries(checks)) {
  try {
    console.log(`✔ ${name.padEnd(10)} ${await check()}`);
  } catch (err) {
    failed += 1;
    console.log(`✘ ${name.padEnd(10)} ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
