/**
 * Upgrading to per-project refs. A board numbered per board (as production is)
 * gives every project a key and every card a ref in its project, oldest first,
 * and keeps each card's board ref as its old name. Keys can be chosen ahead in
 * project-keys.json beside the database; a bad file stops the start and writes
 * nothing. The start-up pass also repairs what an older version writes after a
 * rollback, and the undo script takes the database back.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer, tempDir, removeDir } from './helpers.js';

const undoScript = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'undo-project-refs.mjs');

let dir;

/** Boards, projects and cards as the per-board version left them: board keys, numbers on each board. */
function makePerBoardDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, position REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), key TEXT, last_card_number INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX idx_boards_key ON boards(key);
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
      archived_at TEXT, due_date TEXT, last_actor TEXT, last_actor_kind TEXT, number INTEGER);

    INSERT INTO boards (id, name, position, key, last_card_number) VALUES
      (1, 'My board', 1000, 'MB', 5), (2, 'School', 2000, 'SCH', 2);
    INSERT INTO projects (id, board_id, name, position, archived) VALUES
      (1, 1, 'Chores', 1000, 0), (2, 2, 'Optimization', 1000, 0), (3, 1, 'Old plan', 2000, 1),
      (4, 1, 'Caracal', 3000, 0);
    -- Ids interleave across projects and boards, as they do on a real board.
    INSERT INTO cards (id, project_id, column_key, title, position, archived_at, number) VALUES
      (1, 1, 'todo', 'one',   1000, NULL, 1),
      (2, 2, 'todo', 'two',   1000, NULL, 1),
      (3, 1, 'todo', 'three', 2000, NULL, 2),
      (4, 2, 'done', 'four',  2000, '2026-10-01 10:00:00', 2),
      (5, 3, 'todo', 'five',  1000, NULL, 3),
      (6, 4, 'todo', 'six',   1000, NULL, 4),
      (7, 1, 'todo', 'seven', 3000, NULL, 5);
  `);
  db.close();
}

/** Boards, projects and cards exactly as 1.1.0 left them: no keys and no numbers at all. */
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
    INSERT INTO boards (id, name, position) VALUES (1, 'My board', 1000);
    INSERT INTO projects (id, board_id, name, position) VALUES (1, 1, 'Website', 1000), (2, 1, 'Home', 2000);
    INSERT INTO cards (id, project_id, column_key, title, position) VALUES
      (1, 2, 'todo', 'a', 1000), (2, 1, 'todo', 'b', 1000), (3, 2, 'todo', 'c', 2000);
  `);
  db.close();
}

/** Reads the database directly, with the server stopped. */
function read(file, statement, ...params) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(statement).all(...params).map((r) => ({ ...r })); } finally { db.close(); }
}
const write = (file, statement) => {
  const db = new DatabaseSync(file);
  try { db.exec(statement); } finally { db.close(); }
};

/** id → "REF / OLD" for every card, so a whole board is one comparison. */
const refsOf = (file) => Object.fromEntries(read(file,
  "SELECT id, ref_key || '-' || ref_number AS ref, legacy_ref FROM cards ORDER BY id")
  .map((c) => [c.id, `${c.ref} / ${c.legacy_ref}`]));
const keysOf = (file) => Object.fromEntries(read(file, 'SELECT id, key FROM projects ORDER BY id')
  .map((p) => [p.id, p.key]));
const countersOf = (file) => Object.fromEntries(read(file, 'SELECT key, last_number FROM ref_keys ORDER BY key')
  .map((k) => [k.key, k.last_number]));

/** Fails if a counter is behind the highest number given under its key. */
function assertCountersAhead(file) {
  const behind = read(file,
    `SELECT k.key FROM ref_keys k
      WHERE k.last_number < (SELECT COALESCE(MAX(c.ref_number), 0) FROM cards c WHERE c.ref_key = k.key)`);
  assert.deepEqual(behind, [], 'a counter behind its key would hand out a used number');
  assert.deepEqual(read(file, 'SELECT id FROM cards WHERE ref_key IS NULL OR ref_number IS NULL'), [],
    'every card has a ref');
}

