// Calls external APIs through the Sprites connector gateway, so no provider key ever lives on the Sprite.
// Inside a Sprite the gateway URLs are discovered via /v1/gateway/list (or set via GW_* env vars).
// Outside a Sprite (local development) the gateway answers 401, so we fall back to direct keys from .env.
import { config } from './config.js';

const GATEWAY_LIST = 'https://api.sprites.dev/v1/gateway/list';

const PROVIDERS = {
  github: { env: 'GW_GITHUB', direct: 'https://api.github.com', keyEnv: 'GITHUB_TOKEN' },
  ollama: { env: 'GW_OLLAMA', direct: 'https://ollama.com', keyEnv: 'OLLAMA_API_KEY' },
  typesafe: { env: 'GW_TYPESAFE', direct: 'https://api.typesafe.ai', keyEnv: 'TYPESAFE_API_KEY' },
  anthropic: { env: 'GW_ANTHROPIC', direct: null, keyEnv: null },
};

export class ConnectorMissing extends Error {
  constructor(provider) {
    const key = PROVIDERS[provider]?.keyEnv;
    super(`No ${provider} connector for this Sprite${key ? ` (local dev: set ${key})` : ''}`);
    this.provider = provider;
  }
}

export class ConnectorError extends Error {
  constructor(provider, status, detail) {
    super(`${provider} answered ${status}${detail ? `: ${detail}` : ''}`);
    this.provider = provider;
    this.status = status;
  }
}

let discovery = { at: 0, entries: [] };

async function discover() {
  if (!config.inSprite) return [];
  // Cache successful lookups for 10 minutes, retry failed ones after 30 seconds.
  const ttl = discovery.entries.length ? 600_000 : 30_000;
  if (Date.now() - discovery.at < ttl) return discovery.entries;
  const entries = [];
  try {
    const res = await fetch(GATEWAY_LIST, { signal: AbortSignal.timeout(8000) });
    if (res.ok) collect(await res.json(), entries);
  } catch {}
  discovery = { at: Date.now(), entries };
  return entries;
}

// The list format may evolve, so look for any object that carries a gateway_base_url.
function collect(node, out) {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.gateway_base_url === 'string') {
    let base = node.gateway_base_url.trim().replace(/\/+$/, '');
    if (base.startsWith('/')) base = `https://api.sprites.dev${base}`;
    const label = ['provider', 'slug', 'name', 'id', 'type']
      .map((k) => node[k])
      .filter((v) => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    out.push({ base, label });
  }
  for (const v of Object.values(node)) collect(v, out);
}

export async function resolve(provider) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  const override = process.env[p.env];
  if (override) return { mode: 'gateway', base: override.trim().replace(/\/+$/, ''), source: p.env };
  const found = (await discover()).find((e) => e.base.includes(`/gateway/${provider}`) || e.label.includes(provider));
  if (found) return { mode: 'gateway', base: found.base, source: 'gateway list' };
  const key = p.keyEnv && process.env[p.keyEnv];
  if (key && p.direct) return { mode: 'direct', base: p.direct, key, source: p.keyEnv };
  return null;
}

export async function call(provider, path, { method = 'GET', headers = {}, json, timeoutMs = 60_000, raw = false } = {}) {
  const target = await resolve(provider);
  if (!target) throw new ConnectorMissing(provider);
  const h = { 'user-agent': 'uncle-gerds-museum', ...headers };
  if (target.mode === 'direct') h.authorization = `Bearer ${target.key}`;
  let body;
  if (json !== undefined) {
    h['content-type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const res = await fetch(`${target.base}${path}`, { method, headers: h, body, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    throw new ConnectorError(provider, res.status, detail);
  }
  if (raw) return res.text();
  const type = res.headers.get('content-type') || '';
  return type.includes('json') ? res.json() : res.text();
}

export async function status() {
  const out = {};
  for (const name of Object.keys(PROVIDERS)) {
    const r = await resolve(name);
    out[name] = r ? { mode: r.mode, source: r.source } : null;
  }
  return out;
}
