import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader so self-hosting needs no dependency.
function loadEnvFile() {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    let [, key, value = ''] = match;
    value = value.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

export const config = {
  port: Number(process.env.PORT || 8787),
  token: process.env.TWIN_TOKEN || '',
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.TWIN_MODEL || 'claude-opus-5',
  dbPath: resolve(ROOT, process.env.TWIN_DB || './data/twin.db'),
  profileDir: resolve(ROOT, process.env.TWIN_PROFILE_DIR || './profile'),
  publicDir: resolve(ROOT, 'public'),
};

export const hasBrain = () => Boolean(config.apiKey);
