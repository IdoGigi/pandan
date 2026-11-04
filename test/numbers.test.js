/**
 * Per-board card numbers and board keys through the REST API, on a fresh board.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { startServer, tempDir, removeDir } from './helpers.js';

let dir;
let server;
let call;
const boardIds = {};
const projectIds = {};

async function addCard(project, title) {
  const res = await call('POST', '/cards', { project_id: projectIds[project], title });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

before(async () => {
  dir = tempDir();
  server = await startServer(join(dir, 'pandan.db'));
  call = server.call;

  boardIds.mb = (await call('GET', '/boards')).body[0].id;
  boardIds.sch = (await call('POST', '/boards', { name: 'School' })).body.id;
  for (const [name, board] of [['chores', 'mb'], ['garden', 'mb'], ['optimization', 'sch']]) {
    projectIds[name] = (await call('POST', '/projects', { name, board_id: boardIds[board] })).body.id;
  }
});

after(async () => {
  await server?.stop();
  removeDir(dir);
});

/* ---------------- board keys ---------------- */

test('the first board and new boards get keys from their names', async () => {
  const boards = (await call('GET', '/boards')).body;
  assert.deepEqual(boards.map((b) => [b.name, b.key]), [['My board', 'MB'], ['School', 'SCH']]);

  const schedule = await call('POST', '/boards', { name: 'Schedule' });
  assert.equal(schedule.body.key, 'SCH2', 'a taken key gets a digit');
  const hebrew = await call('POST', '/boards', { name: 'לימודים' });
  assert.equal(hebrew.body.key, `B${hebrew.body.id}`);
});

test('a board can be made with its own key, in any case', async () => {
  const res = await call('POST', '/boards', { name: 'Work', key: 'wrk' });
  assert.equal(res.status, 201);
  assert.equal(res.body.key, 'WRK');
});

test('a bad or taken key is refused with a reason', async () => {
  const bad = await call('POST', '/boards', { name: 'X', key: 'bad key' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /2 to 6 letters or digits/);

  const taken = await call('POST', '/boards', { name: 'X', key: 'sch' });
  assert.equal(taken.status, 400);
  assert.match(taken.body.error, /SCH is already used by the board "School"/);

  const patchBad = await call('PATCH', `/boards/${boardIds.mb}`, { key: '9LIVES' });
  assert.equal(patchBad.status, 400);
  const patchTaken = await call('PATCH', `/boards/${boardIds.mb}`, { key: 'SCH' });
  assert.equal(patchTaken.status, 400);
  // Saving a board with its own key is not a clash.
  assert.equal((await call('PATCH', `/boards/${boardIds.mb}`, { key: 'MB', name: 'My board' })).status, 200);
});

/* ---------------- numbers ---------------- */

test('each board numbers its cards from 1', async () => {
  const a = await addCard('chores', 'mb one');
  const b = await addCard('optimization', 'sch one');
  const c = await addCard('garden', 'mb two');      // another project, same board
  const d = await addCard('optimization', 'sch two');
  assert.deepEqual([a.ref, b.ref, c.ref, d.ref], ['MB-1', 'SCH-1', 'MB-2', 'SCH-2']);
  assert.deepEqual([a.number, b.number], [1, 1]);
});

test('a card is found by its reference, in any case, or by its id', async () => {
  const byRef = await call('GET', '/cards/SCH-2');
  assert.equal(byRef.status, 200);
  assert.equal(byRef.body.title, 'sch two');
  assert.ok(Array.isArray(byRef.body.checklist));
  assert.equal((await call('GET', '/cards/sch-2')).body.id, byRef.body.id);
  assert.equal((await call('GET', `/cards/${byRef.body.id}`)).body.ref, 'SCH-2');
  assert.equal((await call('GET', '/cards/%23SCH-2')).body.id, byRef.body.id);
});

test('an unknown reference is a 404, not some other card', async () => {
  for (const path of ['/cards/SCH-99', '/cards/NOPE-1', '/cards/SCH-0', '/cards/abc']) {
    assert.equal((await call('GET', path)).status, 404, path);
  }
});

test('archive, restore, checklist and edits all take a reference', async () => {
  const card = await addCard('chores', 'by ref');   // MB-3
  assert.equal(card.ref, 'MB-3');

  assert.equal((await call('POST', '/cards/MB-3/checks', { text: 'step' })).status, 201);
  assert.equal((await call('PATCH', '/cards/MB-3', { title: 'renamed' })).body.title, 'renamed');
  assert.equal((await call('DELETE', '/cards/MB-3')).status, 200);
  assert.equal((await call('DELETE', '/cards/MB-3')).status, 404, 'already archived');

  const archived = (await call('GET', '/cards?archived=true')).body;
  assert.ok(archived.some((c) => c.ref === 'MB-3'), 'the archive lists the reference');

  const restored = await call('POST', '/cards/MB-3/restore');
  assert.equal(restored.status, 200);
  assert.equal(restored.body.ref, 'MB-3', 'a restored card keeps its number');
});

test('a number is never handed out twice, even after a card is deleted for good', async () => {
  const doomed = await addCard('optimization', 'doomed');   // SCH-3
  assert.equal(doomed.ref, 'SCH-3');
  assert.equal((await call('DELETE', '/cards/SCH-3/permanent')).status, 200);
  assert.equal((await addCard('optimization', 'after')).ref, 'SCH-4');
  assert.equal((await call('GET', '/cards/SCH-3')).status, 404);
});

/* ---------------- moving between boards ---------------- */

test('moving a card within a board keeps its number', async () => {
  const moved = await call('POST', '/cards/MB-1/move', { project_id: projectIds.garden, column_key: 'doing' });
  assert.equal(moved.body.ref, 'MB-1');
  const patched = await call('PATCH', '/cards/MB-1', { project_id: projectIds.chores });
  assert.equal(patched.body.ref, 'MB-1');
});

test('moving a card to another board gives it that board\'s next number', async () => {
  const moved = await call('POST', '/cards/MB-2/move', { project_id: projectIds.optimization });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.ref, 'SCH-5');
  assert.equal((await call('GET', '/cards/MB-2')).status, 404, 'the old reference points at nothing');

  const back = await call('PATCH', '/cards/SCH-5', { project_id: projectIds.chores });
  assert.equal(back.body.ref, 'MB-4', 'MB-2 is not reused');
});

