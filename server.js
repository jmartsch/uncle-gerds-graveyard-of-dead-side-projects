import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, config } from './lib/config.js';
import { loadExhibits, exhibitsWithRevivals } from './lib/exhibits.js';
import { startScan, scanState, GUEST_NAME, loadGuest, guestState, startGuestScan, GuestLimitError, listGuests } from './lib/curator.js';
import { startRevival, getRevival } from './lib/revive.js';
import { status as connectorStatus } from './lib/connectors.js';
import { localize, LANGS } from './lib/translate.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function sendJSON(res, status, data) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

// Curator actions (scan, revive) need the admin key. Local demo mode without a key is open.
function isAdmin(req, url) {
  if (!config.adminKey) return config.fixtures;
  const given = Buffer.from(String(req.headers['x-admin-key'] || url.searchParams.get('key') || ''));
  const expected = Buffer.from(config.adminKey);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const deny = (res) => sendJSON(res, 403, { error: 'Only the curator may do that. Open the museum with ?key=… first.' });

async function routeApi(req, res, url) {
  const { pathname: p } = url;
  const m = req.method;
  const lang = LANGS.includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'en';

  if (m === 'GET' && p === '/api/exhibits') return sendJSON(res, 200, await localize(await exhibitsWithRevivals(), lang, 'own'));

  if (m === 'GET' && p === '/api/status') {
    return sendJSON(res, 200, {
      fixtures: config.fixtures,
      inSprite: config.inSprite,
      canRevive: Boolean(config.spritesToken),
      connectors: await connectorStatus(),
      scan: scanState(),
    });
  }

  if (p === '/api/scan') {
    if (m === 'GET') return sendJSON(res, 200, scanState());
    if (m === 'POST') {
      if (!isAdmin(req, url)) return deny(res);
      return sendJSON(res, startScan() ? 202 : 409, scanState());
    }
  }

  if (m === 'GET' && p === '/api/guests') return sendJSON(res, 200, await listGuests());

  // Guest museums: anyone can have their public GitHub graveyard dug up. Read-only, no revivals.
  const guest = p.match(/^\/api\/guests\/([^/]+?)(\/scan)?$/);
  if (guest) {
    const name = decodeURIComponent(guest[1]);
    if (!GUEST_NAME.test(name)) return sendJSON(res, 400, { error: 'That is not a valid GitHub username.' });
    const key = name.toLowerCase();
    if (!guest[2] && m === 'GET') {
      const data = await loadGuest(key);
      if (data) {
        const guestData = { ...data, demo: false, guest: true, exhibits: data.exhibits.map((e) => ({ ...e, revival: { status: 'idle', log: [] } })) };
        return sendJSON(res, 200, await localize(guestData, lang, `guest-${key}`));
      }
      const st = guestState(key);
      return st ? sendJSON(res, 202, st) : sendJSON(res, 404, { error: 'Not excavated yet.', notScanned: true });
    }
    if (guest[2] && m === 'POST') {
      if (await loadGuest(key)) return sendJSON(res, 200, { status: 'done' });
      try {
        return sendJSON(res, 202, startGuestScan(key));
      } catch (err) {
        if (err instanceof GuestLimitError) {
          res.setHeader('retry-after', String(err.retryAfter));
          return sendJSON(res, 429, { error: err.message, retryAfter: err.retryAfter });
        }
        throw err;
      }
    }
  }

  const match = p.match(/^\/api\/exhibits\/([a-z0-9-]{1,60})\/(revive|revival)$/);
  if (match) {
    const [, id, action] = match;
    const data = await loadExhibits();
    const exhibit = data.exhibits.find((e) => e.id === id);
    if (!exhibit) return sendJSON(res, 404, { error: 'No such exhibit.' });
    if (action === 'revival' && m === 'GET') return sendJSON(res, 200, await getRevival(id));
    if (action === 'revive' && m === 'POST') {
      // Demo revivals are simulated and harmless, so every visitor may try one.
      if (!data.demo && !isAdmin(req, url)) return deny(res);
      return sendJSON(res, 202, await startRevival(exhibit, { simulate: data.demo }));
    }
  }

  return sendJSON(res, 404, { error: 'Not found.' });
}

async function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return sendJSON(res, 400, { error: 'Bad path.' });
  }
  if (rel.endsWith('/')) rel += 'index.html';
  if (/^\/u\/[^/]+\/?(index\.html)?$/.test(rel)) rel = '/index.html'; // guest museums use the same page
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return sendJSON(res, 403, { error: 'Forbidden.' });
  let body;
  try {
    body = await fs.readFile(file);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('This room does not exist.');
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://museum.local');
  try {
    if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJSON(res, 405, { error: 'Method not allowed.' });
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJSON(res, 500, { error: err.message });
    else res.end();
  }
});

server.listen(config.port, () => {
  const mode = config.fixtures ? 'demo exhibits' : config.inSprite ? 'on a Sprite' : 'locally';
  console.log(`Uncle Gerd's Museum is open on http://localhost:${config.port} (${mode})`);
});
