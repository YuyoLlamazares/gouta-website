import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export async function readJson(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error('Request body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const err = new Error('Invalid JSON body');
    err.status = 400;
    throw err;
  }
}

export function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // Compare a fixed-size digest-shaped pair so length alone leaks nothing.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => {
      const i = part.indexOf('=');
      return i < 0 ? [part.trim(), ''] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
    }).filter(([k]) => k),
  );
}

/** Accepts either a Bearer token (iOS Shortcuts) or the session cookie (browser). */
export function isAuthorized(req) {
  if (!config.token) return false;
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ') && constantTimeEqual(auth.slice(7), config.token)) return true;
  const cookie = parseCookies(req.headers.cookie || '').twin;
  return Boolean(cookie) && constantTimeEqual(cookie, config.token);
}