test('moving a project to another board renumbers its cards there, oldest first', async () => {
  const project = (await call('POST', '/projects', { name: 'travels', board_id: boardIds.mb })).body.id;
  const first = (await call('POST', '/cards', { project_id: project, title: 'first' })).body;
  const second = (await call('POST', '/cards', { project_id: project, title: 'second' })).body;
  await call('DELETE', `/cards/${second.id}`);   // archived cards move too

  const res = await call('PATCH', `/projects/${project}`, { board_id: boardIds.sch });
  assert.equal(res.status, 200);
  assert.equal((await call('GET', `/cards/${first.id}`)).body.ref, 'SCH-6');
  assert.equal((await call('GET', `/cards/${second.id}`)).body.ref, 'SCH-7');

  // Renaming the project on the same board leaves the numbers alone.
  await call('PATCH', `/projects/${project}`, { name: 'trips' });
  assert.equal((await call('GET', `/cards/${first.id}`)).body.ref, 'SCH-6');
});

/* ---------------- what the board shows ---------------- */

test('the board, the project panel and card lists all carry the reference', async () => {
  const board = (await call('GET', `/board?board_id=${boardIds.sch}`)).body;
  assert.equal(board.board.key, 'SCH');
  assert.ok(board.cards.length > 0);
  for (const card of board.cards) {
    assert.equal(card.ref, `SCH-${card.number}`);
  }

  const project = (await call('GET', `/projects/${projectIds.optimization}`)).body;
  assert.ok(project.cards.every((c) => c.ref === `SCH-${c.number}`));

  const list = (await call('GET', `/cards?project_id=${projectIds.chores}`)).body;
  assert.ok(list.every((c) => /^MB-\d+$/.test(c.ref)));
});

test('a new key changes every reference on the board, and the numbers stay', async () => {
  const before = (await call('GET', '/cards/SCH-1')).body;
  const res = await call('PATCH', `/boards/${boardIds.sch}`, { key: 'uni' });
  assert.equal(res.status, 200);
  assert.equal(res.body.key, 'UNI');
  assert.equal((await call('GET', '/cards/UNI-1')).body.id, before.id);
  assert.equal((await call('GET', '/cards/SCH-1')).status, 404);
});
