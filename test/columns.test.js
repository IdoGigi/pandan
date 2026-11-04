/**
 * "waiting" sits between doing and review: the work has started, but it is held
 * up by someone or something else. It must work everywhere a column does.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { startServer, tempDir, removeDir } from './helpers.js';

let dir;
let server;
let projectId;

before(async () => {
  dir = tempDir();
  server = await startServer(join(dir, 'pandan.db'));
  projectId = (await server.call('GET', '/projects')).body[0].id;
});

after(async () => {
  await server?.stop();
  removeDir(dir);
});

test('the board lists waiting between doing and review', async () => {
  const { body } = await server.call('GET', '/board');
  assert.deepEqual(body.columns, ['todo', 'next', 'doing', 'waiting', 'review', 'done']);
});

test('a card can be made in waiting, moved there and patched there', async () => {
  const made = await server.call('POST', '/cards', { project_id: projectId, title: 'ask the CTO', column_key: 'waiting' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.column_key, 'waiting');

  const other = (await server.call('POST', '/cards', { project_id: projectId, title: 'vendor quote' })).body;
  const moved = await server.call('POST', `/cards/${other.ref}/move`, { column_key: 'waiting', index: 0 });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(moved.body.column_key, 'waiting');

  const patched = await server.call('PATCH', `/cards/${other.ref}`, { column_key: 'doing' });
  assert.equal(patched.body.column_key, 'doing');
  const back = await server.call('PATCH', `/cards/${other.ref}`, { column_key: 'waiting' });
  assert.equal(back.body.column_key, 'waiting');

  const listed = (await server.call('GET', `/cards?project_id=${projectId}&column=waiting`)).body;
  assert.deepEqual(listed.map((c) => c.title).sort(), ['ask the CTO', 'vendor quote']);
});

test('a project counts its waiting cards', async () => {
  const own = (await server.call('POST', '/projects', { name: 'counted' })).body;
  for (const column_key of ['waiting', 'waiting', 'doing']) {
    await server.call('POST', '/cards', { project_id: own.id, title: column_key, column_key });
  }
  const { stats } = (await server.call('GET', `/projects/${own.id}`)).body;
  assert.equal(stats.by_column.waiting, 2);
  assert.equal(stats.open, 3, 'a waiting card is still open');
});

test('an unknown column is still refused, and the message names waiting', async () => {
  const res = await server.call('POST', '/cards', { project_id: projectId, title: 'x', column_key: 'blocked' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /todo, next, doing, waiting, review, done/);
});

test('MCP: move_card takes waiting, and agents are told what it means', async () => {
  const { tools } = await server.rpc('tools/list', {});
  const column = tools.find((t) => t.name === 'move_card').inputSchema.properties.column_key;
  assert.ok(column.enum.includes('waiting'), JSON.stringify(column));
  assert.match(column.description, /"waiting"/);

  const init = await server.rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  assert.match(init.instructions, /todo, next, doing, waiting, review and done/);

  const card = (await server.tool('create_card', { project_id: projectId, title: 'from an agent' })).data;
  const res = await server.tool('move_card', { card_id: card.ref, column_key: 'waiting' });
  assert.equal(res.isError, false, String(res.data));
  assert.equal(res.data.column_key, 'waiting');
});
