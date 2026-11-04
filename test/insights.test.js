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

/** The Sunday that starts this UTC week, as a Date at 00:00 UTC. */
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
