import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export async function readJSON(name, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(path.join(config.dataDir, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Atomic write: never leave a half-written file behind if the Sprite pauses mid-write.
export async function writeJSON(name, data) {
  const file = path.join(config.dataDir, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}
