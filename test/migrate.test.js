/**
 * Upgrading a board made before per-board numbers: every card gets a number on
 * its own board, oldest first, and the start-up pass repairs whatever an older
 * version writes after a rollback.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { startServer, tempDir, removeDir } from './helpers.js';

let dir;
let file;

/** The three tables that hold data, exactly as 1.1.0 left them. The server adds the rest. */
function makeOldDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, position REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#94a3b8',
      position REAL NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT NOT NULL DEFAULT '', repo_url TEXT NOT NULL DEFAULT '',
      board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE);
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      column_key TEXT NOT NULL, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT 'plain', flagged INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT, due_date TEXT, last_actor TEXT, last_actor_kind TEXT);

    INSERT INTO boards (id, name, position) VALUES (1, 'My board', 1000), (2, 'School', 2000);
    INSERT INTO projects (id, board_id, name, position, archived) VALUES
      (1, 1, 'Chores', 1000, 0), (2, 2, 'Optimization', 1000, 0), (3, 1, 'Old plan', 2000, 1);
    -- Ids interleave across the boards, as they do on a real board.
    INSERT INTO cards (id, project_id, column_key, title, position, archived_at) VALUES
      (1, 1, 'todo', 'one',   1000, NULL),
      (2, 2, 'todo', 'two',   1000, NULL),
      (3, 1, 'todo', 'three', 2000, NULL),
      (4, 2, 'done', 'four',  2000, '2026-10-01 10:00:00'),
      (5, 3, 'todo', 'five',  1000, NULL),
      (6, 2, 'todo', 'six',   3000, NULL),
      (7, 1, 'todo', 'seven', 3000, NULL);
  `);
  db.close();
}

/** Reads the database directly, with the server stopped. */
function read(sql, ...params) {
  const db = new DatabaseSync(file);
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}

const numbers = () => Object.fromEntries(
  read('SELECT id, number FROM cards ORDER BY id').map((c) => [c.id, c.number]));
const counters = () => Object.fromEntries(
  read('SELECT key, last_card_number FROM boards').map((b) => [b.key, b.last_card_number]));

/** Fails if two cards on one board share a number, or a board's counter is behind. */
function assertConsistent() {
  const dupes = read(
    `SELECT p.board_id, c.number, COUNT(*) AS n FROM cards c JOIN projects p ON p.id = c.project_id
      GROUP BY p.board_id, c.number HAVING n > 1`);
  assert.deepEqual(dupes, [], 'no two cards on a board may share a number');
  const behind = read(
    `SELECT b.key FROM boards b
      WHERE b.last_card_number < (SELECT COALESCE(MAX(c.number), 0) FROM cards c
                                    JOIN projects p ON p.id = c.project_id WHERE p.board_id = b.id)`);
  assert.deepEqual(behind, [], 'a counter behind its board would hand out a used number');
}

before(() => {
  dir = tempDir();
  file = join(dir, 'pandan.db');
  makeOldDatabase(file);
});

after(() => removeDir(dir));

test('the first start keys every board and numbers each one from 1, oldest card first', async () => {
  const server = await startServer(file);
  try {
    const boards = (await server.call('GET', '/boards')).body;
    assert.deepEqual(boards.map((b) => b.key), ['MB', 'SCH']);

    // Archived cards and cards on an archived project are numbered too, so
    // restoring one can never collide with a newer card.
    const mb2 = await server.call('GET', '/cards/MB-2');
    assert.equal(mb2.status, 200);
    assert.equal(mb2.body.title, 'three');
    assert.equal((await server.call('GET', '/cards/SCH-2')).body.title, 'four');
    assert.equal((await server.call('GET', '/cards/MB-3')).body.title, 'five');
    assert.match(server.log(), /\[db\] keyed 2 board\(s\), numbered 7 card\(s\)/);
  } finally {
    await server.stop();
  }
  assert.deepEqual(numbers(), { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3, 7: 4 });
  assert.deepEqual(counters(), { MB: 4, SCH: 3 });
  assertConsistent();
});

test('starting again changes nothing', async () => {
  const before = numbers();
  const server = await startServer(file);
  const log = server.log();
  await server.stop();
  assert.deepEqual(numbers(), before);
  assert.deepEqual(counters(), { MB: 4, SCH: 3 });
  assert.doesNotMatch(log, /\[db\] keyed/);
});

test('a start after a rollback repairs what the older version wrote', async () => {
  // What 1.1.0 does if it runs again on this database: new cards get no
  // number, and a card moved to another board keeps its old one.
  const db = new DatabaseSync(file);
  db.exec(`
    INSERT INTO cards (id, project_id, column_key, title, position) VALUES (8, 2, 'todo', 'made by 1.1.0', 4000);
    UPDATE cards SET project_id = 2 WHERE id = 7;   -- MB-4 lands on School, still number 4
    UPDATE cards SET project_id = 1 WHERE id = 6;   -- SCH-3 lands on My board, clashing with card 5 (MB-3)
    INSERT INTO boards (id, name, position) VALUES (3, 'Demo', 3000);
  `);
  db.close();

  const server = await startServer(file);
  try {
    assert.equal((await server.call('GET', '/cards/SCH-4')).body.title, 'seven');
    assert.equal((await server.call('GET', '/cards/SCH-5')).body.title, 'made by 1.1.0');
    assert.equal((await server.call('GET', '/cards/MB-3')).body.title, 'five');   // the older card keeps it
    assert.equal((await server.call('GET', '/cards/MB-5')).body.title, 'six');
    const demo = (await server.call('GET', '/boards')).body.find((b) => b.name === 'Demo');
    assert.equal(demo.key, 'DEM');
  } finally {
    await server.stop();
  }
  assertConsistent();
});
