import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, normalize } from 'node:path';
import { config, hasBrain } from './config.js';
import { sendJson } from './http.js';
import { handleApi } from './routes/api.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = resolve(join(config.publicDir, rel === '/' ? 'index.html' : rel));
  if (!file.startsWith(config.publicDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    // Unknown paths fall through to the app shell so the PWA can route them.
    try {
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      res.end(await readFile(join(config.publicDir, 'index.html')));
    } catch {
      res.writeHead(404).end('Not found');
    }
  }
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/health') return sendJson(res, 200, { ok: true, brain: hasBrain() });
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    const status = error.status || 500;
    // Errors that carry a status are expected conditions (no API key, bad input);
    // only genuine surprises are worth a stack trace in the log.
    if (!error.status) console.error(`[twin] ${req.method} ${url.pathname}`, error);
    if (!res.headersSent) sendJson(res, status, { error: error.message || 'Internal error' });
  }
});

export function start() {
  if (!config.token) {
    console.error(
      '\n  Refusing to start without TWIN_TOKEN.\n' +
      '  This server holds your notes, drafts, and commitments — it does not run open.\n\n' +
      '    cp .env.example .env\n' +
      '    node -e "console.log(crypto.randomUUID().replace(/-/g,\'\'))"   # paste as TWIN_TOKEN\n');
    process.exit(1);
  }
  server.listen(config.port, () => {
    console.log(`  twin listening on http://localhost:${config.port}`);
    console.log(`  brain: ${hasBrain() ? config.model : 'offline (no ANTHROPIC_API_KEY — capture still works)'}`);
  });
}

// Only auto-start when run directly, so tests can import the server.
if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) start();
