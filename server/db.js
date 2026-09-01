import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { dbFile } from './paths.js';

const file = dbFile();
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS boards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    position   REAL    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT '#94a3b8',
    position   REAL    NOT NULL,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cards (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    column_key  TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    notes       TEXT    NOT NULL DEFAULT '',
    color       TEXT    NOT NULL DEFAULT 'plain',
    flagged     INTEGER NOT NULL DEFAULT 0,
    position    REAL    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id  INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    text     TEXT    NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    position REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS labels (
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    color    TEXT    NOT NULL,
    name     TEXT    NOT NULL,
    PRIMARY KEY (board_id, color)
  );

  CREATE TABLE IF NOT EXISTS project_links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL DEFAULT 'link',
    label      TEXT    NOT NULL,
    value      TEXT    NOT NULL,
    position   REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_updates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    text       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    hash         TEXT    NOT NULL UNIQUE,
    prefix       TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_cards_project ON cards(project_id, column_key, position);
  CREATE INDEX IF NOT EXISTS idx_checks_card   ON checks(card_id, position);
  CREATE INDEX IF NOT EXISTS idx_links_project ON project_links(project_id, kind, position);
  CREATE INDEX IF NOT EXISTS idx_updates_project ON project_updates(project_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(hash);
`);

/**
 * Adds a column only if it is missing, so an existing board upgrades in place
 * instead of being rebuilt. SQLite has no "ADD COLUMN IF NOT EXISTS".
 */
function addColumn(table, name, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  if (existing.some((c) => c.name === name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  console.log(`[db] added ${table}.${name}`);
}

addColumn('projects', 'description', "TEXT NOT NULL DEFAULT ''");
addColumn('projects', 'repo_url', "TEXT NOT NULL DEFAULT ''");
addColumn('projects', 'board_id', 'INTEGER REFERENCES boards(id) ON DELETE CASCADE');
addColumn('cards', 'archived_at', 'TEXT');
addColumn('cards', 'due_date', 'TEXT');

/**
 * There is always at least one board. An older database has projects with no
 * board, so they are adopted by the first one rather than disappearing.
 */
export function ensureBoard() {
  let row = db.prepare('SELECT id FROM boards ORDER BY position, id LIMIT 1').get();
  if (!row) {
    const info = db.prepare('INSERT INTO boards (name, position) VALUES (?, ?)').run('My board', 1000);
    row = { id: Number(info.lastInsertRowid) };
  }
  db.prepare('UPDATE projects SET board_id = ? WHERE board_id IS NULL').run(row.id);
  return row.id;
}

const firstBoardId = ensureBoard();
if (db.prepare('SELECT COUNT(*) AS n FROM boards').get().n === 1) {
  // Nothing to log on a fresh database; only worth a line when we adopted rows.
  const orphans = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE board_id = ?').get(firstBoardId).n;
  if (orphans > 0) console.log(`[db] ${orphans} project(s) on the default board`);
}

export const COLUMNS = ['todo', 'next', 'doing', 'review', 'done'];
export const CARD_COLORS = ['plain', 'lime', 'sky', 'amber', 'rose', 'violet'];

/** A date the UI and an agent can both agree on: YYYY-MM-DD, or nothing. */
export function cleanDate(value) {
  if (value === null || value === '') return null;
  const text = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;   // undefined = reject
  return Number.isNaN(Date.parse(text)) ? undefined : text;
}
export const LINK_KINDS = ['link', 'contact'];

/**
 * Only these schemes become clickable links. Anything else is kept as plain
 * text so a stored "javascript:" value can never run.
 */
export function safeUrl(value) {
  try {
    const url = new URL(String(value).trim());
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Position for a new item at the end of a list. Gaps of 1000 leave room to insert between. */
export function nextPosition(table, whereSql, params) {
  const row = db.prepare(`SELECT MAX(position) AS m FROM ${table} WHERE ${whereSql}`).get(...params);
  return (row?.m ?? 0) + 1000;
}

export function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM projects').get();
  if (n > 0) return;
  const board = ensureBoard();
  const ins = db.prepare('INSERT INTO projects (board_id, name, color, position) VALUES (?, ?, ?, ?)');
  ins.run(board, 'House chores', '#c3d117', 1000);
  ins.run(board, 'Volunteering', '#4bb3d4', 2000);
}

/** The board to use when a request does not name one. */
export function defaultBoardId() {
  return db.prepare('SELECT id FROM boards ORDER BY position, id LIMIT 1').get()?.id ?? ensureBoard();
}
