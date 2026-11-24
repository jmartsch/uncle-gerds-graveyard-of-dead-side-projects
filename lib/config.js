import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env from the project root if present. Real environment variables win.
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {}

const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

export const config = {
  port: num(env.PORT, 8080),
  dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
  fixtures: env.FIXTURES === '1',
  adminKey: env.ADMIN_KEY || '',
  // Curator
  exhibitRepos: list(env.EXHIBIT_REPOS),
  maxExhibits: num(env.MAX_EXHIBITS, 3),
  deadAfterDays: num(env.DEAD_AFTER_DAYS, 365),
  includePrivate: env.INCLUDE_PRIVATE === '1',
  guestScansPerHour: num(env.GUEST_SCANS_PER_HOUR, 30),
  guestQueueMax: num(env.GUEST_QUEUE_MAX, 10),
  ollamaModel: env.OLLAMA_MODEL || 'kimi-k3',
  jevModel: env.JEV_MODEL || 'jev-latest',
  // Revival
  spritesToken: env.SPRITES_TOKEN || '',
  exhibitPrefix: env.EXHIBIT_PREFIX || 'ugm-exhibit-',
  reviveAttempts: num(env.REVIVE_ATTEMPTS, 2),
  reviveTimeoutMin: num(env.REVIVE_TIMEOUT_MIN, 15),
  reviveModel: env.REVIVE_MODEL || '',
  // Are we running inside a Sprite? (connectors only work from inside one)
  inSprite: fs.existsSync('/.sprite'),
};
