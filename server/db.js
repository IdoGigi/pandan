import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const file = process.env.DB_PATH || './data/kanban.db';
mkdirSync(dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
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

  CREATE INDEX IF NOT EXISTS idx_cards_project ON cards(project_id, column_key, position);
  CREATE INDEX IF NOT EXISTS idx_checks_card   ON checks(card_id, position);
`);

export const COLUMNS = ['todo', 'next', 'doing', 'done'];

/** Position for a new item at the end of a list. Gaps of 1000 leave room to insert between. */
export function nextPosition(table, whereSql, params) {
  const row = db.prepare(`SELECT MAX(position) AS m FROM ${table} WHERE ${whereSql}`).get(...params);
  return (row?.m ?? 0) + 1000;
}

export function seedIfEmpty() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM projects').get();
  if (n > 0) return;
  const ins = db.prepare('INSERT INTO projects (name, color, position) VALUES (?, ?, ?)');
  ins.run('House chores', '#c3d117', 1000);
  ins.run('Volunteering', '#4bb3d4', 2000);
}
