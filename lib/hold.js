// Keeps the Sprite awake while long work runs (Tasks API on the management socket).
// Outside a Sprite this is a no-op. https://docs.fly.io/sprites/keeping-sprites-running
import fs from 'node:fs';
import http from 'node:http';

const SOCKET = '/.sprite/api.sock';

function request(method, path, body) {
  return new Promise((resolve) => {
    if (!fs.existsSync(SOCKET)) return resolve(null);
    const req = http.request(
      { socketPath: SOCKET, path, method, headers: { host: 'sprite', 'content-type': 'application/json' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', () => resolve(null));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Heartbeat pattern: a 5-minute hold, refreshed every minute, released when done.
export function hold(name) {
  request('POST', '/v1/tasks', { name, expire: '5m' }).then((code) => {
    if (code === 409) request('PUT', `/v1/tasks/${encodeURIComponent(name)}`, { expire: '5m' });
  });
  const timer = setInterval(() => request('PUT', `/v1/tasks/${encodeURIComponent(name)}`, { expire: '5m' }), 60_000);
  timer.unref();
  return () => {
    clearInterval(timer);
    request('DELETE', `/v1/tasks/${encodeURIComponent(name)}`);
  };
}
