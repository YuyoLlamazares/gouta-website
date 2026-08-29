const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Deliberately tiny: bold and line breaks are all the brief needs.
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

let state = { proposals: [], tasks: [], captures: [], memory: [], counts: {}, hasBrain: true };

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('Unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ---------------- gate ---------------- */
function showLogin() { $('login').hidden = false; $('app').hidden = true; }
function showApp() { $('login').hidden = true; $('app').hidden = false; }

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.hidden = true;
  try {
    await api('/session', { method: 'POST', body: { token: $('token').value } });
    showApp();
    await refresh();
  } catch (error) {
    err.textContent = error.message;
    err.hidden = false;
  }
});

/* ---------------- navigation ---------------- */
const VIEWS = ['brief', 'queue', 'tasks', 'chat', 'you'];
const TITLES = { brief: 'Brief', queue: 'Approvals', tasks: 'Commitments', chat: 'Chat', you: 'You' };

function show(view) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  for (const b of document.querySelectorAll('#tabs button')) {
    b.classList.toggle('active', b.dataset.view === view);
  }
  $('view-title').textContent = TITLES[view];
  if (view === 'chat') loadChat();
  if (view === 'you') loadProfile();
}
for (const b of document.querySelectorAll('#tabs button')) {
  b.addEventListener('click', () => show(b.dataset.view));
}

/* ---------------- state ---------------- */
async function refresh() {
  state = await api('/state');
  renderQueue();
  renderTasks();
  renderMemory();
  renderStats();
  const badge = $('badge');
  const pending = state.counts.pendingProposals || 0;
  badge.hidden = pending === 0;
  badge.textContent = pending;
}
$('refresh').addEventListener('click', () => refresh());

function renderStats() {
  const c = state.counts;
  $('stats').innerHTML = [
    ['Waiting', c.pendingProposals], ['Open', c.openTasks],
    ['Unfiled', c.unprocessed], ['Known', c.memories],
  ].map(([label, n]) => `<div class="stat"><b>${n ?? 0}</b><span>${label}</span></div>`).join('');
}

/* ---------------- capture ---------------- */
async function capture(body, source = 'web') {
  const status = $('capture-status');
  status.hidden = false;
  status.textContent = 'Filing…';
  try {
    const result = await api('/capture', { method: 'POST', body: { body, source } });
    status.textContent = result.filed
      ? `Filed: ${result.summary || 'done'} (${result.counts.tasks} tasks, ${result.counts.proposals} proposals)`
      : `Stored raw — ${result.reason}`;
    await refresh();
  } catch (error) {
    status.textContent = error.message;
  }
  setTimeout(() => { status.hidden = true; }, 6000);
}
$('capture-send').addEventListener('click', () => {
  const input = $('capture-input');
  if (!input.value.trim()) return;
  capture(input.value.trim());
  input.value = '';
});

/* ---------------- brief ---------------- */
$('brief-load').addEventListener('click', async () => {
  const target = $('brief-body');
  target.innerHTML = '<p class="muted">Thinking…</p>';
  try {
    const { text } = await api('/brief');
    target.innerHTML = md(text);
  } catch (error) {
    target.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  }
});

/* ---------------- approvals ---------------- */
function renderQueue() {
  const list = $('queue-list');
  if (!state.proposals.length) {
    list.innerHTML = '<p class="muted">Nothing waiting. Your twin has not proposed anything yet.</p>';
    return;
  }
  list.innerHTML = state.proposals.map((p) => {
    const body = p.payload?.body ? `<pre>${esc(p.payload.body)}</pre>` : '';
    const actions = p.status === 'pending'
      ? `<div class="actions">
           <button data-approve="${p.id}">Approve</button>
           <button class="danger" data-reject="${p.id}">Reject</button>
         </div>`
      : `<p class="why">${esc(p.result || p.status)}</p>`;
    return `<div class="card">
      <span class="tag ${esc(p.status)}">${esc(p.status)} · ${esc(p.kind)}</span>
      <h3>${esc(p.title)}</h3>
      ${p.rationale ? `<p class="why">${esc(p.rationale)}</p>` : ''}
      ${body}${actions}</div>`;
  }).join('');

  for (const b of list.querySelectorAll('[data-approve]')) {
    b.addEventListener('click', () => decide(b.dataset.approve, 'approve'));
  }
  for (const b of list.querySelectorAll('[data-reject]')) {
    b.addEventListener('click', () => decide(b.dataset.reject, 'reject'));
  }
}
async function decide(id, action) {
  await api(`/proposals/${id}/${action}`, { method: 'POST', body: {} });
  await refresh();
}

