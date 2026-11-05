/**
 * The dashboard's numbers. Every number is a list of card ids, so these tests
 * check exactly which cards land where, on back-dated rows.
 *
 * The tests share one server and run in file order, so each one sees the cards
 * the earlier ones made. Assertions look at a test's own cards, apart from a
 * few exact ones that hold only because of that order.
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
/** Archives a card, so a test that counts on the archive fails at the cause if it did not happen. */
async function archive(c) {
  const res = await server.call('DELETE', `/cards/${c.ref}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
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

test('work by project, split by column, without shelved projects', async () => {
  const { projects: list } = await insights();
  assert.deepEqual(list.map((p) => p.name), ['hiring', 'website']);
  const hiring = list.find((p) => p.name === 'hiring');
  assert.deepEqual(Object.keys(hiring.by_column), ['todo', 'next', 'doing', 'waiting', 'review', 'done']);
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
  assert.equal((await server.call('GET', `/insights?board_id=${boardId}&tz=900`)).status, 400);
  assert.equal((await server.call('GET', '/insights?board_id=99999')).status, 404);
  assert.equal((await server.call('GET', '/insights?board_id=')).body.board?.id, other.board_id,
    'an empty board_id means the default board');
});

/** The Sunday that starts this UTC week, as a Date at 00:00 UTC. */
function thisSunday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}
/** A day as YYYY-MM-DD, from epoch ms. */
const iso = (t) => new Date(t).toISOString().slice(0, 10);
/** The start of the week a card counts as finished in, if any. */
const finishedIn = (data, id) => data.weeks.find((w) => w.finished.includes(id))?.start;

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
  // The week's start, not its index: from Saturday 22:00 UTC this week has
  // already begun at UTC+2, so the indexes shift but the starts do not.
  assert.equal(finishedIn(await insights(0), late.id), iso(thisSunday().getTime() - 7 * 86400000));
  assert.equal(finishedIn(await insights(-120), late.id), iso(thisSunday().getTime()));
});

test('a card archived from Done still counts, and restoring it keeps its week', async () => {
  const filed = await card('website', 'filed away');
  await server.call('POST', `/cards/${filed.ref}/move`, { column_key: 'done' });
  const threeWeeksAgo = new Date(thisSunday().getTime() - 20 * 86400000);
  sql(dbPath, `UPDATE card_events SET at = ? WHERE card_id = ? AND to_column = 'done'`,
      threeWeeksAgo.toISOString().slice(0, 19).replace('T', ' '), filed.id);
  const finishWeek = iso(thisSunday().getTime() - 21 * 86400000);
  await server.call('DELETE', `/cards/${filed.ref}`);
  assert.equal(finishedIn(await insights(), filed.id), finishWeek, 'archived from Done still counts');
  await server.call('POST', `/cards/${filed.ref}/restore`);
  assert.equal(finishedIn(await insights(), filed.id), finishWeek, 'a restore is not a new finish');
});

/**
 * Rewrites a Done card's history as seeding writes it: made long ago, a guessed
 * finish at `finish`, and archived from Done at `archivedAt` if it already was.
 */
function seededHistory(id, finish, archivedAt = null) {
  sql(dbPath, 'DELETE FROM card_events WHERE card_id = ?', id);
  sql(dbPath, `INSERT INTO card_events (card_id, kind, at) VALUES (?, 'created', ?)`, id, ago(200));
  sql(dbPath, `INSERT INTO card_events (card_id, kind, to_column, at, estimated) VALUES (?, 'moved', 'done', ?, 1)`,
      id, finish);
  if (archivedAt) {
    sql(dbPath, `INSERT INTO card_events (card_id, kind, from_column, at) VALUES (?, 'archived', 'done', ?)`,
        id, archivedAt);
  }
}

test('a guessed finish of a card archived from Done counts in Done, but in no week', async () => {
  const cleared = await card('website', 'cleared out', { column_key: 'done' });
  await archive(cleared);
  // Archiving stamped the card's last change, so seeding guessed its finish on the archive day.
  const archivedAt = ago(0);
  seededHistory(cleared.id, archivedAt, archivedAt);

  const data = await insights();
  assert.ok(data.totals.done.includes(cleared.id));
  assert.ok(data.projects.find((p) => p.name === 'website').by_column.done.includes(cleared.id));
  assert.equal(finishedIn(data, cleared.id), undefined, 'its guessed finish is really the archive day');
});

test('a guessed finish keeps its week when the card is archived later', async () => {
  const kept = await card('website', 'finished long ago', { column_key: 'done' });
  const threeWeeksAgo = new Date(thisSunday().getTime() - 20 * 86400000);
  seededHistory(kept.id, threeWeeksAgo.toISOString().slice(0, 19).replace('T', ' '));
  const finishWeek = iso(thisSunday().getTime() - 21 * 86400000);
  assert.equal(finishedIn(await insights(), kept.id), finishWeek);
  await archive(kept);
  assert.equal(finishedIn(await insights(), kept.id), finishWeek, 'archiving does not shrink a past week');
});

test('restoring a card archived before seeding does not bring its guessed finish back', async () => {
  const cleared = await card('website', 'cleared and back', { column_key: 'done' });
  await archive(cleared);
  const archivedAt = ago(0);
  seededHistory(cleared.id, archivedAt, archivedAt);
  assert.equal((await server.call('POST', `/cards/${cleared.ref}/restore`)).status, 200);

  const data = await insights();
  assert.ok(data.columns.done.includes(cleared.id), 'it is live in Done again');
  assert.equal(finishedIn(data, cleared.id), undefined, 'its guessed finish is still the archive day');
});

/** Writes one back-dated history row, as the owner. */
const addEvent = (id, kind, from, to, at, estimated = 0) => sql(dbPath,
  `INSERT INTO card_events (card_id, kind, from_column, to_column, actor_kind, at, estimated)
   VALUES (?, ?, ?, ?, 'owner', ?, ?)`, id, kind, from, to, at, estimated);

test('median days per column use real moves only, and list the slowest cards', async () => {
  const slow = await card('hiring', 'slow');
  const quick = await card('hiring', 'quick');
  const guessed = await card('hiring', 'guessed');
  for (const c of [slow, quick, guessed]) sql(dbPath, 'DELETE FROM card_events WHERE card_id = ?', c.id);
  addEvent(slow.id, 'moved', 'todo', 'doing', ago(10));
  addEvent(slow.id, 'moved', 'doing', 'review', ago(6));    // 4 days in doing
  addEvent(quick.id, 'moved', 'todo', 'doing', ago(5));
  addEvent(quick.id, 'moved', 'doing', 'review', ago(3));   // 2 days in doing
  addEvent(guessed.id, 'moved', 'todo', 'doing', ago(30), 1);
  addEvent(guessed.id, 'moved', 'doing', 'review', ago(1)); // starts from a guess: not measured
  // A seeded creation row: exact date, but no actor — it is not when collecting began.
  sql(dbPath, `INSERT INTO card_events (card_id, kind, at) VALUES (?, 'created', ?)`, guessed.id, ago(60));

  const { time_in_column: t, history_since } = await insights();
  assert.equal(t.doing.median_days, 3);
  assert.equal(t.doing.moves, 2);
  assert.deepEqual(t.doing.longest.slice(0, 2), [slow.id, quick.id]);
  assert.deepEqual(t.doing.longest_days.slice(0, 2), [4, 2]);
  assert.deepEqual(Object.keys(t), ['todo', 'next', 'doing', 'waiting', 'review']);
  assert.equal(t.next.median_days, null);
  assert.match(history_since, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(history_since > daysAgoDate(60), 'seeded rows (no actor) do not count as collecting');
});

test('time spent archived is left out of a stay', async () => {
  const paused = await card('hiring', 'paused');
  sql(dbPath, 'DELETE FROM card_events WHERE card_id = ?', paused.id);
  addEvent(paused.id, 'moved', 'todo', 'doing', ago(40));
  addEvent(paused.id, 'archived', 'doing', null, ago(39.5)); // half a day in doing
  addEvent(paused.id, 'restored', null, 'doing', ago(9.5));  // 30 days put away
  addEvent(paused.id, 'moved', 'doing', 'review', ago(9));   // half a day more
  const { doing } = (await insights()).time_in_column;
  assert.equal(doing.longest_days[doing.longest.indexOf(paused.id)], 1);
});

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

/** Ids in numeric order, to compare lists as sets. */
const sorted = (list) => [...list].sort((a, b) => a - b);

test('totals: open, in progress, and done with cards archived from Done', async () => {
  const todo = await card('website', 'totals todo');
  const doing = await card('website', 'totals doing', { column_key: 'doing' });
  const waiting = await card('website', 'totals waiting', { column_key: 'waiting' });
  const review = await card('website', 'totals review', { column_key: 'review' });
  const done = await card('website', 'totals done', { column_key: 'done' });
  const filed = await card('website', 'totals filed', { column_key: 'done' });
  const dropped = await card('website', 'totals dropped');
  const back = await card('website', 'totals back', { column_key: 'next' });
  const shelved = await card('shelved', 'totals shelved', { column_key: 'done' });
  for (const c of [filed, dropped, back]) await archive(c);
  assert.equal((await server.call('POST', `/cards/${back.ref}/restore`)).status, 200);

  const { totals } = await insights();
  const countsIn = (c) => Object.keys(totals).filter((key) => totals[key].includes(c.id));
  assert.deepEqual(Object.keys(totals), ['open', 'in_progress', 'done']);
  assert.deepEqual(countsIn(todo), ['open']);
  for (const c of [doing, waiting, review]) assert.deepEqual(countsIn(c), ['open', 'in_progress']);
  assert.deepEqual(countsIn(done), ['done']);
  assert.deepEqual(countsIn(filed), ['done'], 'archived from Done was finished');
  assert.deepEqual(countsIn(dropped), [], 'archived from To do was dropped, not finished');
  assert.deepEqual(countsIn(back), ['open'], 'a restored card counts where it is now');
  assert.deepEqual(countsIn(shelved), [], 'shelved projects stay out');
});

test('columns: live cards by column, Done included', async () => {
  const done = await card('hiring', 'columns done', { column_key: 'done' });
  const next = await card('hiring', 'columns next', { column_key: 'next' });
  const filed = await card('hiring', 'columns filed', { column_key: 'done' });
  await archive(filed);

  const { columns, totals, cards } = await insights();
  assert.deepEqual(Object.keys(columns), ['todo', 'next', 'doing', 'waiting', 'review', 'done']);
  assert.ok(columns.done.includes(done.id));
  assert.ok(columns.next.includes(next.id));
  assert.ok(!Object.values(columns).flat().includes(filed.id), 'an archived card is off the board');
  const live = Object.values(cards).filter((c) => !c.archived).map((c) => c.id);
  assert.deepEqual(sorted(Object.values(columns).flat()), sorted(live), 'each live card in one column');
  const inFlight = [...columns.doing, ...columns.waiting, ...columns.review];
  assert.deepEqual(sorted([...columns.todo, ...columns.next, ...inFlight]), sorted(totals.open));
  assert.deepEqual(sorted(inFlight), sorted(totals.in_progress));
});

test('each project counts its Done, archived from Done included', async () => {
  const done = await card('hiring', 'project done', { column_key: 'done' });
  const filed = await card('hiring', 'project filed', { column_key: 'done' });
  const dropped = await card('hiring', 'project dropped', { column_key: 'review' });
  for (const c of [filed, dropped]) await archive(c);
  const elsewhere = await card('website', 'project elsewhere', { column_key: 'done' });

  const { projects: list, totals } = await insights();
  const hiring = list.find((p) => p.name === 'hiring');
  assert.ok(hiring.by_column.done.includes(done.id));
  assert.ok(hiring.by_column.done.includes(filed.id), 'archived from Done counts as done');
  assert.ok(!Object.values(hiring.by_column).flat().includes(dropped.id), 'archived from Review counts nowhere');
  assert.ok(!hiring.by_column.done.includes(elsewhere.id));
  assert.deepEqual(sorted(list.flatMap((p) => p.by_column.done)), sorted(totals.done), 'the projects add up to the total');
});

test('age of open work: whole days since made, each range from its start up to its end', async () => {
  const made = {};
  for (const days of [0, 6.9, 7, 20, 89.9, 90]) {
    made[days] = await card('website', `aged ${days}`);
    sql(dbPath, 'UPDATE cards SET created_at = ? WHERE id = ?', ago(days), made[days].id);
  }
  const finished = await card('website', 'aged and done', { column_key: 'done' });
  const filed = await card('website', 'aged and archived');
  await archive(filed);
  for (const c of [finished, filed]) sql(dbPath, 'UPDATE cards SET created_at = ? WHERE id = ?', ago(100), c.id);

  const { age, totals } = await insights();
  assert.deepEqual(age.map((a) => [a.from_days, a.to_days]), [[0, 7], [7, 14], [14, 30], [30, 90], [90, null]]);
  const rangeOf = (c) => age.findIndex((a) => a.ids.includes(c.id));
  assert.equal(rangeOf(made[0]), 0);
  assert.equal(rangeOf(made[6.9]), 0, '6 whole days is under a week');
  assert.equal(rangeOf(made[7]), 1, '7 days starts the second range');
  assert.equal(rangeOf(made[20]), 2);
  assert.equal(rangeOf(made[89.9]), 3, '89 whole days is under 90');
  assert.equal(rangeOf(made[90]), 4, '90 days starts the last range');
  assert.equal(rangeOf(finished), -1, 'Done is not open work');
  assert.equal(rangeOf(filed), -1, 'an archived card is not open work');
  assert.deepEqual(sorted(age.flatMap((a) => a.ids)), sorted(totals.open), 'each open card in one range');
});

test('the cards map carries when each card was made and its place in its column', async () => {
  const first = await card('website', 'placed first', { column_key: 'next' });
  const second = await card('website', 'placed second', { column_key: 'next' });
  const { cards } = await insights();
  assert.equal(cards[first.id].created_at, first.created_at);
  assert.equal(cards[first.id].position, first.position);
  assert.ok(cards[second.id].position > cards[first.id].position);
  assert.ok(Object.values(cards).every((c) =>
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(c.created_at) && typeof c.position === 'number'));
});
