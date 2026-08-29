import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workdir = mkdtempSync(join(tmpdir(), 'twin-test-'));
const TOKEN = 'test-token-abc123';

// config.js reads the environment at import time, so set it up first.
process.env.TWIN_TOKEN = TOKEN;
process.env.TWIN_DB = join(workdir, 'test.db');
process.env.TWIN_PROFILE_DIR = workdir;
process.env.ANTHROPIC_API_KEY = '';           // exercise the no-brain path
writeFileSync(join(workdir, 'identity.md'), '# Who I am\n- Name: Tester\n');

const { server } = await import('../server/index.js');

let base;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(workdir, { recursive: true, force: true });
});

const call = (path, options = {}) => fetch(`${base}${path}`, {
  ...options,
  headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  body: options.body ? JSON.stringify(options.body) : undefined,
});
const auth = (path, options = {}) =>
  call(path, { ...options, headers: { authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) } });

test('health is public', async () => {
  const res = await call('/health');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).brain, false);
});

test('the API is closed without a token', async () => {
  assert.equal((await call('/api/state')).status, 401);
});

test('a wrong token is rejected', async () => {
  const res = await call('/api/session', { method: 'POST', body: { token: 'nope' } });
  assert.equal(res.status, 401);
});

test('the right token opens a session cookie', async () => {
  const res = await call('/api/session', { method: 'POST', body: { token: TOKEN } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /twin=.*HttpOnly/);
});

test('a bearer token works, so Shortcuts can post directly', async () => {
  assert.equal((await auth('/api/state')).status, 200);
});

test('a capture is stored even when the twin cannot think', async () => {
  const res = await auth('/api/capture', {
    method: 'POST',
    body: { body: 'Ana owes me the brief by Friday', source: 'shortcut' },
  });
  assert.equal(res.status, 202);           // stored, not filed
  const body = await res.json();
  assert.ok(body.id);
  assert.equal(body.filed, false);

  const state = await (await auth('/api/state')).json();
  assert.equal(state.captures.length, 1);
  assert.equal(state.counts.unprocessed, 1);
});

test('an empty capture is refused', async () => {
  assert.equal((await auth('/api/capture', { method: 'POST', body: { body: '   ' } })).status, 400);
});

test('commitments can be added and closed', async () => {
  await auth('/api/tasks', { method: 'POST', body: { title: 'Send the timeline', direction: 'mine' } });
  let open = await (await auth('/api/tasks')).json();
  assert.equal(open.length, 1);

  const res = await auth(`/api/tasks/${open[0].id}/status`, { method: 'POST', body: { status: 'done' } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).length, 0);
});

test('an invalid task status is refused', async () => {
  await auth('/api/tasks', { method: 'POST', body: { title: 'x' } });
  const open = await (await auth('/api/tasks')).json();
  const res = await auth(`/api/tasks/${open[0].id}/status`, { method: 'POST', body: { status: 'whatever' } });
  assert.equal(res.status, 400);
});

test('approving a proposed commitment turns it into a real one', async () => {
  const { proposals } = await import('../server/db.js');
  const { lastInsertRowid } = proposals.add({
    kind: 'task', title: 'Reply to Ana', rationale: 'She is waiting',
    payload: { direction: 'mine', person: 'Ana' },
  });

  const res = await auth(`/api/proposals/${Number(lastInsertRowid)}/approve`, { method: 'POST', body: {} });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'executed');

  const open = await (await auth('/api/tasks')).json();
  assert.ok(open.some((t) => t.title === 'Reply to Ana'));
});

test('a draft with no delivery channel is approved but not sent', async () => {
  const { proposals } = await import('../server/db.js');
  const { lastInsertRowid } = proposals.add({
    kind: 'email_reply', title: 'Reply to intro request', payload: { body: 'Hi — thanks for reaching out.' },
  });
  const res = await auth(`/api/proposals/${Number(lastInsertRowid)}/approve`, { method: 'POST', body: {} });
  const body = await res.json();
  assert.equal(body.status, 'approved');
  assert.match(body.result, /no delivery channel/i);
});

test('rejecting records the decision', async () => {
  const { proposals } = await import('../server/db.js');
  const { lastInsertRowid } = proposals.add({ kind: 'draft', title: 'Some draft', payload: {} });
  const res = await auth(`/api/proposals/${Number(lastInsertRowid)}/reject`, {
    method: 'POST', body: { reason: 'not now' },
  });
  const body = await res.json();
  assert.equal(body.status, 'rejected');
  assert.equal(body.result, 'not now');
});

test('a decided proposal is not re-decided', async () => {
  const { proposals } = await import('../server/db.js');
  const { lastInsertRowid } = proposals.add({ kind: 'draft', title: 'Once only', payload: {} });
  const id = Number(lastInsertRowid);
  await auth(`/api/proposals/${id}/reject`, { method: 'POST', body: { reason: 'first' } });
  const res = await auth(`/api/proposals/${id}/approve`, { method: 'POST', body: {} });
  assert.equal((await res.json()).status, 'rejected');
});

test('the profile can be read and edited from the phone', async () => {
  const profile = await (await auth('/api/profile')).json();
  assert.match(profile['identity.md'], /Tester/);

  const res = await auth('/api/profile/identity.md', {
    method: 'PUT', body: { content: '# Who I am\n- Name: Edited\n' },
  });
  assert.equal(res.status, 200);
  const after = await (await auth('/api/profile')).json();
  assert.match(after['identity.md'], /Edited/);
});

test('profile paths cannot escape the profile directory', async () => {
  const res = await auth('/api/profile/..%2F..%2Fetc%2Fpasswd', {
    method: 'PUT', body: { content: 'pwned' },
  });
  assert.equal(res.status, 400);
});

test('thinking endpoints fail honestly with no API key', async () => {
  const res = await auth('/api/brief');
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /ANTHROPIC_API_KEY/);
});

test('the app shell is served', async () => {
  const res = await call('/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>Twin<\/title>/);
});

test('static traversal is blocked', async () => {
  const res = await call('/../server/config.js');
  const text = await res.text();
  assert.doesNotMatch(text, /ANTHROPIC_API_KEY/);
});
