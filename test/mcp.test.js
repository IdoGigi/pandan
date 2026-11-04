/**
 * An agent is told "move SCH-3 to done", so every MCP card tool must take the
 * reference shown on the board — and still take a numeric id.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { startServer, tempDir, removeDir, rows } from './helpers.js';

let dir;
let dbPath;
let server;
let card;

before(async () => {
  dir = tempDir();
  dbPath = join(dir, 'pandan.db');
  server = await startServer(dbPath);
  const project = (await server.call('GET', '/projects')).body[0];
  card = (await server.tool('create_card', { project_id: project.id, title: 'from an agent' })).data;
});

after(async () => {
  await server?.stop();
  removeDir(dir);
});

test('a card made by an agent comes back with its reference', () => {
  assert.equal(card.ref, 'MB-1');
});

test('the instructions tell an agent what a reference is', async () => {
  const init = await server.rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  assert.match(init.instructions, /"SCH-3"/);
});

test('every card tool says it takes a reference', async () => {
  const { tools } = await server.rpc('tools/list', {});
  const takesCard = tools.filter((t) => t.inputSchema.properties?.card_id);
  assert.deepEqual(takesCard.map((t) => t.name).sort(),
    ['add_check', 'archive_card', 'get_card', 'move_card', 'restore_card', 'update_card']);
  for (const t of takesCard) {
    const schema = JSON.stringify(t.inputSchema.properties.card_id);
    assert.match(schema, /"string"/, `${t.name} must accept a string`);
    assert.match(schema, /"(integer|number)"/, `${t.name} must still accept an id`);
    assert.match(schema, /SCH-3/, `${t.name} should show an example reference`);
    // "card 14" off the board is SCH-14; the bare number 14 is some other card's id.
    assert.match(schema, /not the number shown on the card/, `${t.name} must warn that a bare number is an id`);
  }
});

test('get_card takes a reference in any case, or an id', async () => {
  for (const cardId of ['MB-1', 'mb-1', card.id]) {
    const res = await server.tool('get_card', { card_id: cardId });
    assert.equal(res.isError, false, String(res.data));
    assert.equal(res.data.id, card.id);
    assert.ok(Array.isArray(res.data.checklist));
  }
});

test('move, update, checklist, archive and restore take a reference', async () => {
  assert.equal((await server.tool('move_card', { card_id: 'MB-1', column_key: 'doing' })).data.column_key, 'doing');
  assert.equal((await server.tool('update_card', { card_id: 'MB-1', title: 'renamed' })).data.title, 'renamed');
  assert.equal((await server.tool('add_check', { card_id: 'MB-1', text: 'a step' })).isError, false);
  assert.deepEqual((await server.tool('archive_card', { card_id: 'MB-1' })).data, { archived: true });
  assert.equal((await server.tool('restore_card', { card_id: 'MB-1' })).data.ref, 'MB-1');
});

test('an unknown reference is a readable tool error', async () => {
  const res = await server.tool('get_card', { card_id: 'NOPE-9' });
  assert.equal(res.isError, true);
  assert.match(res.data, /card not found/);
});

test('create_board takes an optional key', async () => {
  const made = await server.tool('create_board', { name: 'University', key: 'uni' });
  assert.equal(made.data.key, 'UNI');
  const auto = await server.tool('create_board', { name: 'School' });
  assert.equal(auto.data.key, 'SCH');
  const boards = (await server.tool('get_boards', {})).data;
  assert.ok(boards.every((b) => typeof b.key === 'string'), 'get_boards lists the keys');
});

test('an agent key acts as itself through MCP, in the history and on the card', async () => {
  const token = (await server.call('POST', '/tokens', { name: 'mcp-agent' })).body.token;
  const projectId = (await server.call('GET', '/projects')).body[0].id;
  const made = await server.tool('create_card', { project_id: projectId, title: 'by key' }, token);
  assert.equal(made.isError, false, String(made.data));
  const moved = await server.tool('move_card', { card_id: made.data.ref, column_key: 'review' }, token);
  assert.equal(moved.isError, false, String(moved.data));

  assert.deepEqual(
    rows(dbPath, 'SELECT kind, actor, actor_kind FROM card_events WHERE card_id = ? ORDER BY id', made.data.id), [
      { kind: 'created', actor: 'mcp-agent', actor_kind: 'agent' },
      { kind: 'moved', actor: 'mcp-agent', actor_kind: 'agent' },
    ]);
  const stamped = (await server.call('GET', `/cards/${made.data.ref}`)).body;
  assert.deepEqual([stamped.last_actor, stamped.last_actor_kind], ['mcp-agent', 'agent']);
});
