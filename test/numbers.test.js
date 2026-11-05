/**
 * Project keys and per-project card refs through the REST API, on a fresh board.
 * Board keys are for display only: they never change a card's ref.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { startServer, tempDir, removeDir, sql } from './helpers.js';

let dir;
let dbPath;
let server;
let call;
const boardIds = {};
const projects = {};

async function addCard(project, title) {
  const res = await call('POST', '/cards', { project_id: projects[project].id, title });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function addProject(body) {
  const res = await call('POST', '/projects', body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

before(async () => {
  dir = tempDir();
  dbPath = join(dir, 'pandan.db');
  server = await startServer(dbPath);
  call = server.call;

  boardIds.mb = (await call('GET', '/boards')).body[0].id;
  boardIds.sch = (await call('POST', '/boards', { name: 'School' })).body.id;
  projects.chores = await addProject({ name: 'chores', board_id: boardIds.mb, key: 'chr' });
  projects.garden = await addProject({ name: 'Garden', board_id: boardIds.mb });
  projects.optimization = await addProject({ name: 'optimization', board_id: boardIds.sch, key: 'OPT' });
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

test('a bad or taken board key is refused with a reason', async () => {
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

test('a key made for a new board skips project keys', async () => {
  // "Opt" would make OPT, which is a project's key.
  const made = await call('POST', '/boards', { name: 'Opt' });
  assert.equal(made.status, 201);
  assert.equal(made.body.key, 'OPT2');
});

test('a board key cannot be a project key, or "OPT-1" would name two cards', async () => {
  for (const res of [
    await call('POST', '/boards', { name: 'Opt', key: 'opt' }),
    await call('PATCH', `/boards/${boardIds.sch}`, { key: 'CHR' }),
  ]) {
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'PND-REF-004');
    assert.match(res.body.error, /^PND-REF-004: .*project/);
  }
});

/* ---------------- project keys ---------------- */

test('a project gets the key it is given, in capitals, or one made from its name', async () => {
  assert.equal(projects.chores.key, 'CHR');
  assert.equal(projects.garden.key, 'GAR');
  assert.equal(projects.optimization.key, 'OPT');
  // The two projects a new board starts with are keyed as well.
  const seeded = (await call('GET', `/projects?board_id=${boardIds.mb}`)).body;
  assert.deepEqual(seeded.map((p) => p.key), ['HC', 'VOL', 'CHR', 'GAR']);
});

test('a bad, taken or board-key project key is refused with a code', async () => {
  const cases = [
    [{ name: 'x', key: 'C1' }, 'PND-REF-001'],
    [{ name: 'x', key: 'TOOLNG' }, 'PND-REF-001'],
    [{ name: 'x', key: 'chr' }, 'PND-REF-002'],
    [{ name: 'x', key: 'SCH' }, 'PND-REF-003'],
  ];
  for (const [body, code] of cases) {
    const res = await call('POST', '/projects', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, code, JSON.stringify(res.body));
    assert.ok(res.body.error.startsWith(`${code}: `), res.body.error);
  }
});

test("a project's key never changes", async () => {
  const res = await call('PATCH', `/projects/${projects.chores.id}`, { key: 'NEW' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'PND-REF-008');
  // Sending the key it already has, as a form that saves everything does, is fine.
  assert.equal((await call('PATCH', `/projects/${projects.chores.id}`, { key: 'chr', name: 'chores' })).status, 200);
  assert.throws(() => sql(dbPath, "UPDATE projects SET key = 'NEW' WHERE id = ?", projects.chores.id),
    /PND-REF-010/, 'the database refuses it too');
});

test("a deleted project's key is never given out again", async () => {
  const temp = await addProject({ name: 'Temp', key: 'TMP' });
  const card = (await call('POST', '/cards', { project_id: temp.id, title: 'gone soon' })).body;
  assert.equal(card.ref, 'TMP-1');
  assert.equal((await call('DELETE', `/projects/${temp.id}`)).status, 200);

  const again = await call('POST', '/projects', { name: 'Tmp', key: 'TMP' });
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'PND-REF-002');
  assert.equal((await addProject({ name: 'Tmp' })).key, 'TMPA', 'a suggestion skips it too');
});

/* ---------------- numbers ---------------- */

test('each project numbers its cards from 1', async () => {
  const a = await addCard('chores', 'chores one');
  const b = await addCard('optimization', 'opt one');
  const c = await addCard('garden', 'garden one');
  const d = await addCard('chores', 'chores two');
  assert.deepEqual([a.ref, b.ref, c.ref, d.ref], ['CHR-1', 'OPT-1', 'GAR-1', 'CHR-2']);
  assert.deepEqual([a.ref_key, a.ref_number], ['CHR', 1]);
  assert.equal(a.legacy_ref, null, 'a new card has no old board ref');
});

test('a card is found by its ref in any case, by its id, or by #id', async () => {
  const byRef = await call('GET', '/cards/CHR-2');
  assert.equal(byRef.status, 200);
  assert.equal(byRef.body.title, 'chores two');
  assert.ok(Array.isArray(byRef.body.checklist));
  const { id } = byRef.body;
  for (const path of ['/cards/chr-2', '/cards/%23CHR-2', `/cards/${id}`, `/cards/%23${id}`]) {
    const res = await call('GET', path);
    assert.equal(res.body.id, id, path);
    assert.equal(res.body.ref, 'CHR-2', path);
  }
});

test('an unknown ref is a 404, not some other card', async () => {
  for (const path of ['/cards/CHR-99', '/cards/NOPE-1', '/cards/CHR-0', '/cards/abc', '/cards/MB-1', '/cards/%23999999']) {
    assert.equal((await call('GET', path)).status, 404, path);
  }
});

