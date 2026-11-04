/**
 * Move history: one row per create, column move, archive and restore, so the
 * dashboard can say how long work takes and who moved it.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { startServer, tempDir, removeDir, rows, sql } from './helpers.js';

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
  assert.equal(history(card.id).length, 1);
  await server.call('DELETE', `/cards/${card.ref}/permanent`);
  assert.deepEqual(history(card.id), []);
});

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
    assert.deepEqual(rows(path, 'SELECT DISTINCT actor, actor_kind FROM card_events'),
      [{ actor: null, actor_kind: null }], 'seeded rows name no actor');

    s = await startServer(path);
    await s.stop();
    assert.doesNotMatch(s.log(), /seeded history/);
    assert.equal(rows(path, 'SELECT COUNT(*) AS n FROM card_events')[0].n, 5);
  } finally {
    removeDir(seedDir);
  }
});
