# Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A Dashboard view per board — what is stuck, how much gets done, what agents do — where every number opens the cards behind it.

**Architecture:** A new `card_events` table records every create, column move, archive and restore, seeded once from existing dates. A pure module `server/insights.js` turns cards + events into lists of card ids, served by `GET /api/insights`. The UI is three new files (Dashboard, hand-drawn SVG charts, a drill-down card list) and a third tab in the view switch.

**Tech Stack:** Node 24 `node:sqlite`, Express 5, `node:test`; React 18 + Vite, no chart library; jsdom smoke test (`web/smoke.mjs`).

Design: `docs/plans/2026-11-04-dashboard-design.md`. Branch: `feat/dashboard`.

**Conventions to keep:** two-space indent, single quotes, short JSDoc above each function saying *why*; SQL via `db.prepare(...)` with `?` params; times are SQLite UTC text `YYYY-MM-DD HH:MM:SS`; commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Run server tests with `npm test`, one file with `node --test test/<file>.test.js`, the UI check with `cd web && node smoke.mjs`.

---

### Task 1: Test helpers — call with an agent key, reach the raw server

**Files:**
- Modify: `test/helpers.js`

**Step 1:** In `startServer`, give `call` an optional token and return `base`:

```js
  /** A REST call, as the owner unless an agent key is given. Resolves to { status, body }. */
  async function call(method, path, body, token = PASSWORD) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
```

and `return { base, call, rpc, tool, stop, log: () => log };`

**Step 2:** Add a writer for tests that need to set dates:

```js
/** Runs one statement on the test database while the server is idle — for back-dating rows. */
export function sql(dbPath, statement, ...params) {
  const db = new DatabaseSync(dbPath);
  try { return db.prepare(statement).run(...params); } finally { db.close(); }
}

/** Reads rows from the test database. */
export function rows(dbPath, statement, ...params) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare(statement).all(...params); } finally { db.close(); }
}

const DAY = 86400000;
/** A SQLite UTC time `days` ago (fractions allowed). */
export const ago = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 19).replace('T', ' ');
```

(import `DatabaseSync` from `node:sqlite` at the top.)

**Step 3:** `npm test` → 38/38 still pass. Commit: `test: helpers for agent calls and back-dated rows`.

---

### Task 2: The `card_events` table and `recordEvent`

**Files:**
- Modify: `server/db.js` (schema block, after `notes`; new export after `inTransaction`)
- Test: `test/events.test.js` (new)

**Step 1: failing test** — `test/events.test.js`:

```js
/**
 * Move history: one row per create, column move, archive and restore, so the
 * dashboard can say how long work takes and who moved it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { startServer, tempDir, removeDir, rows } from './helpers.js';

let dir;
let dbPath;
let server;
let projectId;

const history = (cardId) => rows(dbPath,
  'SELECT kind, from_column, to_column, actor, actor_kind, estimated FROM card_events WHERE card_id = ? ORDER BY id',
  cardId);

before(async () => {
  dir = tempDir();
  dbPath = join(dir, 'pandan.db');
  server = await startServer(dbPath);
  projectId = (await server.call('GET', '/projects')).body[0].id;
});

after(async () => {
  await server?.stop();
  removeDir(dir);
});

test('creating a card records where it started', async () => {
  const card = (await server.call('POST', '/cards', { project_id: projectId, title: 'a', column_key: 'next' })).body;
  assert.deepEqual(history(card.id), [
    { kind: 'created', from_column: null, to_column: 'next', actor: 'you', actor_kind: 'owner', estimated: 0 },
  ]);
});
```

**Step 2:** `node --test test/events.test.js` → FAIL (`no such table: card_events`).

**Step 3: implement** — in the schema block of `server/db.js`, after the `notes` table:

```sql
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
```

and with the indexes: `CREATE INDEX IF NOT EXISTS idx_events_card ON card_events(card_id, at);`

After `inTransaction`:

```js
/**
 * One row of move history. `estimated` marks a guess made from old dates, so
 * the dashboard can say so and never measure time from it.
 */
export function recordEvent({ cardId, kind, from = null, to = null, actor = null, actorKind = null, at = null, estimated = 0 }) {
  db.prepare(
    `INSERT INTO card_events (card_id, kind, from_column, to_column, actor, actor_kind, at, estimated)
     VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`
  ).run(cardId, kind, from, to, actor, actorKind, at, estimated);
}
```

In `server/routes.js`: import `recordEvent` from `./db.js`, and below `stamp`:

```js
/** Writes the move history for a card, as whoever made the request. */
function logEvent(req, cardId, kind, from = null, to = null) {
  const [actor, actorKind] = actorOf(req);
  recordEvent({ cardId, kind, from, to, actor, actorKind });
}
```

`POST /cards` — insert and record in one transaction:

```js
  const cardId = inTransaction(() => {
    const { lastInsertRowid } = db.prepare(/* the existing INSERT */).run(/* the existing values */);
    logEvent(req, lastInsertRowid, 'created', null, column);
    return lastInsertRowid;
  });
  stamp(req, cardId);
  res.status(201).json(cardById(cardId));
```

**Step 4:** test passes. **Step 5:** commit `feat: card_events move history table, recorded on create`.

---

### Task 3: Record moves, archive and restore

**Files:** Modify `server/routes.js` (PATCH `/cards/:id`, POST `/cards/:id/move`, DELETE `/cards/:id`, POST `/cards/:id/restore`); Test `test/events.test.js`.

**Step 1: failing tests** — append:

```js
test('a column change is recorded; a reorder or a text edit is not', async () => {
  const card = (await server.call('POST', '/cards', { project_id: projectId, title: 'b' })).body;
  await server.call('POST', `/cards/${card.ref}/move`, { column_key: 'doing' });
  await server.call('POST', `/cards/${card.ref}/move`, { column_key: 'doing', index: 0 });
  await server.call('PATCH', `/cards/${card.ref}`, { title: 'b2' });
  await server.call('PATCH', `/cards/${card.ref}`, { column_key: 'waiting' });
  assert.deepEqual(history(card.id).map((e) => [e.kind, e.from_column, e.to_column]), [
    ['created', null, 'todo'], ['moved', 'todo', 'doing'], ['moved', 'doing', 'waiting'],
  ]);
});

test('archive and restore are recorded', async () => {
  const card = (await server.call('POST', '/cards', { project_id: projectId, title: 'c', column_key: 'done' })).body;
  await server.call('DELETE', `/cards/${card.ref}`);
  await server.call('POST', `/cards/${card.ref}/restore`);
  assert.deepEqual(history(card.id).map((e) => [e.kind, e.from_column, e.to_column]), [
    ['created', null, 'done'], ['archived', 'done', null], ['restored', null, 'done'],
  ]);
});

test("an agent key's moves are marked as the agent's", async () => {
  const token = (await server.call('POST', '/tokens', { name: 'builder' })).body.token;
  const card = (await server.call('POST', '/cards', { project_id: projectId, title: 'd' }, token)).body;
  await server.call('POST', `/cards/${card.ref}/move`, { column_key: 'review' }, token);
  assert.deepEqual(history(card.id).map((e) => [e.actor, e.actor_kind]), [['builder', 'agent'], ['builder', 'agent']]);
});

test('deleting a card for good removes its history', async () => {
  const card = (await server.call('POST', '/cards', { project_id: projectId, title: 'e' })).body;
  await server.call('DELETE', `/cards/${card.ref}/permanent`);
  assert.deepEqual(history(card.id), []);
});
```

