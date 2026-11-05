/**
 * An agent is told "move CRC-3 to done", so every MCP card tool must take the
 * ref shown on the board, the old board ref a card had before ("MB-223"), and
 * the card id ("300" or "#300", as Jira items say "Source: kanban #300").
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { startServer, tempDir, removeDir, rows, sql } from './helpers.js';

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

test('a card made by an agent comes back with its ref and no old one', () => {
  assert.equal(card.ref, 'HC-1');
  assert.equal(card.legacy_ref, null);
});

test('the instructions tell an agent what a ref, an old ref and #NN are', async () => {
  const init = await server.rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  assert.match(init.instructions, /"CRC-3"/);
  assert.match(init.instructions, /"MB-223"/);
  assert.match(init.instructions, /"#300"/);
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
    assert.match(schema, /CRC-3/, `${t.name} should show an example ref`);
    assert.match(schema, /MB-223/, `${t.name} should say an old board ref works`);
    // "card 14" off the board is CRC-14; the bare number 14 (or #14) is some other card's id.
    assert.match(schema, /not the number shown on the card/, `${t.name} must warn that a bare number is an id`);
  }
});

test('get_card takes a ref in any case, an id, or #id', async () => {
  for (const cardId of ['HC-1', 'hc-1', card.id, String(card.id), `#${card.id}`]) {
    const res = await server.tool('get_card', { card_id: cardId });
    assert.equal(res.isError, false, String(res.data));
    assert.equal(res.data.id, card.id);
    assert.ok(Array.isArray(res.data.checklist));
  }
});

test('move, update, checklist, archive and restore take a ref', async () => {
  assert.equal((await server.tool('move_card', { card_id: 'HC-1', column_key: 'doing' })).data.column_key, 'doing');
  assert.equal((await server.tool('update_card', { card_id: 'HC-1', title: 'renamed' })).data.title, 'renamed');
  assert.equal((await server.tool('add_check', { card_id: 'HC-1', text: 'a step' })).isError, false);
  assert.deepEqual((await server.tool('archive_card', { card_id: 'HC-1' })).data, { archived: true });
  assert.equal((await server.tool('restore_card', { card_id: 'HC-1' })).data.ref, 'HC-1');
});

test('every card tool takes the old board ref too, and answers with both refs', async () => {
  // Only the migration writes an old ref; set one as it would.
  sql(dbPath, "UPDATE cards SET legacy_ref = 'MB-7' WHERE id = ?", card.id);
  const read = await server.tool('get_card', { card_id: 'MB-7' });
  assert.equal(read.data.id, card.id);
  assert.deepEqual([read.data.ref, read.data.legacy_ref], ['HC-1', 'MB-7']);
  const moved = await server.tool('move_card', { card_id: 'mb-7', column_key: 'review' });
  assert.deepEqual([moved.data.column_key, moved.data.ref, moved.data.legacy_ref], ['review', 'HC-1', 'MB-7']);
  assert.equal((await server.tool('update_card', { card_id: 'MB-7', flagged: true })).data.flagged, 1);
  const onBoard = (await server.tool('get_board', {})).data.cards.find((c) => c.id === card.id);
  assert.deepEqual([onBoard.ref, onBoard.legacy_ref], ['HC-1', 'MB-7']);
});

test('create_project takes an optional key, and a bad one is a readable error with its code', async () => {
  const made = await server.tool('create_project', { name: 'Caracal', key: 'crc' });
  assert.equal(made.data.key, 'CRC');
  assert.equal((await server.tool('create_card', { project_id: made.data.id, title: 'first' })).data.ref, 'CRC-1');
  const auto = await server.tool('create_project', { name: 'Kigali Irrigation Planner' });
  assert.equal(auto.data.key, 'KIP');
  const taken = await server.tool('create_project', { name: 'Again', key: 'CRC' });
  assert.equal(taken.isError, true);
  assert.match(taken.data, /PND-REF-002/);
  const projects = (await server.tool('get_board', {})).data.projects;
  assert.ok(projects.every((p) => /^[A-Z]{2,5}$/.test(p.key)), 'get_board lists the project keys');
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