/** A fresh per-board database in its own folder, with an optional keys file beside it. */
function freshCopy(name, keys) {
  const folder = join(dir, name);
  mkdirSync(folder);
  const file = join(folder, 'pandan.db');
  makePerBoardDatabase(file);
  if (keys) writeFileSync(join(folder, 'project-keys.json'), JSON.stringify(keys));
  return file;
}

before(() => { dir = tempDir(); });
after(() => removeDir(dir));

/* ---------------- from per-board numbers ---------------- */

let file;

test('the first start keys every project and numbers each one from 1, oldest card first', async () => {
  file = freshCopy('plain');
  const server = await startServer(file);
  try {
    // An old board ref still finds its card, and so do the new ref and the id.
    const old = await server.call('GET', '/cards/MB-2');
    assert.equal(old.status, 200);
    assert.equal(old.body.title, 'three');
    assert.equal(old.body.ref, 'CHO-2');
    assert.equal(old.body.legacy_ref, 'MB-2');
    assert.equal((await server.call('GET', '/cards/CHO-2')).body.id, 3);
    assert.equal((await server.call('GET', '/cards/%233')).body.legacy_ref, 'MB-2');
    assert.equal((await server.call('GET', '/cards/SCH-2')).body.ref, 'OPT-2', 'an archived card too');
    assert.match(server.log(), /\[db\] keyed 4 project\(s\), gave refs to 7 card\(s\), kept 7 old ref\(s\)/);

    // A new card carries on from its project's count, and has no old ref.
    const made = await server.call('POST', '/cards', { project_id: 1, title: 'new' });
    assert.equal(made.body.ref, 'CHO-4');
    assert.equal(made.body.legacy_ref, null);
  } finally {
    await server.stop();
  }
  assert.deepEqual(keysOf(file), { 1: 'CHO', 2: 'OPT', 3: 'OP', 4: 'CAR' });
  assert.deepEqual(refsOf(file), {
    1: 'CHO-1 / MB-1', 2: 'OPT-1 / SCH-1', 3: 'CHO-2 / MB-2', 4: 'OPT-2 / SCH-2',
    5: 'OP-1 / MB-3', 6: 'CAR-1 / MB-4', 7: 'CHO-3 / MB-5', 8: 'CHO-4 / null',
  });
  assert.deepEqual(countersOf(file), { CAR: 1, CHO: 4, OP: 1, OPT: 2 });
  assertCountersAhead(file);
});

test('starting again changes nothing', async () => {
  const before = refsOf(file);
  const server = await startServer(file);
  const log = server.log();
  await server.stop();
  assert.deepEqual(refsOf(file), before);
  assert.deepEqual(countersOf(file), { CAR: 1, CHO: 4, OP: 1, OPT: 2 });
  assert.doesNotMatch(log, /\[db\] keyed/);
});

test('a start after a rollback gives refs to what the older version made', async () => {
  // The per-board version, run again on this database, numbers its new cards
  // on the board and leaves the new columns alone.
  write(file, `
    INSERT INTO cards (id, project_id, column_key, title, position, number) VALUES (9, 4, 'todo', 'rollback card', 2000, 6);
    INSERT INTO cards (id, project_id, column_key, title, position) VALUES (10, 2, 'todo', 'no number at all', 3000);
  `);
  const server = await startServer(file);
  try {
    assert.equal((await server.call('GET', '/cards/MB-6')).body.ref, 'CAR-2');
    assert.equal((await server.call('GET', '/cards/10')).body.ref, 'OPT-3');
  } finally {
    await server.stop();
  }
  assert.equal(refsOf(file)[9], 'CAR-2 / MB-6');
  assert.equal(refsOf(file)[10], 'OPT-3 / null');
  assertCountersAhead(file);
});

/* ---------------- keys chosen ahead ---------------- */

test('keys chosen in project-keys.json are used, and the rest are made from names', async () => {
  const chosen = freshCopy('chosen', { 4: 'crc', 1: 'CHR', 999: 'GONE' });
  const server = await startServer(chosen);
  const log = server.log();
  await server.stop();
  assert.deepEqual(keysOf(chosen), { 1: 'CHR', 2: 'OPT', 3: 'OP', 4: 'CRC' });
  assert.equal(refsOf(chosen)[6], 'CRC-1 / MB-4');
  assert.deepEqual(read(chosen, "SELECT key FROM ref_keys WHERE key = 'GONE'"), [], 'an unknown project is skipped');
  assert.match(log, /project-keys\.json: no project 999, skipped/, 'and the skip is logged');
});