/* ---------------- commitments ---------------- */
function renderTasks() {
  const list = $('tasks-list');
  if (!state.tasks.length) {
    list.innerHTML = '<p class="muted">Nothing open. Capture something and your twin will pull commitments out of it.</p>';
    return;
  }
  list.innerHTML = state.tasks.map((t) => `
    <div class="row ${t.direction === 'theirs' ? 'theirs' : ''}">
      <div class="body">
        ${esc(t.title)}
        <small>${t.direction === 'mine' ? 'you owe' : `owed to you${t.person ? ` · ${esc(t.person)}` : ''}`}${t.due ? ` · due ${esc(t.due)}` : ''}</small>
      </div>
      <button class="ghost" data-done="${t.id}">Done</button>
    </div>`).join('');
  for (const b of list.querySelectorAll('[data-done]')) {
    b.addEventListener('click', async () => {
      await api(`/tasks/${b.dataset.done}/status`, { method: 'POST', body: { status: 'done' } });
      await refresh();
    });
  }
}

/* ---------------- chat ---------------- */
async function loadChat() {
  const log = $('chat-log');
  const history = await api('/messages');
  log.innerHTML = history.map((m) =>
    `<div class="bubble ${esc(m.role)}">${esc(m.content)}</div>`).join('')
    || '<p class="muted">Ask your twin anything. It answers with your profile, your memory, and your open commitments in view.</p>';
  log.scrollIntoView({ block: 'end' });
}
async function sendChat() {
  const input = $('chat-input');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  const log = $('chat-log');
  log.insertAdjacentHTML('beforeend', `<div class="bubble user">${esc(message)}</div>`);
  log.insertAdjacentHTML('beforeend', '<div class="bubble assistant" id="pending">…</div>');
  try {
    const { reply } = await api('/chat', { method: 'POST', body: { message } });
    $('pending').outerHTML = `<div class="bubble assistant">${esc(reply)}</div>`;
  } catch (error) {
    $('pending').outerHTML = `<div class="bubble assistant">${esc(error.message)}</div>`;
  }
  $('chat-log').lastElementChild.scrollIntoView({ block: 'end' });
}
$('chat-send').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

/* ---------------- profile & memory ---------------- */
async function loadProfile() {
  const profile = await api('/profile');
  $('profile-files').innerHTML = Object.entries(profile).map(([name, content]) => `
    <details>
      <summary>${esc(name.replace('.md', ''))}</summary>
      <textarea class="profile" data-file="${esc(name)}">${esc(content)}</textarea>
      <button class="wide ghost" data-save="${esc(name)}">Save ${esc(name)}</button>
    </details>`).join('');
  for (const b of $('profile-files').querySelectorAll('[data-save]')) {
    b.addEventListener('click', async () => {
      const box = $('profile-files').querySelector(`[data-file="${CSS.escape(b.dataset.save)}"]`);
      await api(`/profile/${encodeURIComponent(b.dataset.save)}`, { method: 'PUT', body: { content: box.value } });
      b.textContent = 'Saved';
      setTimeout(() => { b.textContent = `Save ${b.dataset.save}`; }, 1500);
    });
  }
}
function renderMemory() {
  $('memory-list').innerHTML = state.memory.length
    ? state.memory.map((m) => `
      <div class="row">
        <div class="body">${esc(m.content)}<small>${esc(m.kind)}${m.subject ? ` · ${esc(m.subject)}` : ''}</small></div>
        <button class="danger" data-forget="${m.id}">Forget</button>
      </div>`).join('')
    : '<p class="muted">Nothing learned yet.</p>';
  for (const b of $('memory-list').querySelectorAll('[data-forget]')) {
    b.addEventListener('click', async () => {
      await api(`/memory/${b.dataset.forget}`, { method: 'DELETE' });
      await refresh();
    });
  }
}

/* ---------------- boot ---------------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
try {
  await refresh();
  showApp();
} catch {
  showLogin();
}
