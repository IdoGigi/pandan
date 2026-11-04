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
