import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { COLUMNS } from './db.js';

const COLORS = ['plain', 'lime', 'sky', 'amber', 'rose', 'violet'];

/**
 * The tools call this app's own HTTP API rather than the database, so every
 * validation rule in routes.js applies to an agent exactly as it does to the UI.
 */
async function callApi(method, path, body) {
  const port = process.env.PORT || 3000;
  const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.APP_PASSWORD}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: `Error: ${err.message}` }] });

/** Wraps a tool body so a thrown error comes back as a readable tool error. */
const tool = (fn) => async (args) => {
  try { return ok(await fn(args)); } catch (err) { return fail(err); }
};

const columnField = z.enum(COLUMNS).describe(
  'Which column. "todo" = not started, "next" and "doing" are in progress, ' +
  '"review" = finished but wants a human look, "done" = finished and settled.'
);
const colorField = z.enum(COLORS).describe('Card colour. "plain" is the default grey.');

export function buildMcpServer() {
  const server = new McpServer(
    { name: 'pandan', version: '1.0.0' },
    {
      instructions:
        'Pandan, a personal kanban board. There may be several boards, for example work and ' +
        'personal. On a board, rows are projects and columns are todo, next, doing, review and done. ' +
        'Call get_boards then get_board to see the projects and cards with their ids, then use the other ' +
        'tools with those ids. Cards carry an optional checklist and a flag for anything urgent. ' +
        'When you finish a card, move it to "review" if a person should check your work, or to ' +
        '"done" if it is plainly finished. You are allowed to use either.',
    }
  );

  server.registerTool('get_boards', {
    title: 'List the boards',
    description:
      'List every board with its id, name and how many projects it holds. Someone may keep work ' +
      'and personal on separate boards, so check here first if you are not sure which one a ' +
      'project belongs to.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, tool(() => callApi('GET', '/boards')));

  server.registerTool('create_board', {
    title: 'Add a board',
    description:
      'Add a whole new board, for a separate area of life such as work or personal. Most of the ' +
      'time a new project on an existing board is what is wanted instead — ask before making one.',
    inputSchema: { name: z.string().min(1).describe('What the board is for, e.g. "Work".') },
  }, tool((args) => callApi('POST', '/boards', args)));

  server.registerTool('get_board', {
    title: 'Get one board',
    description:
      'Read every project and card on a board in one call. Returns project ids and names, and each ' +
      'card with its id, project_id, column_key, title, notes, colour, flag and checklist progress. ' +
      'Leave board_id out for the first board. Start here so you have the ids the other tools need.',
    inputSchema: {
      board_id: z.number().int().optional().describe('Which board. Defaults to the first one.'),
    },
    annotations: { readOnlyHint: true },
  }, tool(({ board_id }) => callApi('GET', board_id ? `/board?board_id=${board_id}` : '/board')));

  server.registerTool('get_project', {
    title: 'Read one project',
    description:
      'Everything about a single project: its name and colour, all of its cards, and counts — ' +
      'how many cards sit in each column, how many are flagged, checklist progress, and the ' +
      'percent done. Also returns the project description, repo link, saved links and contacts, ' +
      'and the update log. Use this when you need the detail of one project rather than the whole board.',
    inputSchema: { project_id: z.number().int().describe('Which project to read.') },
    annotations: { readOnlyHint: true },
  }, tool(({ project_id }) => callApi('GET', `/projects/${project_id}`)));

  server.registerTool('create_project', {
    title: 'Add a project',
    description: 'Add a new project, which appears as a new row on the board.',
    inputSchema: {
      name: z.string().min(1).describe('The project name shown on the row.'),
      board_id: z.number().int().optional().describe('Which board. Defaults to the first one.'),
      color: z.string().optional().describe('Optional hex colour for the row dot, like "#4bb3d4".'),
    },
  }, tool((args) => callApi('POST', '/projects', args)));

  server.registerTool('update_project', {
    title: 'Rename or recolour a project',
    description: 'Change a project name or colour, or archive it so it leaves the board.',
    inputSchema: {
      project_id: z.number().int().describe('Which project to change.'),
      name: z.string().min(1).optional().describe('New name.'),
      color: z.string().optional().describe('New hex colour.'),
      description: z.string().optional().describe('Free notes about the project. Replaces what is there.'),
      repo_url: z.string().optional().describe('Link to the code repo, for example a GitHub URL.'),
      board_id: z.number().int().optional().describe('Move the project to a different board.'),
      archived: z.boolean().optional().describe('True hides the project from the board.'),
    },
  }, tool(({ project_id, ...rest }) => callApi('PATCH', `/projects/${project_id}`, rest)));

  server.registerTool('add_project_link', {
    title: 'Add a link or contact to a project',
    description:
      'Attach a named link or a contact to a project. Use kind "link" for a URL such as a repo, ' +
      'dashboard or doc, and kind "contact" for a person, an email or a phone number.',
    inputSchema: {
      project_id: z.number().int().describe('Which project to attach it to.'),
      kind: z.enum(['link', 'contact']).describe('"link" for a URL, "contact" for a person.'),
      label: z.string().min(1).describe('Short name, for example "Staging" or "Dana".'),
      value: z.string().min(1).describe('The URL, email or phone number.'),
    },
  }, tool(({ project_id, ...rest }) => callApi('POST', `/projects/${project_id}/links`, rest)));

  server.registerTool('delete_project_link', {
    title: 'Remove a link or contact',
    description: 'Remove one link or contact from a project. Get its id from get_project.',
    inputSchema: { link_id: z.number().int().describe('Which link or contact to remove.') },
    annotations: { destructiveHint: true },
  }, tool(({ link_id }) => callApi('DELETE', `/links/${link_id}`)));

  server.registerTool('add_project_update', {
    title: 'Write a project update',
    description:
      'Add a dated entry to the project update log — a short note about what happened or changed. ' +
      'The log is the project history, newest first. Good for recording progress after doing work.',
    inputSchema: {
      project_id: z.number().int().describe('Which project the update belongs to.'),
      text: z.string().min(1).describe('What happened, in a sentence or two.'),
    },
  }, tool(({ project_id, text }) => callApi('POST', `/projects/${project_id}/updates`, { text })));

  server.registerTool('create_card', {
    title: 'Add a card',
    description:
      'Add a card to a project. Goes to the "todo" column unless you say otherwise, and lands at ' +
      'the bottom of that column.',
    inputSchema: {
      project_id: z.number().int().describe('Which project the card belongs to. Get this from get_board.'),
      title: z.string().min(1).describe('The card text shown on the board.'),
      column_key: columnField.optional(),
      notes: z.string().optional().describe('Longer notes, only visible when the card is opened.'),
      color: colorField.optional(),
      flagged: z.boolean().optional().describe('True puts a small red dot on the card.'),
    },
  }, tool((args) => callApi('POST', '/cards', args)));

  server.registerTool('get_card', {
    title: 'Read one card',
    description: 'Read a single card in full, including its checklist items and their ids.',
    inputSchema: { card_id: z.number().int().describe('Which card to read.') },
    annotations: { readOnlyHint: true },
  }, tool(({ card_id }) => callApi('GET', `/cards/${card_id}`)));

  server.registerTool('update_card', {
    title: 'Edit a card',
    description:
      'Change any part of a card: its text, notes, colour, flag, or which project and column it ' +
      'sits in. To only reorder or move a card, prefer move_card.',
    inputSchema: {
      card_id: z.number().int().describe('Which card to change.'),
      title: z.string().min(1).optional().describe('New card text.'),
      notes: z.string().optional().describe('New notes.'),
      column_key: columnField.optional(),
      project_id: z.number().int().optional().describe('Move the card to a different project.'),
      color: colorField.optional(),
      flagged: z.boolean().optional().describe('True puts a small red dot on the card.'),
    },
  }, tool(({ card_id, ...rest }) => callApi('PATCH', `/cards/${card_id}`, rest)));

  server.registerTool('move_card', {
    title: 'Move a card',
    description:
      'Move a card to another column or project, and choose where in the list it lands. ' +
      'Use index 0 for the top; leave index out to drop it at the bottom. ' +
      'This is the tool to use when work changes state. When you finish something, move it to ' +
      '"review" if a person should check it first, or "done" if it needs no checking.',
    inputSchema: {
      card_id: z.number().int().describe('Which card to move.'),
      column_key: columnField.optional(),
      project_id: z.number().int().optional().describe('Move it to a different project too.'),
      index: z.number().int().min(0).optional().describe('Slot in the target list. 0 is the top.'),
    },
  }, tool(({ card_id, ...rest }) => callApi('POST', `/cards/${card_id}/move`, rest)));

  server.registerTool('delete_card', {
    title: 'Delete a card',
    description: 'Delete a card for good. This cannot be undone, so check the title first.',
    inputSchema: { card_id: z.number().int().describe('Which card to delete.') },
    annotations: { destructiveHint: true },
  }, tool(({ card_id }) => callApi('DELETE', `/cards/${card_id}`)));

  server.registerTool('add_check', {
    title: 'Add a checklist item',
    description: 'Add one checklist item to a card. The board shows progress as done/total.',
    inputSchema: {
      card_id: z.number().int().describe('Which card to add the item to.'),
      text: z.string().min(1).describe('The checklist item text.'),
    },
  }, tool(({ card_id, text }) => callApi('POST', `/cards/${card_id}/checks`, { text })));

  server.registerTool('update_check', {
    title: 'Tick or edit a checklist item',
    description: 'Tick, untick, or reword a checklist item. Get item ids from get_card.',
    inputSchema: {
      check_id: z.number().int().describe('Which checklist item. Comes from get_card.'),
      done: z.boolean().optional().describe('True ticks the item.'),
      text: z.string().min(1).optional().describe('New text for the item.'),
    },
  }, tool(({ check_id, ...rest }) => callApi('PATCH', `/checks/${check_id}`, rest)));

  return server;
}

/**
 * Stateless handler: a fresh server and transport per request, so there are no
 * sessions to keep alive and a plain JSON reply comes back.
 */
export async function handleMcpRequest(req, res) {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
