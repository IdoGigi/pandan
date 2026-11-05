import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dbFile } from './paths.js';
import { suggestKey } from './refs.js';
import {
  createRefSchema, backfillProjectRefs, giveKey, suggestKeyFor, takeRef, projectKeyProblem, boardKeyClash,
} from './projectRefs.js';

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

  CREATE TABLE IF NOT EXISTS notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    text       TEXT    NOT NULL DEFAULT '',
    color      TEXT    NOT NULL DEFAULT 'amber',
    x          INTEGER NOT NULL DEFAULT 0,
    y          INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS card_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,
    from_column TEXT,
    to_column   TEXT,
    actor       TEXT,
    actor_kind  TEXT,
    at          TEXT    NOT NULL DEFAULT (datetime('now')),
    estimated   INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_cards_project ON cards(project_id, column_key, position);
  CREATE INDEX IF NOT EXISTS idx_notes_board   ON notes(board_id, id);
  CREATE INDEX IF NOT EXISTS idx_checks_card   ON checks(card_id, position);
  CREATE INDEX IF NOT EXISTS idx_links_project ON project_links(project_id, kind, position);
  CREATE INDEX IF NOT EXISTS idx_updates_project ON project_updates(project_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(hash);
  CREATE INDEX IF NOT EXISTS idx_events_card ON card_events(card_id, at);
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
addColumn('cards', 'last_actor', 'TEXT');
addColumn('cards', 'last_actor_kind', 'TEXT');
addColumn('project_updates', 'actor', 'TEXT');
addColumn('notes', 'title', "TEXT NOT NULL DEFAULT ''");
// Board keys, and the per-board numbers cards had before per-project refs. The
// numbers are kept, so an older version can still run on this database.
addColumn('boards', 'key', 'TEXT');
addColumn('boards', 'last_card_number', 'INTEGER NOT NULL DEFAULT 0');
addColumn('cards', 'number', 'INTEGER');
// A card is known by its project's key and its number there: CRC-3.
createRefSchema(db, addColumn);

/** Runs fn inside one transaction: all of it lands, or none of it. */
export function inTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * One row of move history. `kind` is `created`, `moved`, `archived` or
 * `restored`. Live rows, written by the routes, always name who did it; rows
 * seeded from old dates carry no actor, and the dashboard relies on that to
 * tell real history from seeded. `estimated` marks a guess made from old
 * dates, so the dashboard can say so and never measure time from it.
 */
export function recordEvent({
  cardId, kind, from = null, to = null, actor = null, actorKind = null, at = null, estimated = 0,
}) {
  db.prepare(
    `INSERT INTO card_events (card_id, kind, from_column, to_column, actor, actor_kind, at, estimated)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`
  ).run(cardId, kind, from, to, actor, actorKind, at, estimated);
}

/** Keys a new board key may not be: other boards' keys, and project keys, or "CRC-1" would read two ways. */
function takenKeys() {
  return [
    ...db.prepare('SELECT key FROM boards WHERE key IS NOT NULL').all().map((b) => b.key),
    ...db.prepare('SELECT key FROM ref_keys').all().map((k) => k.key),
  ];
}

/** A new board, keyed from its name unless a key is given. Returns its id. */
export function createBoard(name, key) {
  return inTransaction(() => {
    const info = db.prepare('INSERT INTO boards (name, position) VALUES (?, ?)')
      .run(name, nextPosition('boards', '1 = 1', []));
    const id = Number(info.lastInsertRowid);
    db.prepare('UPDATE boards SET key = ? WHERE id = ?').run(key ?? suggestKey(name, id, takenKeys()), id);
    return id;
  });
}

/** The next ref in a project: its key and the next number under it. */
export const takeCardRef = (projectId) => takeRef(db, projectId);
/** Why a project key cannot be used, as `{ code, reason }`, or null. */
export const projectKeyIssue = (key) => projectKeyProblem(db, key);
/** Why a board key cannot be used because a project has it, or null. */
export const boardKeyIssue = (key) => boardKeyClash(db, key);

/**
 * A new project, with its key for good: the one given (checked already), or
 * one made from its name. Returns its id.
 */
export function createProject({ boardId, name, color, description = '', repoUrl = '', key }) {
  return inTransaction(() => {
    const info = db.prepare(
      `INSERT INTO projects (board_id, name, color, position, description, repo_url) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(boardId, name, color, nextPosition('projects', 'archived = 0 AND board_id = ?', [boardId]), description, repoUrl);
    const id = Number(info.lastInsertRowid);
    giveKey(db, id, key ?? suggestKeyFor(db, name));
    return id;
  });
}

/**
 * There is always at least one board. An older database has projects with no
 * board, so they are adopted by the first one rather than disappearing.
 */
export function ensureBoard() {
  const row = db.prepare('SELECT id FROM boards ORDER BY position, id LIMIT 1').get();
  const id = row ? row.id : createBoard('My board');
  db.prepare('UPDATE projects SET board_id = ? WHERE board_id IS NULL').run(id);
  return id;
}

/**
 * Gives every board a key, made from its name. Only boards with none are
 * touched, so this runs on every start. A board key is for display only; card
 * refs come from project keys (see projectRefs.js).
 */
function keyBoards() {
  const keyed = inTransaction(() => {
    const unkeyed = db.prepare('SELECT id, name FROM boards WHERE key IS NULL ORDER BY position, id').all();
    for (const board of unkeyed) {
      db.prepare('UPDATE boards SET key = ? WHERE id = ?')
        .run(suggestKey(board.name, board.id, takenKeys()), board.id);
    }
    return unkeyed.length;
  });
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_boards_key ON boards(key)');
  if (keyed) console.log(`[db] keyed ${keyed} board(s)`);
}

/** project-keys.json beside the database: keys chosen ahead for projects that have none yet. */
const KEYS_FILE = join(dirname(file), 'project-keys.json');

function giveRefs() {
  const done = backfillProjectRefs(db, inTransaction, KEYS_FILE);
  if (done.projects || done.cards || done.kept) {
    console.log(`[db] keyed ${done.projects} project(s), gave refs to ${done.cards} card(s), kept ${done.kept} old ref(s)`);
  }
}

/**
 * Gives every card some history, so the dashboard's trends reach back before
 * move history existed. Creation and archive dates are exact; for a card in
 * Done, its last change stands in for the day it was finished, marked as an
 * estimate. Only cards with no history are touched, so this runs on every
 * start — and also covers cards an older version made after a rollback.
 */
function seedHistory() {
  const seeded = inTransaction(() => {
    const bare = db.prepare(
      `SELECT id, column_key, created_at, updated_at, archived_at FROM cards c
        WHERE NOT EXISTS (SELECT 1 FROM card_events e WHERE e.card_id = c.id) ORDER BY id`
    ).all();
    for (const card of bare) {
      recordEvent({ cardId: card.id, kind: 'created', at: card.created_at });
      if (card.column_key === 'done') {
        recordEvent({ cardId: card.id, kind: 'moved', to: 'done', at: card.updated_at, estimated: 1 });
      }
      if (card.archived_at) {
        recordEvent({ cardId: card.id, kind: 'archived', from: card.column_key, at: card.archived_at });
      }
    }
    return bare.length;
  });
  if (seeded) console.log(`[db] seeded history for ${seeded} card(s)`);
}

const firstBoardId = ensureBoard();
if (db.prepare('SELECT COUNT(*) AS n FROM boards').get().n === 1) {
  // Nothing to log on a fresh database; only worth a line when we adopted rows.
  const orphans = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE board_id = ?').get(firstBoardId).n;
  if (orphans > 0) console.log(`[db] ${orphans} project(s) on the default board`);
}
keyBoards();
giveRefs();
seedHistory();

export const COLUMNS = ['todo', 'next', 'doing', 'waiting', 'review', 'done'];
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
  const boardId = ensureBoard();
  createProject({ boardId, name: 'House chores', color: '#c3d117' });
  createProject({ boardId, name: 'Volunteering', color: '#4bb3d4' });
}

/** The board to use when a request does not name one. */
export function defaultBoardId() {
  return db.prepare('SELECT id FROM boards ORDER BY position, id LIMIT 1').get()?.id ?? ensureBoard();
}