test('archive, restore, checklist and edits all take a ref', async () => {
  const card = await addCard('chores', 'by ref');
  assert.equal(card.ref, 'CHR-3');

  assert.equal((await call('POST', '/cards/CHR-3/checks', { text: 'step' })).status, 201);
  assert.equal((await call('PATCH', '/cards/CHR-3', { title: 'renamed' })).body.title, 'renamed');
  assert.equal((await call('DELETE', '/cards/CHR-3')).status, 200);
  assert.equal((await call('DELETE', '/cards/CHR-3')).status, 404, 'already archived');

  const archived = (await call('GET', '/cards?archived=true')).body;
  assert.ok(archived.some((c) => c.ref === 'CHR-3'), 'the archive lists the ref');

  const restored = await call('POST', '/cards/CHR-3/restore');
  assert.equal(restored.status, 200);
  assert.equal(restored.body.ref, 'CHR-3', 'a restored card keeps its number');
});

test('a number is never handed out twice, even after a card is deleted for good', async () => {
  const doomed = await addCard('optimization', 'doomed');
  assert.equal(doomed.ref, 'OPT-2');
  assert.equal((await call('DELETE', '/cards/OPT-2/permanent')).status, 200);
  assert.equal((await addCard('optimization', 'after')).ref, 'OPT-3');
  assert.equal((await call('GET', '/cards/OPT-2')).status, 404);
});

test('cards made at the same moment never share a number', async () => {
  const made = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    call('POST', '/cards', { project_id: projects.garden.id, title: `rush ${i}` })));
  assert.ok(made.every((r) => r.status === 201));
  const numbers = made.map((r) => r.body.ref_number).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 20 }, (_, i) => i + 2), 'GAR-2 to GAR-21, each once');
});

test('the database itself refuses a second card with the same ref', () => {
  assert.throws(() => sql(dbPath,
    `INSERT INTO cards (project_id, column_key, title, position, ref_key, ref_number)
     VALUES (?, 'todo', 'twin', 1, 'CHR', 1)`, projects.chores.id), /UNIQUE constraint failed/);
});

test('the database refuses to rename a key or lower its count', () => {
  assert.throws(() => sql(dbPath, "UPDATE ref_keys SET key = 'XYZ' WHERE key = 'CHR'"), /PND-REF-011/);
  assert.throws(() => sql(dbPath, "UPDATE ref_keys SET last_number = 0 WHERE key = 'CHR'"), /PND-REF-011/);
  assert.throws(() => sql(dbPath, "DELETE FROM ref_keys WHERE key = 'CHR'"), /PND-REF-011/);
});

test("the database refuses to change a card's ref once it has one", () => {
  assert.throws(() => sql(dbPath, "UPDATE cards SET ref_number = 99 WHERE ref_key = 'CHR' AND ref_number = 1"),
    /PND-REF-007/);
  assert.throws(() => sql(dbPath, "UPDATE cards SET ref_key = 'OPT' WHERE ref_key = 'CHR' AND ref_number = 1"),
    /PND-REF-007/);
});

/* ---------------- moving ---------------- */

test('a card moved to another project, even on another board, keeps its ref', async () => {
  const moved = await call('POST', '/cards/CHR-1/move', { project_id: projects.optimization.id, column_key: 'doing' });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.ref, 'CHR-1');
  assert.equal(moved.body.project_id, projects.optimization.id);
  const patched = await call('PATCH', '/cards/CHR-1', { project_id: projects.garden.id });
  assert.equal(patched.body.ref, 'CHR-1');
  assert.equal((await addCard('optimization', 'next one')).ref, 'OPT-4', "the move took none of OPT's numbers");
  assert.equal((await addCard('chores', 'still counting')).ref, 'CHR-4');
});

test('a project moved to another board keeps every ref', async () => {
  const travels = await addProject({ name: 'travels', board_id: boardIds.mb, key: 'TRV' });
  const first = (await call('POST', '/cards', { project_id: travels.id, title: 'first' })).body;
  const second = (await call('POST', '/cards', { project_id: travels.id, title: 'second' })).body;
  await call('DELETE', `/cards/${second.id}`);   // archived cards move too

  assert.equal((await call('PATCH', `/projects/${travels.id}`, { board_id: boardIds.sch })).status, 200);
  assert.equal((await call('GET', `/cards/${first.id}`)).body.ref, 'TRV-1');
  assert.equal((await call('GET', `/cards/${second.id}`)).body.ref, 'TRV-2');
});

test('a new board key changes no ref', async () => {
  const before = (await call('GET', '/cards/OPT-1')).body;
  const res = await call('PATCH', `/boards/${boardIds.sch}`, { key: 'uni' });
  assert.equal(res.status, 200);
  assert.equal(res.body.key, 'UNI');
  assert.equal((await call('GET', '/cards/OPT-1')).body.id, before.id);
  assert.equal((await call('GET', '/cards/UNI-1')).status, 404);
});

/* ---------------- what the board shows ---------------- */

test('the board, the project panel and card lists all carry ref and legacy_ref', async () => {
  const board = (await call('GET', `/board?board_id=${boardIds.sch}`)).body;
  assert.ok(board.cards.length > 0);
  for (const card of board.cards) {
    assert.match(card.ref, /^[A-Z]{2,5}-\d+$/);
    assert.ok('legacy_ref' in card);
  }
  const project = (await call('GET', `/projects/${projects.optimization.id}`)).body;
  assert.equal(project.key, 'OPT');
  assert.ok(project.cards.every((c) => /^(OPT|CHR)-\d+$/.test(c.ref) && 'legacy_ref' in c));

  const list = (await call('GET', `/cards?project_id=${projects.chores.id}`)).body;
  assert.ok(list.every((c) => /^CHR-\d+$/.test(c.ref) && 'legacy_ref' in c));
});