**Step 2:** run → the first three fail.

**Step 3: implement**
- PATCH: inside its `inTransaction(() => { ... })`, after the UPDATE: `if (column !== card.column_key) logEvent(req, card.id, 'moved', card.column_key, column);`
- move: the same line inside its transaction.
- DELETE (archive): after the `changes` check, `logEvent(req, card.id, 'archived', card.column_key, null);`
- restore: after the `changes` check, `logEvent(req, card.id, 'restored', null, card.column_key);`

**Step 4:** `npm test` → all pass. **Step 5:** commit `feat: record column moves, archive and restore in the move history`.

---

### Task 4: Seed history for cards that have none

**Files:** Modify `server/db.js` (new `seedHistory()`, called after `backfillRefs();`); Test `test/events.test.js`.

**Step 1: failing test** — a separate server on its own database, so back-dating is safe:

```js
test('cards from before move history are seeded once', async () => {
  const seedDir = tempDir();
  const path = join(seedDir, 'pandan.db');
  try {
    let s = await startServer(path);
    const pid = (await s.call('GET', '/projects')).body[0].id;
    const todo = (await s.call('POST', '/cards', { project_id: pid, title: 'old todo' })).body;
    const done = (await s.call('POST', '/cards', { project_id: pid, title: 'old done', column_key: 'done' })).body;
    const gone = (await s.call('POST', '/cards', { project_id: pid, title: 'old archived' })).body;
    await s.call('DELETE', `/cards/${gone.ref}`);
    await s.stop();

    // Make it look like a database from before card_events existed.
    sql(path, 'DELETE FROM card_events');
    sql(path, "UPDATE cards SET created_at = '2026-08-01 09:00:00', updated_at = '2026-08-20 18:00:00'");
    sql(path, "UPDATE cards SET archived_at = '2026-08-25 12:00:00' WHERE id = ?", gone.id);

    s = await startServer(path);
    await s.stop();
    assert.match(s.log(), /\[db\] seeded history for 3 card\(s\)/);
    const seeded = (id) => rows(path,
      'SELECT kind, from_column, to_column, at, estimated FROM card_events WHERE card_id = ? ORDER BY id', id);
    assert.deepEqual(seeded(todo.id), [
      { kind: 'created', from_column: null, to_column: null, at: '2026-08-01 09:00:00', estimated: 0 }]);
    assert.deepEqual(seeded(done.id).map((e) => [e.kind, e.to_column, e.at, e.estimated]), [
      ['created', null, '2026-08-01 09:00:00', 0], ['moved', 'done', '2026-08-20 18:00:00', 1]]);
    assert.deepEqual(seeded(gone.id).map((e) => [e.kind, e.from_column, e.at]), [
      ['created', null, '2026-08-01 09:00:00'], ['archived', 'todo', '2026-08-25 12:00:00']]);

    s = await startServer(path);
    await s.stop();
    assert.doesNotMatch(s.log(), /seeded history/);
    assert.equal(rows(path, 'SELECT COUNT(*) AS n FROM card_events')[0].n, 5);
  } finally {
    removeDir(seedDir);
  }
});
```

(import `sql` from `./helpers.js` too.)

**Step 2:** run → FAIL (no log line, no rows).

**Step 3: implement** in `server/db.js` after `backfillRefs`:

```js
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
```

and call `seedHistory();` on the line after `backfillRefs();`.

**Step 4:** `npm test` → all pass. **Step 5:** commit `feat: seed move history from existing card dates`.

---

### Task 5: `server/insights.js` — stuck now and open work by project

**Files:** Create `server/insights.js`; Modify `server/routes.js` (route); Modify `package.json` (`check` script gains `node --check server/insights.js`); Test `test/insights.test.js` (new).

**Step 1: failing tests** — `test/insights.test.js`:

```js
/**
 * The dashboard's numbers. Every number is a list of card ids, so these tests
 * check exactly which cards land where, on back-dated rows.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { startServer, tempDir, removeDir, sql, ago } from './helpers.js';

let dir;
let dbPath;
let server;
let boardId;
const projects = {};

const today = () => new Date().toISOString().slice(0, 10);
const daysAgoDate = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const insights = async (tz = 0) => (await server.call('GET', `/insights?board_id=${boardId}&tz=${tz}`)).body;
async function card(project, title, extra = {}) {
  const res = await server.call('POST', '/cards', { project_id: projects[project], title, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

before(async () => {
  dir = tempDir();
  dbPath = join(dir, 'pandan.db');
  server = await startServer(dbPath);
  boardId = (await server.call('POST', '/boards', { name: 'Insights', key: 'INS' })).body.id;
  for (const name of ['hiring', 'website', 'shelved']) {
    projects[name] = (await server.call('POST', '/projects', { name, board_id: boardId })).body.id;
  }
  await server.call('PATCH', `/projects/${projects.shelved}`, { archived: true });
});

after(async () => {
  await server?.stop();
  removeDir(dir);
});

test('stuck now: waiting, flagged, overdue and gone quiet', async () => {
  const waiting = await card('hiring', 'reference check', { column_key: 'waiting' });
  const flagged = await card('hiring', 'offer', { column_key: 'doing', flagged: true });
  const overdue = await card('website', 'copy', { due_date: daysAgoDate(1) });
  const dueToday = await card('website', 'logo', { due_date: today() });
  const quiet = await card('website', 'old', { column_key: 'review' });
  const fresh = await card('website', 'recent', { column_key: 'doing' });
  const finished = await card('website', 'shipped', { column_key: 'done', flagged: true, due_date: daysAgoDate(3) });
  const gone = await card('hiring', 'archived waiter', { column_key: 'waiting' });
  await server.call('DELETE', `/cards/${gone.ref}`);
  sql(dbPath, 'UPDATE cards SET updated_at = ? WHERE id = ?', ago(8), quiet.id);
  sql(dbPath, 'UPDATE cards SET updated_at = ? WHERE id = ?', ago(6), fresh.id);

  const { stuck, quiet_days } = await insights();
  assert.equal(quiet_days, 7);
  assert.deepEqual(stuck.waiting, [waiting.id]);
  assert.deepEqual(stuck.flagged, [flagged.id]);
  assert.deepEqual(stuck.overdue, [overdue.id], 'due today is not overdue; Done never is');
  assert.deepEqual(stuck.quiet, [quiet.id], '8 days quiet counts, 6 does not');
  assert.ok(![dueToday.id, finished.id].some((id) => Object.values(stuck).flat().includes(id)));
});

test('open work by project, split by column, without Done or shelved projects', async () => {
  const { projects: list } = await insights();
  assert.deepEqual(list.map((p) => p.name), ['hiring', 'website']);
  const hiring = list.find((p) => p.name === 'hiring');
  assert.deepEqual(Object.keys(hiring.by_column), ['todo', 'next', 'doing', 'waiting', 'review']);
  assert.equal(hiring.by_column.waiting.length, 1, 'the archived card is not open work');
  assert.equal(hiring.by_column.doing.length, 1);
});

test('the cards map covers every card on the board, archived ones marked', async () => {
  const data = await insights();
  const all = Object.values(data.cards);
  assert.ok(all.every((c) => /^INS-\d+$/.test(c.ref)));
  assert.equal(all.filter((c) => c.archived).length, 1);
});

test('another board stays out, a login is needed, and bad input is refused', async () => {
  const other = (await server.call('GET', '/projects')).body.find((p) => p.board_id !== boardId);
  const stranger = (await server.call('POST', '/cards', { project_id: other.id, title: 'elsewhere' })).body;
  assert.equal((await insights()).cards[stranger.id], undefined);
  assert.equal((await fetch(`${server.base}/api/insights?board_id=${boardId}`)).status, 401);
  assert.equal((await server.call('GET', `/insights?board_id=${boardId}&tz=abc`)).status, 400);
  assert.equal((await server.call('GET', '/insights?board_id=99999')).status, 404);
});
```