test('a bad project-keys.json stops the start and writes no key or ref', async () => {
  const cases = [
    [{ 4: 'CAR1' }, /project 4: "CAR1" is not 2 to 5 capital letters/],
    [{ 4: 'MB' }, /project 4: "MB" is the key of the board "My board"/],
    [{ 1: 'ABC', 4: 'abc' }, /project 4: "ABC" is already the key of project 1/],
    ['not json', /project-keys\.json is not a JSON object/],
    [{ abc: 'ABC' }, /"abc" is not a project id/],
    [{ '01': 'ABC' }, /"01" is not a project id/],
  ];
  for (const [i, [keys, reason]] of cases.entries()) {
    const bad = freshCopy(`bad-${i}`);
    writeFileSync(join(dirname(bad), 'project-keys.json'), typeof keys === 'string' ? keys : JSON.stringify(keys));
    await assert.rejects(startServer(bad), (err) => {
      assert.match(err.message, /PND-REF-005/);
      assert.match(err.message, reason);
      return true;
    });
    assert.deepEqual(read(bad, 'SELECT id FROM projects WHERE key IS NOT NULL'), [], 'no key was saved');
    assert.deepEqual(read(bad, 'SELECT id FROM cards WHERE ref_key IS NOT NULL OR legacy_ref IS NOT NULL'), [],
      'no ref was saved');
  }
});

/* ---------------- undo ---------------- */

test('the undo script takes the database back to per-board numbers, keeping every card', () => {
  const copy = join(dir, 'undo.db');
  copyFileSync(file, copy);
  const before = read(copy, 'SELECT id, number, title FROM cards ORDER BY id');

  const out = execFileSync(process.execPath, [undoScript, copy], { encoding: 'utf8' });
  assert.match(out, /removed per-project refs/);

  assert.deepEqual(read(copy, 'SELECT id, number, title FROM cards ORDER BY id'), before, 'cards and board numbers kept');
  const columns = (table) => read(copy, `PRAGMA table_info(${table})`).map((c) => c.name);
  for (const gone of ['ref_key', 'ref_number', 'legacy_ref']) assert.ok(!columns('cards').includes(gone), gone);
  assert.ok(!columns('projects').includes('key'));
  const leftovers = read(copy, `SELECT name FROM sqlite_master
    WHERE name IN ('ref_keys', 'idx_cards_ref', 'idx_cards_legacy_ref', 'idx_projects_key') OR type = 'trigger'`);
  assert.deepEqual(leftovers, []);
  assert.equal(read(copy, 'PRAGMA integrity_check')[0].integrity_check, 'ok');
  rmSync(copy);
});

/* ---------------- from 1.1.0 ---------------- */

test('an old ref that would read as a real ref is left out, not shadowed', async () => {
  // After a rollback the older version numbers its cards on the board. A board key
  // equal to a project key (the older version never checks) would make "OPT-3"
  // name two cards; the ref wins and the old name is not kept.
  write(file, `
    UPDATE boards SET key = 'OPT' WHERE id = 2;
    INSERT INTO cards (id, project_id, column_key, title, position, number) VALUES (20, 2, 'todo', 'clash', 5000, 3);
  `);
  const server = await startServer(file);
  const log = server.log();
  await server.stop();
  assert.equal(refsOf(file)[20], 'OPT-4 / null');
  assert.match(log, /old ref OPT-3 of card 20 starts with a project key, so it is not kept/);
});

test('a 1.1.0 board, never numbered, gets refs and no old ones', async () => {
  const old = join(dir, 'old.db');
  makeOldDatabase(old);
  const server = await startServer(old);
  await server.stop();
  assert.deepEqual(refsOf(old), { 1: 'HOM-1 / null', 2: 'WEB-1 / null', 3: 'HOM-2 / null' });
  assertCountersAhead(old);
});
