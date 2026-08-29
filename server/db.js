import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  -- Raw input from anywhere: a dictated note, a shared link, an email, a photo caption.
  CREATE TABLE IF NOT EXISTS captures (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL DEFAULT 'note',
    body       TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'web',
    meta       TEXT NOT NULL DEFAULT '{}',
    summary    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );

  -- What the twin has learned about you and your world. Feeds every prompt.
  CREATE TABLE IF NOT EXISTS memory (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL DEFAULT 'fact',
    content    TEXT NOT NULL,
    subject    TEXT,
    capture_id INTEGER REFERENCES captures(id) ON DELETE SET NULL,
    pinned     INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Commitments in both directions: what you owe, what you are owed.
  CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY,
    title      TEXT NOT NULL,
    detail     TEXT,
    direction  TEXT NOT NULL DEFAULT 'mine',   -- 'mine' | 'theirs'
    person     TEXT,
    due        TEXT,
    status     TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'done' | 'dropped'
    capture_id INTEGER REFERENCES captures(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at  TEXT
  );

  -- The approval queue. Nothing leaves this system without passing through here.
  CREATE TABLE IF NOT EXISTS proposals (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL,                  -- 'email_reply' | 'draft' | 'task' | 'memory'
    title      TEXT NOT NULL,
    rationale  TEXT,
    payload    TEXT NOT NULL DEFAULT '{}',
    status     TEXT NOT NULL DEFAULT 'pending',-- pending|approved|rejected|executed|failed
    result     TEXT,
    capture_id INTEGER REFERENCES captures(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  );

  -- Conversation with the twin.
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status, direction);
  CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  CREATE INDEX IF NOT EXISTS idx_captures_created ON captures(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_memory_kind     ON memory(kind, created_at DESC);
`);

const q = (sql) => db.prepare(sql);

export const captures = {
  add: (c) => q(`INSERT INTO captures (kind, body, source, meta) VALUES (?, ?, ?, ?)`)
    .run(c.kind || 'note', c.body, c.source || 'web', JSON.stringify(c.meta || {})),
  markProcessed: (id, summary) =>
    q(`UPDATE captures SET processed_at = datetime('now'), summary = ? WHERE id = ?`).run(summary, id),
  recent: (limit = 50) => q(`SELECT * FROM captures ORDER BY id DESC LIMIT ?`).all(limit),
  get: (id) => q(`SELECT * FROM captures WHERE id = ?`).get(id),
};

export const memory = {
  add: (m) => q(`INSERT INTO memory (kind, content, subject, capture_id, pinned) VALUES (?, ?, ?, ?, ?)`)
    .run(m.kind || 'fact', m.content, m.subject ?? null, m.capture_id ?? null, m.pinned ? 1 : 0),
  search: (term, limit = 40) => term
    ? q(`SELECT * FROM memory WHERE content LIKE ? OR subject LIKE ?
         ORDER BY pinned DESC, id DESC LIMIT ?`).all(`%${term}%`, `%${term}%`, limit)
    : q(`SELECT * FROM memory ORDER BY pinned DESC, id DESC LIMIT ?`).all(limit),
  remove: (id) => q(`DELETE FROM memory WHERE id = ?`).run(id),
};

export const tasks = {
  add: (t) => q(`INSERT INTO tasks (title, detail, direction, person, due, capture_id)
                 VALUES (?, ?, ?, ?, ?, ?)`)
    .run(t.title, t.detail ?? null, t.direction || 'mine', t.person ?? null, t.due ?? null, t.capture_id ?? null),
  open: () => q(`SELECT * FROM tasks WHERE status = 'open'
                 ORDER BY (due IS NULL), due ASC, id DESC`).all(),
  all: (limit = 200) => q(`SELECT * FROM tasks ORDER BY id DESC LIMIT ?`).all(limit),
  setStatus: (id, status) =>
    q(`UPDATE tasks SET status = ?, closed_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now') END
       WHERE id = ?`).run(status, status, id),
};

export const proposals = {
  add: (p) => q(`INSERT INTO proposals (kind, title, rationale, payload, capture_id)
                 VALUES (?, ?, ?, ?, ?)`)
    .run(p.kind, p.title, p.rationale ?? null, JSON.stringify(p.payload || {}), p.capture_id ?? null),
  pending: () => q(`SELECT * FROM proposals WHERE status = 'pending' ORDER BY id DESC`).all(),
  recent: (limit = 60) => q(`SELECT * FROM proposals ORDER BY id DESC LIMIT ?`).all(limit),
  get: (id) => q(`SELECT * FROM proposals WHERE id = ?`).get(id),
  decide: (id, status, result = null) =>
    q(`UPDATE proposals SET status = ?, result = ?, decided_at = datetime('now') WHERE id = ?`)
      .run(status, result, id),
};

export const messages = {
  add: (role, content) => q(`INSERT INTO messages (role, content) VALUES (?, ?)`).run(role, content),
  recent: (limit = 30) =>
    q(`SELECT * FROM messages ORDER BY id DESC LIMIT ?`).all(limit).reverse(),
};

export const counts = () => ({
  pendingProposals: q(`SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending'`).get().n,
  openTasks: q(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'`).get().n,
  unprocessed: q(`SELECT COUNT(*) AS n FROM captures WHERE processed_at IS NULL`).get().n,
  memories: q(`SELECT COUNT(*) AS n FROM memory`).get().n,
});