**Step 2:** run → FAIL (404 on `/insights`).

**Step 3: implement** `server/insights.js` (first half — weeks, time and agents return empty shapes until Tasks 6–8):

```js
/**
 * The dashboard's numbers for one board. Pure reads: cards and their move
 * history in, lists of card ids out — a person clicks a number and sees
 * exactly the cards behind it.
 */
import { db, COLUMNS } from './db.js';

export const QUIET_DAYS = 7;
export const WEEKS = 12;
const OPEN = COLUMNS.filter((c) => c !== 'done');
const IN_FLIGHT = ['doing', 'waiting', 'review'];
const DAY = 86400000;

/** SQLite's UTC text as epoch ms. */
const ms = (text) => Date.parse(`${text.replace(' ', 'T')}Z`);
/** The local calendar date for a browser offset (getTimezoneOffset minutes). */
const localDate = (t, tz) => new Date(t - tz * 60000).toISOString().slice(0, 10);
const ids = (list) => list.map((c) => c.id);

export function buildInsights(boardId, { tz = 0, now = Date.now() } = {}) {
  const board = db.prepare('SELECT id, name, key FROM boards WHERE id = ?').get(boardId);
  if (!board) return null;

  const cards = db.prepare(
    `SELECT c.id, b.key || '-' || c.number AS ref, c.title, c.project_id, c.column_key, c.flagged,
            c.due_date, c.updated_at, c.archived_at, c.last_actor_kind
       FROM cards c JOIN projects p ON p.id = c.project_id JOIN boards b ON b.id = p.board_id
      WHERE p.board_id = ? AND p.archived = 0
      ORDER BY c.id`
  ).all(boardId);
  const live = cards.filter((c) => !c.archived_at);
  const open = live.filter((c) => c.column_key !== 'done');
  const today = localDate(now, tz);

  const projects = db.prepare(
    'SELECT id, name, color FROM projects WHERE board_id = ? AND archived = 0 ORDER BY position'
  ).all(boardId).map((p) => ({
    ...p,
    by_column: Object.fromEntries(OPEN.map((col) =>
      [col, ids(open.filter((c) => c.project_id === p.id && c.column_key === col))])),
  }));

  return {
    board,
    quiet_days: QUIET_DAYS,
    history_since: null,
    stuck: {
      waiting: ids(open.filter((c) => c.column_key === 'waiting')),
      flagged: ids(open.filter((c) => c.flagged)),
      overdue: ids(open.filter((c) => c.due_date && c.due_date < today)),
      quiet: ids(open.filter((c) => IN_FLIGHT.includes(c.column_key) && ms(c.updated_at) <= now - QUIET_DAYS * DAY)),
    },
    projects,
    weeks: [],
    time_in_column: {},
    agents: { review_from_agents: [], this_week: [], weeks: [] },
    cards: Object.fromEntries(cards.map((c) => [c.id, {
      id: c.id, ref: c.ref, title: c.title, project_id: c.project_id, column_key: c.column_key,
      flagged: c.flagged, due_date: c.due_date, updated_at: c.updated_at,
      archived: Boolean(c.archived_at), last_actor_kind: c.last_actor_kind,
    }])),
  };
}
```

Route in `server/routes.js` (import `buildInsights` from `./insights.js`), near `GET /board`:

```js
/** The dashboard's numbers for one board. `tz` is the browser's getTimezoneOffset(). */
api.get('/insights', (req, res) => {
  const boardId = req.query.board_id === undefined ? defaultBoardId() : Number(req.query.board_id);
  const tz = req.query.tz === undefined ? 0 : Number(req.query.tz);
  if (!Number.isInteger(tz) || Math.abs(tz) > 14 * 60) {
    return bad(res, 'tz must be whole minutes, as from getTimezoneOffset()');
  }
  const data = buildInsights(boardId, { tz });
  if (!data) return res.status(404).json({ error: 'board not found' });
  res.json(data);
});
```

**Step 4:** `npm test` → all pass; `npm run check` ok. **Step 5:** commit `feat: GET /api/insights with stuck cards and open work by project`.

---

### Task 6: Weeks — added and finished, in local weeks

**Files:** Modify `server/insights.js`; Test `test/insights.test.js`.

**Step 1: failing tests** — append:

```js
/** The Sunday that starts this UTC week, as YYYY-MM-DD. */
function thisSunday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

test('weeks: 12 Sundays; added on creation; finished on the last move into Done', async () => {
  const shipped = await card('website', 'launch');
  await server.call('POST', `/cards/${shipped.ref}/move`, { column_key: 'done' });
  const reopened = await card('website', 'reopened');
  await server.call('POST', `/cards/${reopened.ref}/move`, { column_key: 'done' });
  await server.call('POST', `/cards/${reopened.ref}/move`, { column_key: 'doing' });

  const { weeks } = await insights();
  assert.equal(weeks.length, 12);
  assert.equal(weeks[11].start, thisSunday().toISOString().slice(0, 10));
  assert.ok(weeks[11].added.includes(shipped.id));
  assert.ok(weeks[11].finished.includes(shipped.id));
  assert.ok(!weeks.some((w) => w.finished.includes(reopened.id)), 'moved back out of Done no longer counts');
});

test('a seeded finish lands in its week, marked as an estimate', async () => {
  const old = await card('website', 'from before');
  await server.call('POST', `/cards/${old.ref}/move`, { column_key: 'done' });
  const threeWeeksAgo = new Date(thisSunday().getTime() - 20 * 86400000);
  sql(dbPath, `UPDATE card_events SET at = ?, estimated = 1
                WHERE card_id = ? AND to_column = 'done'`,
      threeWeeksAgo.toISOString().slice(0, 19).replace('T', ' '), old.id);
  const { weeks } = await insights();
  assert.ok(weeks[8].finished.includes(old.id));
  assert.equal(weeks[8].estimated, true);
  assert.equal(weeks[11].estimated, false);
});

test('weeks follow the browser time zone', async () => {
  const late = await card('website', 'saturday night');
  await server.call('POST', `/cards/${late.ref}/move`, { column_key: 'done' });
  // 22:30 UTC on the Saturday before this week: still last week in UTC,
  // already Sunday 00:30 — this week — at UTC+2 (getTimezoneOffset() = -120).
  const saturdayNight = new Date(thisSunday().getTime() - 90 * 60000);
  sql(dbPath, `UPDATE card_events SET at = ? WHERE card_id = ? AND to_column = 'done'`,
      saturdayNight.toISOString().slice(0, 19).replace('T', ' '), late.id);
  assert.ok((await insights(0)).weeks[10].finished.includes(late.id));
  assert.ok((await insights(-120)).weeks[11].finished.includes(late.id));
});
```

