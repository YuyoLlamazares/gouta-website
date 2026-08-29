import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, hasBrain } from '../config.js';
import { sendJson, readJson, isAuthorized, constantTimeEqual } from '../http.js';
import { captures, memory, tasks, proposals, messages, counts } from '../db.js';
import { think, textOf } from '../claude.js';
import { systemPrompt, contextBlock, readProfile } from '../twin/prompts.js';
import { triage } from '../twin/extract.js';
import { draft } from '../twin/voice.js';
import { morningBrief } from '../twin/brief.js';
import { approve, reject } from '../twin/execute.js';

const PROFILE_FILE = /^[a-z0-9_-]+\.md$/i;

export async function handleApi(req, res, url) {
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const method = req.method;

  // ---- Login: exchange the shared secret for a session cookie -------------
  if (path === '/session' && method === 'POST') {
    const { token } = await readJson(req);
    if (!config.token || !token || !constantTimeEqual(token, config.token)) {
      return sendJson(res, 401, { error: 'Wrong token.' });
    }
    res.setHeader('set-cookie',
      `twin=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
    return sendJson(res, 200, { ok: true });
  }

  if (!isAuthorized(req)) return sendJson(res, 401, { error: 'Unauthorized' });

  // ---- One call that paints the whole phone screen ------------------------
  if (path === '/state' && method === 'GET') {
    return sendJson(res, 200, {
      counts: counts(),
      hasBrain: hasBrain(),
      proposals: proposals.recent(40).map(withPayload),
      tasks: tasks.open(),
      captures: captures.recent(25),
      memory: memory.search('', 30),
    });
  }

  // ---- Capture: the endpoint iOS Shortcuts hit ---------------------------
  if (path === '/capture' && method === 'POST') {
    const { body, kind = 'note', source = 'web', meta = {} } = await readJson(req);
    if (!body || !String(body).trim()) return sendJson(res, 400, { error: 'body is required' });

    const { lastInsertRowid } = captures.add({ body: String(body).trim(), kind, source, meta });
    const capture = captures.get(Number(lastInsertRowid));

    if (!hasBrain()) {
      return sendJson(res, 202, { id: capture.id, filed: false, reason: 'No API key — stored raw.' });
    }
    try {
      const result = await triage(capture);
      return sendJson(res, 200, { id: capture.id, filed: true, ...result });
    } catch (error) {
      // A capture must never be lost because thinking failed.
      return sendJson(res, 202, { id: capture.id, filed: false, reason: error.message });
    }
  }

  // ---- Approval queue ----------------------------------------------------
  if (path === '/proposals' && method === 'GET') {
    return sendJson(res, 200, proposals.recent(60).map(withPayload));
  }
  const decision = path.match(/^\/proposals\/(\d+)\/(approve|reject)$/);
  if (decision && method === 'POST') {
    const id = Number(decision[1]);
    const body = await readJson(req).catch(() => ({}));
    const updated = decision[2] === 'approve' ? await approve(id) : reject(id, body.reason);
    if (!updated) return sendJson(res, 404, { error: 'No such proposal' });
    return sendJson(res, 200, withPayload(updated));
  }

  // ---- Commitments -------------------------------------------------------
  if (path === '/tasks' && method === 'GET') return sendJson(res, 200, tasks.open());
  if (path === '/tasks' && method === 'POST') {
    const body = await readJson(req);
    if (!body.title) return sendJson(res, 400, { error: 'title is required' });
    tasks.add(body);
    return sendJson(res, 201, tasks.open());
  }
  const taskStatus = path.match(/^\/tasks\/(\d+)\/status$/);
  if (taskStatus && method === 'POST') {
    const { status } = await readJson(req);
    if (!['open', 'done', 'dropped'].includes(status)) {
      return sendJson(res, 400, { error: 'status must be open, done, or dropped' });
    }
    tasks.setStatus(Number(taskStatus[1]), status);
    return sendJson(res, 200, tasks.open());
  }

  // ---- Memory ------------------------------------------------------------
  if (path === '/memory' && method === 'GET') {
    return sendJson(res, 200, memory.search(url.searchParams.get('q') || ''));
  }
  const memoryId = path.match(/^\/memory\/(\d+)$/);
  if (memoryId && method === 'DELETE') {
    memory.remove(Number(memoryId[1]));
    return sendJson(res, 200, { ok: true });
  }

  // ---- Thinking endpoints ------------------------------------------------
  if (path === '/draft' && method === 'POST') {
    const { what, recipient, context, kind } = await readJson(req);
    if (!what) return sendJson(res, 400, { error: 'what is required' });
    return sendJson(res, 200, await draft({ what, recipient, context, kind }));
  }

  if (path === '/brief' && method === 'GET') {
    return sendJson(res, 200, await morningBrief());
  }

  if (path === '/chat' && method === 'POST') {
    const { message } = await readJson(req);
    if (!message) return sendJson(res, 400, { error: 'message is required' });
    messages.add('user', message);
    const history = messages.recent(20);
    const response = await think({
      system: systemPrompt('conversation'),
      effort: 'medium',
      maxTokens: 4000,
      messages: [
        { role: 'user', content: contextBlock({ query: message.slice(0, 60) }) },
        { role: 'assistant', content: 'Understood — that is my current picture of your world.' },
        ...history.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    const reply = textOf(response);
    messages.add('assistant', reply);
    return sendJson(res, 200, { reply });
  }

  if (path === '/messages' && method === 'GET') return sendJson(res, 200, messages.recent(50));

  // ---- Profile: the twin's sense of self, editable from the phone ---------
  if (path === '/profile' && method === 'GET') return sendJson(res, 200, readProfile());
  const profileFile = path.match(/^\/profile\/([^/]+)$/);
  if (profileFile && (method === 'PUT' || method === 'GET')) {
    const name = decodeURIComponent(profileFile[1]);
    if (!PROFILE_FILE.test(name)) return sendJson(res, 400, { error: 'Bad profile filename' });
    const file = join(config.profileDir, name);
    if (method === 'GET') {
      if (!existsSync(file)) return sendJson(res, 404, { error: 'Not found' });
      return sendJson(res, 200, { name, content: readFileSync(file, 'utf8') });
    }
    const { content } = await readJson(req);
    if (typeof content !== 'string') return sendJson(res, 400, { error: 'content must be a string' });
    writeFileSync(file, content, 'utf8');
    return sendJson(res, 200, { name, saved: true });
  }

  return sendJson(res, 404, { error: `No API route for ${method} ${path}` });
}

function withPayload(proposal) {
  return { ...proposal, payload: safeParse(proposal.payload) };
}
function safeParse(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}