**Step 2:** run → FAIL (`weeks.length` is 0).

**Step 3: implement** — add to `server/insights.js`:

```js
/** The Sunday that starts the local week holding t, as YYYY-MM-DD. */
function weekStart(t, tz) {
  const local = new Date(t - tz * 60000);
  local.setUTCDate(local.getUTCDate() - local.getUTCDay());
  return local.toISOString().slice(0, 10);
}
const shiftWeeks = (start, n) => new Date(Date.parse(`${start}T00:00:00Z`) + n * 7 * DAY).toISOString().slice(0, 10);

/** The last event that put a card into `col`, by a move or by being made there. */
const lastInto = (events, col) => [...events].reverse()
  .find((e) => e.to_column === col && (e.kind === 'moved' || e.kind === 'created'));
```

Inside `buildInsights`, after `cards`:

```js
  const history = db.prepare(
    `SELECT e.id, e.card_id, e.kind, e.from_column, e.to_column, e.actor_kind, e.at, e.estimated
       FROM card_events e JOIN cards c ON c.id = e.card_id JOIN projects p ON p.id = c.project_id
      WHERE p.board_id = ? AND p.archived = 0
      ORDER BY e.card_id, e.at, e.id`
  ).all(boardId);
  const byCard = new Map();
  for (const e of history) byCard.set(e.card_id, [...(byCard.get(e.card_id) ?? []), e]);

  const thisWeek = weekStart(now, tz);
  const starts = Array.from({ length: WEEKS }, (_, i) => shiftWeeks(thisWeek, i - (WEEKS - 1)));
  const slot = new Map(starts.map((s, i) => [s, i]));
  const weekOf = (at) => slot.get(weekStart(ms(at), tz));
  const weeks = starts.map((start) => ({ start, added: [], finished: [], estimated: false }));

  for (const e of history) {
    const w = e.kind === 'created' ? weekOf(e.at) : undefined;
    if (w !== undefined) weeks[w].added.push(e.card_id);
  }
  for (const c of cards.filter((x) => x.column_key === 'done')) {
    const finish = lastInto(byCard.get(c.id) ?? [], 'done');
    const w = finish && weekOf(finish.at);
    if (w === undefined) continue;
    weeks[w].finished.push(c.id);
    if (finish.estimated) weeks[w].estimated = true;
  }
```

and return `weeks` instead of `[]`. (`ORDER BY e.card_id, e.at, e.id` keeps each card's events in time order; `lastInto` relies on it.)

**Step 4:** `npm test` → pass. **Step 5:** commit `feat: insights weeks — added and finished, in the browser's weeks`.

---

### Task 7: Median days in each column, from real moves only

**Files:** Modify `server/insights.js`; Test `test/insights.test.js`.

**Step 1: failing test:**

```js
test('median days per column use real moves only, and list the slowest cards', async () => {
  const slow = await card('hiring', 'slow');
  const quick = await card('hiring', 'quick');
  const guessed = await card('hiring', 'guessed');
  for (const c of [slow, quick, guessed]) sql(dbPath, 'DELETE FROM card_events WHERE card_id = ?', c.id);
  const add = (id, kind, from, to, at, estimated = 0) => sql(dbPath,
    `INSERT INTO card_events (card_id, kind, from_column, to_column, actor_kind, at, estimated)
     VALUES (?, ?, ?, ?, 'owner', ?, ?)`, id, kind, from, to, at, estimated);
  add(slow.id, 'moved', 'todo', 'doing', ago(10));
  add(slow.id, 'moved', 'doing', 'review', ago(6));    // 4 days in doing
  add(quick.id, 'moved', 'todo', 'doing', ago(5));
  add(quick.id, 'moved', 'doing', 'review', ago(3));   // 2 days in doing
  add(guessed.id, 'moved', 'todo', 'doing', ago(30), 1);
  add(guessed.id, 'moved', 'doing', 'review', ago(1)); // starts from a guess: not measured
  // A seeded creation row: exact date, but no actor — it is not when collecting began.
  sql(dbPath, `INSERT INTO card_events (card_id, kind, at) VALUES (?, 'created', ?)`, guessed.id, ago(60));

  const { time_in_column: t, history_since } = await insights();
  assert.equal(t.doing.median_days, 3);
  assert.equal(t.doing.moves, 2);
  assert.deepEqual(t.doing.longest.slice(0, 2), [slow.id, quick.id]);
  assert.deepEqual(Object.keys(t), ['todo', 'next', 'doing', 'waiting', 'review']);
  assert.equal(t.next.median_days, null);
  assert.match(history_since, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(history_since > daysAgoDate(60), 'seeded rows (no actor) do not count as collecting');
});
```

**Step 2:** run → FAIL.

**Step 3: implement** — in `server/insights.js`:

```js
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * How long cards sat in each open column: from a real move (or creation) into
 * it to the next real move out, for moves out inside the window. A seeded
 * guess never starts or ends a stay, so estimates never become durations.
 */
function timeInColumn(byCard, since) {
  const stays = Object.fromEntries(OPEN.map((col) => [col, []]));
  for (const [cardId, events] of byCard) {
    let col = null;
    let entered = null;
    for (const e of events) {
      if (e.estimated) { col = null; entered = null; continue; }
      if (e.kind === 'moved' && col && e.from_column === col && ms(e.at) >= since && stays[col]) {
        stays[col].push({ cardId, days: (ms(e.at) - entered) / DAY });
      }
      if (e.kind === 'moved' || (e.kind === 'created' && e.to_column)) {
        col = e.to_column;
        entered = ms(e.at);
      }
    }
  }
  return Object.fromEntries(OPEN.map((col) => {
    const list = stays[col].sort((a, b) => b.days - a.days);
    return [col, {
      median_days: list.length ? Math.round(median(list.map((s) => s.days)) * 10) / 10 : null,
      moves: list.length,
      longest: [...new Set(list.map((s) => s.cardId))].slice(0, 10),
    }];
  }));
}
```

In `buildInsights`: `time_in_column: timeInColumn(byCard, Date.parse(\`${starts[0]}T00:00:00Z\`) + tz * 60000),` and

```js
  // Live rows always carry an actor; seeded ones never do (see recordEvent).
  const firstReal = history.filter((e) => !e.estimated && e.actor_kind).map((e) => e.at).sort()[0];
  // …
    history_since: firstReal ? localDate(ms(firstReal), tz) : null,
```

**Step 4:** `npm test` → pass. **Step 5:** commit `feat: insights median days in each column, from real moves`.

---

### Task 8: Agents

**Files:** Modify `server/insights.js`; Test `test/insights.test.js`.

**Step 1: failing test:**

```js
test('agents: review left by agents, and agent against you per week', async () => {
  const token = (await server.call('POST', '/tokens', { name: 'helper' })).body.token;
  const byAgent = (await server.call('POST', '/cards', { project_id: projects.hiring, title: 'agent work' }, token)).body;
  await server.call('POST', `/cards/${byAgent.ref}/move`, { column_key: 'review' }, token);
  const byYou = await card('hiring', 'my review');
  await server.call('POST', `/cards/${byYou.ref}/move`, { column_key: 'review' });

  const { agents } = await insights();
  assert.ok(agents.review_from_agents.includes(byAgent.id));
  assert.ok(!agents.review_from_agents.includes(byYou.id));
  assert.equal(agents.weeks.length, 12);
  assert.ok(agents.weeks[11].agent.includes(byAgent.id));
  assert.ok(agents.weeks[11].you.includes(byYou.id));
  assert.ok(!agents.weeks[11].agent.includes(byYou.id));
  assert.deepEqual(agents.this_week, agents.weeks[11].agent);
});
```

**Step 2:** run → FAIL.

**Step 3: implement** — in `buildInsights`:

```js
  const touched = starts.map((start) => ({ start, agent: new Set(), you: new Set() }));
  for (const e of history) {
    const w = !e.estimated && e.actor_kind ? weekOf(e.at) : undefined;
    if (w !== undefined) touched[w][e.actor_kind === 'agent' ? 'agent' : 'you'].add(e.card_id);
  }
  const agentWeeks = touched.map((t) => ({ start: t.start, agent: [...t.agent], you: [...t.you] }));
```

and return:

```js
    agents: {
      review_from_agents: ids(live.filter((c) => c.column_key === 'review'
        && lastInto(byCard.get(c.id) ?? [], 'review')?.actor_kind === 'agent')),
      this_week: agentWeeks[WEEKS - 1].agent,
      weeks: agentWeeks,
    },
```

**Step 4:** `npm test` → all pass; `npm run check`. **Step 5:** commit `feat: insights agent activity`.

---

### Task 9: The Dashboard view, its data and the smoke fixture

**Files:**
- Modify: `web/src/api.js`, `web/src/App.jsx`
- Create: `web/src/Dashboard.jsx` (layout only; charts come in Task 10)
- Modify: `web/smoke.mjs` (fake `/insights`, first dashboard step)

**Step 1: smoke step first.** In `web/smoke.mjs`, add `insights` to `state` (ids match the fake cards; read `state.cards` for the real ids and refs — 10–13 at the time of writing):

```js
  insights: {
    board: { id: 1, name: 'Work', key: 'WRK' }, quiet_days: 7, history_since: '2026-11-05',
    stuck: { waiting: [12, 11], flagged: [10], overdue: [], quiet: [11] },
    projects: [{ id: 1, name: 'House chores', color: '#c3d117',
      by_column: { todo: [10], next: [], doing: [], waiting: [12], review: [13] } }],
    weeks: Array.from({ length: 12 }, (_, i) => ({
      start: new Date(Date.UTC(2026, 7, 16 + 7 * i)).toISOString().slice(0, 10),
      added: i === 11 ? [10, 12] : [], finished: i === 9 ? [99] : [], estimated: i === 9 })),
    time_in_column: Object.fromEntries(['todo', 'next', 'doing', 'waiting', 'review']
      .map((c) => [c, c === 'doing' ? { median_days: 2.5, moves: 3, longest: [11] } : { median_days: null, moves: 0, longest: [] }])),
    agents: { review_from_agents: [13], this_week: [13],
      weeks: Array.from({ length: 12 }, (_, i) => ({ start: '', agent: i === 11 ? [13] : [], you: i === 11 ? [10] : [] })) },
    cards: {
      10: { id: 10, ref: 'WRK-1', title: 'Buy milk', project_id: 1, column_key: 'todo', flagged: 1, due_date: null, updated_at: '2026-11-01 10:00:00', archived: false },
      11: { id: 11, ref: 'WRK-2', title: 'Quiet one', project_id: 1, column_key: 'doing', flagged: 0, due_date: null, updated_at: '2026-10-20 10:00:00', archived: false },
      12: { id: 12, ref: 'WRK-3', title: 'Waiting on vendor', project_id: 1, column_key: 'waiting', flagged: 0, due_date: null, updated_at: '2026-10-30 10:00:00', archived: false },
      13: { id: 13, ref: 'WRK-4', title: 'Written by an agent', project_id: 1, column_key: 'review', flagged: 0, due_date: null, updated_at: '2026-11-02 10:00:00', archived: false },
      99: { id: 99, ref: 'WRK-9', title: 'Old and archived', project_id: 1, column_key: 'done', flagged: 0, due_date: null, updated_at: '2026-10-15 10:00:00', archived: true },
    },
  },
```

Route it in the fake API above the `/board` branch: `if (path.startsWith('/insights')) return json(state.insights);`

Append, after the last step (so earlier steps keep the Board view):

```js
await step('the Dashboard view shows its three blocks', async () => {
  const tab = q('.view-switch button').find((b) => b.textContent === 'Dashboard');
  if (!tab) throw new Error('no Dashboard tab');
  await click(tab);
  await settle();
  const heads = q('.dash h2').map((h) => h.textContent);
  if (heads.join() !== 'Stuck now,Getting done,Agents') throw new Error(`blocks: ${heads}`);
  const waiting = q('.tile').find((t) => t.textContent.includes('Waiting'));
  if (waiting?.querySelector('b').textContent !== '2') throw new Error('Waiting tile should count 2');
});
```

**Step 2:** `cd web && node smoke.mjs` → this step FAILS (no tab).

**Step 3: implement.**

`web/src/api.js`, after `board`:

```js
  insights: (boardId) => request('GET', `/insights?board_id=${boardId}&tz=${new Date().getTimezoneOffset()}`),
```

`web/src/App.jsx`:
- `import { Dashboard } from './Dashboard.jsx';`
- view state: replace the line with
  ```js
  // 'board' is the kanban, 'notes' the sticky notes, 'dashboard' the numbers. Remembered per browser.
  const [view, setView] = useState(() => {
    const saved = readSetting('view', 'board');
    return ['board', 'notes', 'dashboard'].includes(saved) ? saved : 'board';
  });
  ```
- a third button in `.view-switch`, after Notes, same shape: `aria-selected={view === 'dashboard'}`, text `Dashboard`, `onClick={() => setView('dashboard')}`.
- render: `{view === 'notes' ? (<NoteBoard …/>) : view === 'dashboard' ? (<Dashboard boardId={boardId} tick={tick} onOpenCard={setOpenCardId} onError={setError} />) : (<div className="board-scroll">…)}`

`web/src/Dashboard.jsx` (Task 10 fills the charts):

```jsx
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { COLUMN_LABELS } from './Board.jsx';
import { Tile, StackedColumns, WeekBars, MedianColumns, PairBars } from './charts.jsx';
import { DrillPanel } from './DrillPanel.jsx';

const OPEN_COLS = ['todo', 'next', 'doing', 'waiting', 'review'];

/**
 * One board in numbers: where work is stuck, how much gets done, what agents
 * do. Every number is a list of cards; clicking it lists them beside the
 * charts. `tick` changes whenever the server reports a change.
 */
export function Dashboard({ boardId, tick, onOpenCard, onError }) {
  const [data, setData] = useState(null);
  const [pick, setPick] = useState(null); // { title, ids }

  const load = useCallback(() => {
    if (!boardId) return;
    api.insights(boardId).then(setData).catch((e) => onError(e.message));
  }, [boardId, onError]);
  useEffect(() => { load(); }, [load, tick]);
  useEffect(() => { setPick(null); }, [boardId]);

  if (!data) return <div className="center-note">Loading…</div>;
  const show = (title, ids) => setPick({ title, ids });

  return (
    <div className="dash">
      <div className="dash-main">
        <section className="dash-block">
          <h2>Stuck now</h2>
          <div className="tiles">
            <Tile label="Waiting" ids={data.stuck.waiting} onPick={show} />
            <Tile label="Flagged" ids={data.stuck.flagged} onPick={show} />
            <Tile label="Overdue" ids={data.stuck.overdue} onPick={show} />
            <Tile label="Gone quiet" hint={`No change for ${data.quiet_days} days or more`}
              ids={data.stuck.quiet} onPick={show} />
          </div>
          <h3>Open work by project</h3>
          {data.projects.length === 0
            ? <p className="dash-empty">No projects yet.</p>
            : <StackedColumns projects={data.projects} columns={OPEN_COLS} labels={COLUMN_LABELS} onPick={show} />}
        </section>

        <section className="dash-block">
          <h2>Getting done</h2>
          <WeekBars weeks={data.weeks} onPick={show} />
          <h3>Median days in each column</h3>
          <MedianColumns times={data.time_in_column} columns={OPEN_COLS} labels={COLUMN_LABELS}
            since={data.history_since} onPick={show} />
        </section>

        <section className="dash-block">
          <h2>Agents</h2>
          <div className="tiles">
            <Tile label="In Review from agents" ids={data.agents.review_from_agents} onPick={show} />
            <Tile label="Touched by agents this week" ids={data.agents.this_week} onPick={show} />
          </div>
          <PairBars weeks={data.agents.weeks} onPick={show} />
        </section>
      </div>

      {pick && (
        <DrillPanel
          title={pick.title}
          cards={pick.ids.map((id) => data.cards[id]).filter(Boolean)}
          projects={data.projects}
          onOpenCard={onOpenCard}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}
```

Create minimal `charts.jsx` and `DrillPanel.jsx` stubs only if you want this task's step to pass alone; otherwise do Task 10 and 11 before running the smoke again.

**Step 4:** after Tasks 10–11, the step passes. **Step 5:** commit with Task 11.

---

### Task 10: `charts.jsx` — tiles and vertical SVG charts

**Files:** Create `web/src/charts.jsx`.

```jsx
/**
 * Small hand-drawn charts for the dashboard — all upright, no library. Every
 * part a person can click is a button: it calls onPick(title, ids) with the
 * cards behind it, and says how many in its label for a screen reader.
 */
const H = 160;
const TOP = 16;
const BAR = 40;
const GAP = 16;

const plural = (n) => `${n} card${n === 1 ? '' : 's'}`;
const shortName = (name, max = 9) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);
const weekLabel = (start) => new Date(`${start}T00:00:00Z`)
  .toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Props that make an SVG shape a button for `ids`. Empty ones are not clickable. */
function pickable(title, ids, onPick) {
  const go = () => { if (ids.length) onPick(title, ids); };
  return {
    className: 'pick',
    role: 'button',
    tabIndex: ids.length ? 0 : -1,
    'aria-label': `${title} · ${plural(ids.length)}`,
    onClick: go,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    },
  };
}

/** A big number for a list of cards. */
export function Tile({ label, hint, ids, onPick }) {
  return (
    <button className="tile" disabled={!ids.length} title={hint} onClick={() => onPick(label, ids)}>
      <b>{ids.length}</b>
      <span>{label}</span>
    </button>
  );
}

/** One upright column per project, stacked by board column. */
export function StackedColumns({ projects, columns, labels, onPick }) {
  const totals = projects.map((p) => columns.reduce((n, col) => n + p.by_column[col].length, 0));
  const max = Math.max(1, ...totals);
  const y = (n) => H - (n / max) * (H - TOP);
  const width = GAP + projects.length * (BAR + GAP);
  return (
    <div className="chart-scroll">
      <svg className="chart" width={width} height={H + 30} aria-label="Open work by project">
        <line className="chart-axis" x1={0} x2={width} y1={H} y2={H} />
        {projects.map((p, i) => {
          const x = GAP + i * (BAR + GAP);
          let below = 0;
          return (
            <g key={p.id}>
              {columns.map((col) => {
                const list = p.by_column[col];
                if (!list.length) return null;
                const top = y(below + list.length);
                const height = y(below) - top;
                below += list.length;
                return (
                  <rect key={col} x={x} y={top} width={BAR} height={height}
                    style={{ fill: `var(--pipe-${col})` }} {...pickable(`${labels[col]} · ${p.name}`, list, onPick)} />
                );
              })}
              {totals[i] > 0 && <text className="chart-num" x={x + BAR / 2} y={y(totals[i]) - 4}>{totals[i]}</text>}
              <text className="chart-label" x={x + BAR / 2} y={H + 16}>
                {shortName(p.name)}<title>{p.name}</title>
              </text>
            </g>
          );
        })}
      </svg>
      <ColumnKey columns={columns} labels={labels} />
    </div>
  );
}

function ColumnKey({ columns, labels }) {
  return (
    <div className="chart-legend">
      {columns.map((col) => (
        <span key={col}><i className={`pipe-dot pipe-${col}`} />{labels[col]}</span>
      ))}
    </div>
  );
}

/** Finished per week as bars, added per week as a line. Estimated weeks are lighter. */
export function WeekBars({ weeks, onPick }) {
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.finished.length, w.added.length)));
  const y = (n) => H - (n / max) * (H - TOP);
  const mid = (i) => GAP + i * (BAR + GAP) + BAR / 2;
  const width = GAP + weeks.length * (BAR + GAP);
  return (
    <div className="chart-scroll">
      <svg className="chart" width={width} height={H + 30} aria-label="Finished and added per week">
        <line className="chart-axis" x1={0} x2={width} y1={H} y2={H} />
        {weeks.map((w, i) => (
          <g key={w.start}>
            {w.finished.length > 0 && (
              <rect x={mid(i) - BAR / 2} y={y(w.finished.length)} width={BAR} height={H - y(w.finished.length)}
                style={{ fill: 'var(--pipe-done)' }} data-estimated={w.estimated ? '' : undefined}
                {...pickable(`Finished · week of ${weekLabel(w.start)}${w.estimated ? ' (estimated)' : ''}`, w.finished, onPick)} />
            )}
            <text className="chart-label" x={mid(i)} y={H + 16}>{weekLabel(w.start)}</text>
          </g>
        ))}
        <polyline className="chart-line" points={weeks.map((w, i) => `${mid(i)},${y(w.added.length)}`).join(' ')} />
        {weeks.map((w, i) => w.added.length > 0 && (
          <circle key={w.start} className="chart-dot" cx={mid(i)} cy={y(w.added.length)} r={5}
            {...pickable(`Added · week of ${weekLabel(w.start)}`, w.added, onPick)} />
        ))}
      </svg>
      <div className="chart-legend">
        <span><i className="pipe-dot pipe-done" />finished</span>
        <span><i className="key-line" />added</span>
        {weeks.some((w) => w.estimated) && (
          <span className="est-note">Lighter bars are estimates: a card's last change stands in for when it was finished.</span>
        )}
      </div>
    </div>
  );
}

/** Median days per column, one upright bar each; a click lists the slowest cards. */
export function MedianColumns({ times, columns, labels, since, onPick }) {
  const known = columns.filter((col) => times[col]?.median_days !== null && times[col]?.median_days !== undefined);
  if (!known.length) {
    return <p className="dash-empty">Collecting since {since ?? 'today'}. Medians appear once cards move between columns.</p>;
  }
  const max = Math.max(0.1, ...known.map((col) => times[col].median_days));
  const y = (n) => H - (n / max) * (H - TOP);
  const width = GAP + columns.length * (BAR + GAP);
  return (
    <div className="chart-scroll">
      <svg className="chart" width={width} height={H + 30} aria-label="Median days in each column">
        <line className="chart-axis" x1={0} x2={width} y1={H} y2={H} />
        {columns.map((col, i) => {
          const t = times[col];
          const x = GAP + i * (BAR + GAP);
          return (
            <g key={col}>
              {t.median_days !== null && (
                <>
                  <rect x={x} y={y(t.median_days)} width={BAR} height={H - y(t.median_days)}
                    style={{ fill: `var(--pipe-${col})` }} {...pickable(`Longest in ${labels[col]}`, t.longest, onPick)} />
                  <text className="chart-num" x={x + BAR / 2} y={y(t.median_days) - 4}>{t.median_days}d</text>
                </>
              )}
              <text className="chart-label" x={x + BAR / 2} y={H + 16}>{labels[col]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Cards an agent touched against cards you touched, side by side per week. */
export function PairBars({ weeks, onPick }) {
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.agent.length, w.you.length)));
  const y = (n) => H - (n / max) * (H - TOP);
  const half = BAR / 2 - 1;
  const width = GAP + weeks.length * (BAR + GAP);
  return (
    <div className="chart-scroll">
      <svg className="chart" width={width} height={H + 30} aria-label="Agent against you per week">
        <line className="chart-axis" x1={0} x2={width} y1={H} y2={H} />
        {weeks.map((w, i) => {
          const x = GAP + i * (BAR + GAP);
          const label = w.start ? weekLabel(w.start) : '';
          return (
            <g key={`${w.start}-${i}`}>
              {w.agent.length > 0 && (
                <rect x={x} y={y(w.agent.length)} width={half} height={H - y(w.agent.length)}
                  style={{ fill: 'var(--sky)' }} {...pickable(`Agents · week of ${label}`, w.agent, onPick)} />
              )}
              {w.you.length > 0 && (
                <rect x={x + half + 2} y={y(w.you.length)} width={half} height={H - y(w.you.length)}
                  style={{ fill: 'var(--muted)' }} {...pickable(`You · week of ${label}`, w.you, onPick)} />
              )}
              <text className="chart-label" x={x + BAR / 2} y={H + 16}>{label}</text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span><i className="pipe-dot" style={{ background: 'var(--sky)' }} />agents</span>
        <span><i className="pipe-dot" style={{ background: 'var(--muted)' }} />you</span>
      </div>
    </div>
  );
}
```

No test of its own: Task 11's smoke steps exercise every chart.

---

### Task 11: `DrillPanel.jsx`, styles, and the smoke steps

**Files:** Create `web/src/DrillPanel.jsx`; Modify `web/src/styles.css` (new "dashboard" section before the phone section); Modify `web/smoke.mjs`.

**Step 1: smoke steps first** — append after the Task 9 step:

```js
await step('a tile lists its cards, untouched longest first', async () => {
  await click(q('.tile').find((t) => t.textContent.includes('Waiting')));
  const head = document.querySelector('.drill h3')?.textContent;
  if (head !== 'Waiting · 2') throw new Error(`drill header: ${head}`);
  const refs = q('.drill .card-no').map((n) => n.textContent);
  if (refs.join() !== 'WRK-2,WRK-3') throw new Error(`order: ${refs}`);
});

await step('a row opens the card editor', async () => {
  await click(q('.drill-row')[0]);
  await settle();
  if (!document.querySelector('.modal')) throw new Error('card editor did not open');
  await click(document.querySelector('.modal .btn-ghost, .modal [aria-label="Close"]'));
  await settle();
});

await step('Esc closes the list', async () => {
  await act(async () => { dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })); });
  if (document.querySelector('.drill')) throw new Error('list still open');
});

await step("a project's column part lists just those cards", async () => {
  const part = q('.dash .pick').find((p) => p.getAttribute('aria-label') === 'Waiting · House chores · 1 card');
  if (!part) throw new Error('no Waiting part for House chores');
  await click(part);
  if (document.querySelector('.drill h3')?.textContent !== 'Waiting · House chores · 1') throw new Error('wrong list');
});

await step('estimated weeks are marked, and archived cards cannot be opened', async () => {
  const est = q('.dash rect[data-estimated]');
  if (est.length !== 1) throw new Error(`estimated bars: ${est.length}`);
  if (!document.querySelector('.est-note')) throw new Error('no estimate note');
  await click(est[0]);
  const row = q('.drill-row')[0];
  if (!row?.disabled || !row.textContent.includes('archived')) throw new Error('archived row should be shown and disabled');
});

await step('the dashboard is remembered as the view', () => {
  if (dom.window.localStorage.getItem('kanban.view') !== '"dashboard"') throw new Error('view not remembered');
});
```

(Check the card editor's close control in `web/src/CardModal.jsx` and use its real selector in the second step.)

**Step 2:** `cd web && node smoke.mjs` → these steps FAIL.

**Step 3: implement** `web/src/DrillPanel.jsx`:

```jsx
import { useEffect } from 'react';
import { COLUMN_LABELS } from './Board.jsx';

const DAY = 86400000;
/** "9d" since a SQLite UTC time; "today" under a day. */
function age(updatedAt) {
  const days = Math.floor((Date.now() - Date.parse(`${updatedAt.replace(' ', 'T')}Z`)) / DAY);
  return days < 1 ? 'today' : `${days}d`;
}

/** The cards behind a number on the dashboard, untouched longest first. */
export function DrillPanel({ title, cards, projects, onOpenCard, onClose }) {
  useEffect(() => {
    // Esc belongs to the card editor while it is open over the dashboard.
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.overlay')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const colorOf = Object.fromEntries(projects.map((p) => [p.id, p.color]));
  const sorted = [...cards].sort((a, b) => a.updated_at.localeCompare(b.updated_at));

  return (
    <aside className="drill" aria-label={title}>
      <header>
        <h3>{title} · {cards.length}</h3>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close the list">✕</button>
      </header>
      <ul>
        {sorted.map((c) => (
          <li key={c.id}>
            <button
              className="drill-row"
              disabled={c.archived}
              onClick={() => onOpenCard(c.id)}
              title={c.archived ? 'Archived — restore it from the Archive to edit it' : 'Open this card'}
            >
              <span className="card-no">{c.ref}</span>
              <span className="drill-title" dir="auto">{c.title}</span>
              <i className="dot" style={{ background: colorOf[c.project_id] ?? 'var(--muted)' }} />
              <span className="drill-col">{c.archived ? 'archived' : COLUMN_LABELS[c.column_key]}</span>
              <span className="drill-age">{age(c.updated_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

`web/src/styles.css` — new section before `/* ---------------- phone ----------------`:

```css
/* ---------------- dashboard ---------------- */

.dash { flex: 1 1 auto; display: flex; align-items: flex-start; gap: 16px; padding: 18px; overflow: auto; }
.dash-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
.dash-block {
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 14px 16px; box-shadow: var(--shadow);
}
.dash-block h2 { margin: 0 0 10px; font-size: 14px; }
.dash-block h3 { margin: 16px 0 6px; font-size: 12.5px; font-weight: 600; color: var(--muted); }
.dash-empty { margin: 6px 0; font-size: 12.5px; color: var(--muted); }

.tiles { display: flex; flex-wrap: wrap; gap: 10px; }
.tile {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 128px;
  padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--head-bg); color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer;
}
.tile b { font-size: 22px; color: var(--text); font-variant-numeric: tabular-nums; }
.tile:not(:disabled):hover, .tile:focus-visible { border-color: var(--sky); }
.tile:disabled { cursor: default; opacity: 0.6; }

.chart-scroll { overflow-x: auto; }
.chart { display: block; }
.chart .pick { cursor: pointer; }
.chart .pick:hover, .chart .pick:focus-visible { outline: none; stroke: var(--text); stroke-width: 1.5; }
.chart .pick[data-estimated] { opacity: 0.45; }
.chart-axis { stroke: var(--line); }
.chart-label { font-size: 11px; fill: var(--muted); text-anchor: middle; }
.chart-num { font-size: 11px; font-weight: 600; fill: var(--text); text-anchor: middle; }
.chart-line { fill: none; stroke: var(--amber); stroke-width: 2; }
.chart-dot { fill: var(--amber); }
.chart-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; font-size: 12px; color: var(--muted); }
.key-line { display: inline-block; width: 14px; height: 2px; margin-right: 5px; vertical-align: 3px; background: var(--amber); }
.est-note { font-style: italic; }

.drill {
  position: sticky; top: 0; flex: 0 0 340px; max-height: calc(100vh - 110px); overflow: auto;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: var(--shadow);
}
.drill header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid var(--line);
}
.drill h3 { margin: 0; font-size: 13px; }
.drill ul { list-style: none; margin: 0; padding: 4px 0; }
.drill-row {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 12px;
  border: 0; background: none; color: var(--text); font: inherit; font-size: 12.5px; text-align: start; cursor: pointer;
}
.drill-row:hover:not(:disabled) { background: var(--head-bg); }
.drill-row:disabled { cursor: default; opacity: 0.6; }
.drill-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drill-row .dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; }
.drill-col, .drill-age { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
```

and inside the existing `@media (max-width: 640px)` block:

```css
  /* The dashboard stacks; its card list rises from the bottom as a sheet. */
  .dash { flex-direction: column; padding: 12px; }
  .dash-main { width: 100%; }
  .drill {
    position: fixed; left: 0; right: 0; bottom: 0; top: auto; z-index: 20;
    max-height: 60vh; border-radius: 10px 10px 0 0;
  }
```

**Step 4:** `cd web && node smoke.mjs` → "All checks passed." `npm run build` ok. Confirm the new steps fail with `git stash push web/src` and pass after `git stash pop`.

**Step 5:** commit `feat(ui): dashboard view with charts and a deep-dive card list`.

---

### Task 12: Look at it

**Step 1:** Run a throwaway server on a copy of the production backup:
`APP_PASSWORD=local-check-only DB_PATH=<scratch>/kanban.db PORT=3917 node server/index.js` (copy `C:\Users\idobe\pandan-backups\kanban-backup-2026-11-04.db` first). Expect one log line `[db] seeded history for N card(s)` with N = the card count, and none on a second start.

**Step 2:** Screenshot in headless Chrome (the scratchpad `shoot.mjs` pattern: log in, set the cookie over CDP, switch `localStorage['kanban.view']` to `"dashboard"`) at 1500 and 1280 wide in dark and light, and at 360 on a phone, for My board and School. Check: charts upright; no page-level sideways scroll; Hebrew project names cut short with full name on hover; the list opens beside (desktop) or as a sheet (phone); estimated weeks lighter.

**Step 3:** Fix anything wrong, re-run `npm test` and the smoke, commit `fix(ui): …` per fix.

---

### Task 13: Docs, review, ship

**Step 1: docs.**
- `README.md`: after the columns paragraph, a short **Dashboard** paragraph — the three blocks, click any number for its cards, estimates before ship day.
- `API.md`: a "Dashboard" section for `GET /insights?board_id=&tz=` with the shape from the design doc and the rules (every number is a list of ids; finished; estimated; quiet days).
- `CHANGELOG.md`: an Unreleased "### Dashboard" entry.
- Local only: `.claude/dev-dictionary.md` (Dashboard, Move history / card_events, Gone quiet, Stuck now, Deep-dive list, Estimated), `.claude/business-updates.md` (goal: a project-management tool; dashboard decision), `tasks/devlog-pending.md` (DB schema: card_events).
Commit `docs: the dashboard`.

**Step 2:** `npm run check`, `npm test`, `cd web && node smoke.mjs`, `npm run build` — all green. Run the **code-reviewer** agent on `git diff main`; fix CRITICAL/HIGH, consider MEDIUM.

**Step 3: ship** (as for the waiting column):
1. Push over SSH: `git push git@github.com:IdoGigi/pandan.git feat/dashboard`, set upstream, `gh pr create`.
2. Wait for CI (`gh pr checks N --watch`). **Ido merges** (auto mode blocks Claude from merging).
3. Back up production: `VACUUM INTO '/data/kanban-backup-<date>-pre-dashboard.db'` over `railway ssh`, integrity check.
4. `git checkout main && git pull`, `git archive` to the scratchpad, `railway up <export> --path-as-root -p 56459b17-ed66-4add-bd9c-243e6ac4609e -s kanban -e production --ci`.
5. Verify: deployment SUCCESS, the log line `[db] seeded history for … card(s)`, `/healthz` 200, and the insights route from inside the container (`railway ssh` + node fetch with `$APP_PASSWORD`, as done for the MCP check) returns 12 weeks for School.
