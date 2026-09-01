import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, COLUMNS, LINK_KINDS, nextPosition, safeUrl, defaultBoardId } from './db.js';
import { createToken, requireOwner } from './auth.js';

export const api = Router();

const bad = (res, msg) => res.status(400).json({ error: msg });
const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const NOW = "datetime('now')";

/* ---------------- agent tokens ---------------- */

// requireOwner on every one of these: an agent token can use the board, but it
// can never see, create or revoke tokens — including its own.
api.get('/tokens', requireOwner, (req, res) => {
  res.json(db.prepare(
    `SELECT id, name, prefix, created_at, last_used_at, revoked_at
       FROM tokens ORDER BY revoked_at IS NOT NULL, id DESC`
  ).all());
});

api.post('/tokens', requireOwner, (req, res) => {
  const name = clean(req.body?.name, 60);
  if (!name) return bad(res, 'name is required');
  const { id, token } = createToken(name);
  const row = db.prepare('SELECT id, name, prefix, created_at FROM tokens WHERE id = ?').get(id);
  // `token` is returned once and never again — only its hash is kept.
  res.status(201).json({ ...row, token });
});

api.delete('/tokens/:id', requireOwner, (req, res) => {
  const info = db
    .prepare("UPDATE tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL")
    .run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'no live token with that id' });
  res.json({ revoked: true });
});

/* ---------------- about ---------------- */

// Read once at start. The About panel shows this, so it cannot drift from
// what is actually installed.
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
);
const repo = String(pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '');
const published = repo && !repo.includes('YOUR-NAME');

api.get('/about', (req, res) => {
  res.json({
    name: 'Pandan',
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    node: process.version,
    repo: published ? repo : null,
    issues: published ? `${repo}/issues` : null,
    contributing: published ? `${repo}/blob/main/CONTRIBUTING.md` : null,
    columns: COLUMNS,
    actor: req.actor || null,
    counts: {
      boards: db.prepare('SELECT COUNT(*) AS n FROM boards').get().n,
      projects: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE archived = 0').get().n,
      cards: db.prepare('SELECT COUNT(*) AS n FROM cards').get().n,
    },
  });
});

/* ---------------- boards ---------------- */

api.get('/boards', (req, res) => {
  res.json(db.prepare(
    `SELECT b.id, b.name, b.position, b.created_at,
            (SELECT COUNT(*) FROM projects p WHERE p.board_id = b.id AND p.archived = 0) AS projects
       FROM boards b ORDER BY b.position, b.id`
  ).all());
});

api.post('/boards', (req, res) => {
  const name = clean(req.body?.name, 120);
  if (!name) return bad(res, 'name is required');
  const position = nextPosition('boards', '1 = 1', []);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO boards (name, position) VALUES (?, ?)').run(name, position);
  res.status(201).json(db.prepare('SELECT * FROM boards WHERE id = ?').get(lastInsertRowid));
});

api.patch('/boards/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM boards WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'board not found' });
  const name = req.body?.name === undefined ? row.name : clean(req.body.name, 120);
  if (!name) return bad(res, 'name cannot be empty');
  const position = req.body?.position === undefined ? row.position : Number(req.body.position);
  db.prepare('UPDATE boards SET name = ?, position = ? WHERE id = ?').run(name, position, row.id);
  res.json(db.prepare('SELECT * FROM boards WHERE id = ?').get(row.id));
});

api.delete('/boards/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM boards WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'board not found' });
  }
  // There must always be somewhere for projects to live.
  if (db.prepare('SELECT COUNT(*) AS n FROM boards').get().n <= 1) {
    return bad(res, 'this is your only board, so it cannot be deleted');
  }
  db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  res.json({ deleted: true });
});

/* ---------------- board contents ---------------- */

/** Everything the UI needs for one board in one round trip. */
api.get('/board', (req, res) => {
  const boardId = req.query.board_id ? Number(req.query.board_id) : defaultBoardId();
  const board = db.prepare('SELECT id, name FROM boards WHERE id = ?').get(boardId);
  if (!board) return res.status(404).json({ error: 'board not found' });

  const projects = db.prepare(
    `SELECT id, name, color, position, archived FROM projects
      WHERE archived = 0 AND board_id = ? ORDER BY position`
  ).all(board.id);
  const cards = db.prepare(
    `SELECT c.id, c.project_id, c.column_key, c.title, c.notes, c.color, c.flagged, c.position,
            (SELECT COUNT(*) FROM checks k WHERE k.card_id = c.id)                AS checks_total,
            (SELECT COUNT(*) FROM checks k WHERE k.card_id = c.id AND k.done = 1) AS checks_done
       FROM cards c
       JOIN projects p ON p.id = c.project_id
      WHERE p.archived = 0 AND p.board_id = ?
      ORDER BY c.position`
  ).all(board.id);

  res.json({ columns: COLUMNS, board, projects, cards });
});

/* ---------------- projects ---------------- */

api.get('/projects', (req, res) => {
  const boardId = req.query.board_id ? Number(req.query.board_id) : null;
  res.json(boardId
    ? db.prepare('SELECT * FROM projects WHERE archived = 0 AND board_id = ? ORDER BY position').all(boardId)
    : db.prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY position').all());
});

/** Everything about one project: its details, its cards, and a few counts. */
api.get('/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
  if (!project) return res.status(404).json({ error: 'project not found' });

  const cards = db.prepare(
    `SELECT c.id, c.column_key, c.title, c.notes, c.color, c.flagged, c.position,
            c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM checks k WHERE k.card_id = c.id)                AS checks_total,
            (SELECT COUNT(*) FROM checks k WHERE k.card_id = c.id AND k.done = 1) AS checks_done
       FROM cards c
      WHERE c.project_id = ?
      ORDER BY c.position`
  ).all(project.id);

  const by_column = Object.fromEntries(COLUMNS.map((k) => [k, 0]));
  let flagged = 0;
  let checks_total = 0;
  let checks_done = 0;
  for (const card of cards) {
    by_column[card.column_key] += 1;
    if (card.flagged) flagged += 1;
    checks_total += card.checks_total;
    checks_done += card.checks_done;
  }

  const links = db.prepare(
    'SELECT id, kind, label, value, position FROM project_links WHERE project_id = ? ORDER BY kind, position'
  ).all(project.id).map((l) => ({ ...l, href: safeUrl(l.value) }));

  const updates = db.prepare(
    'SELECT id, text, created_at FROM project_updates WHERE project_id = ? ORDER BY id DESC LIMIT 50'
  ).all(project.id);

  const open = cards.length - by_column.done;
  res.json({
    ...project,
    cards,
    links: links.filter((l) => l.kind === 'link'),
    contacts: links.filter((l) => l.kind === 'contact'),
    updates,
    stats: {
      total: cards.length,
      open,
      by_column,
      flagged,
      checks_total,
      checks_done,
      percent_done: cards.length ? Math.round((by_column.done / cards.length) * 100) : 0,
      last_activity: cards.reduce((max, c) => (c.updated_at > max ? c.updated_at : max), project.created_at),
    },
  });
});

api.post('/projects', (req, res) => {
  const name = clean(req.body?.name, 120);
  if (!name) return bad(res, 'name is required');
  const color = clean(req.body?.color, 20) || '#94a3b8';
  const boardId = req.body?.board_id ? Number(req.body.board_id) : defaultBoardId();
  if (!db.prepare('SELECT id FROM boards WHERE id = ?').get(boardId)) {
    return bad(res, 'board_id must be an existing board');
  }
  const position = nextPosition('projects', 'archived = 0 AND board_id = ?', [boardId]);
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO projects (board_id, name, color, position, description, repo_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(boardId, name, color, position, clean(req.body?.description, 5000), clean(req.body?.repo_url, 500));
  res.status(201).json(db.prepare('SELECT * FROM projects WHERE id = ?').get(lastInsertRowid));
});

api.patch('/projects/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'project not found' });
  const name = req.body?.name === undefined ? row.name : clean(req.body.name, 120);
  if (!name) return bad(res, 'name cannot be empty');
  const color = req.body?.color === undefined ? row.color : clean(req.body.color, 20);
  const position = req.body?.position === undefined ? row.position : Number(req.body.position);
  const archived = req.body?.archived === undefined ? row.archived : (req.body.archived ? 1 : 0);
  if (req.body?.board_id !== undefined &&
      !db.prepare('SELECT id FROM boards WHERE id = ?').get(Number(req.body.board_id))) {
    return bad(res, 'board_id must be an existing board');
  }
  const boardId = req.body?.board_id === undefined ? row.board_id : Number(req.body.board_id);
  const description = req.body?.description === undefined ? row.description : clean(req.body.description, 5000);
  const repoUrl = req.body?.repo_url === undefined ? row.repo_url : clean(req.body.repo_url, 500);
  db.prepare(
    `UPDATE projects SET name=?, color=?, position=?, archived=?, description=?, repo_url=?, board_id=?
      WHERE id=?`
  ).run(name, color, position, archived, description, repoUrl, boardId, row.id);
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(row.id));
});

api.delete('/projects/:id', (req, res) => {
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'project not found' });
  res.json({ deleted: true });
});

/* ---------------- project links and contacts ---------------- */

/** A link and a contact are the same row shape; `kind` tells them apart. */
api.post('/projects/:id/links', (req, res) => {
  const projectId = Number(req.params.id);
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    return res.status(404).json({ error: 'project not found' });
  }
  const kind = clean(req.body?.kind, 20) || 'link';
  if (!LINK_KINDS.includes(kind)) return bad(res, `kind must be one of: ${LINK_KINDS.join(', ')}`);
  const label = clean(req.body?.label, 120);
  const value = clean(req.body?.value, 500);
  if (!label) return bad(res, 'label is required');
  if (!value) return bad(res, 'value is required');

  const position = nextPosition('project_links', 'project_id = ? AND kind = ?', [projectId, kind]);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO project_links (project_id, kind, label, value, position) VALUES (?,?,?,?,?)')
    .run(projectId, kind, label, value, position);
  const row = db.prepare('SELECT id, kind, label, value, position FROM project_links WHERE id = ?')
    .get(lastInsertRowid);
  res.status(201).json({ ...row, href: safeUrl(row.value) });
});

api.patch('/links/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM project_links WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'link not found' });
  const label = req.body?.label === undefined ? row.label : clean(req.body.label, 120);
  const value = req.body?.value === undefined ? row.value : clean(req.body.value, 500);
  if (!label) return bad(res, 'label cannot be empty');
  if (!value) return bad(res, 'value cannot be empty');
  db.prepare('UPDATE project_links SET label = ?, value = ? WHERE id = ?').run(label, value, row.id);
  const updated = db.prepare('SELECT id, kind, label, value, position FROM project_links WHERE id = ?')
    .get(row.id);
  res.json({ ...updated, href: safeUrl(updated.value) });
});

api.delete('/links/:id', (req, res) => {
  const info = db.prepare('DELETE FROM project_links WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'link not found' });
  res.json({ deleted: true });
});

/* ---------------- project update log ---------------- */

api.post('/projects/:id/updates', (req, res) => {
  const projectId = Number(req.params.id);
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    return res.status(404).json({ error: 'project not found' });
  }
  const text = clean(req.body?.text, 2000);
  if (!text) return bad(res, 'text is required');
  const { lastInsertRowid } = db
    .prepare('INSERT INTO project_updates (project_id, text) VALUES (?, ?)')
    .run(projectId, text);
  res.status(201).json(
    db.prepare('SELECT id, text, created_at FROM project_updates WHERE id = ?').get(lastInsertRowid)
  );
});

api.delete('/updates/:id', (req, res) => {
  const info = db.prepare('DELETE FROM project_updates WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'update not found' });
  res.json({ deleted: true });
});

/* ---------------- cards ---------------- */

api.get('/cards', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.project_id) {
    where.push('c.project_id = ?');
    params.push(Number(req.query.project_id));
  }
  if (req.query.column) {
    where.push('c.column_key = ?');
    params.push(clean(req.query.column, 20));
  }
  const filter = where.length ? `AND ${where.join(' AND ')}` : '';
  res.json(db.prepare(
    `SELECT c.* FROM cards c
       JOIN projects p ON p.id = c.project_id
      WHERE p.archived = 0 ${filter}
      ORDER BY c.position`
  ).all(...params));
});

api.get('/cards/:id', (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'card not found' });
  card.checklist = db
    .prepare('SELECT id, text, done, position FROM checks WHERE card_id = ? ORDER BY position')
    .all(card.id);
  res.json(card);
});

api.post('/cards', (req, res) => {
  const title = clean(req.body?.title, 300);
  if (!title) return bad(res, 'title is required');

  const projectId = Number(req.body?.project_id);
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    return bad(res, 'project_id must be an existing project');
  }
  const column = clean(req.body?.column_key, 20) || 'todo';
  if (!COLUMNS.includes(column)) return bad(res, `column_key must be one of: ${COLUMNS.join(', ')}`);

  const position = nextPosition('cards', 'project_id = ? AND column_key = ?', [projectId, column]);
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO cards (project_id, column_key, title, notes, color, flagged, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    projectId, column, title,
    clean(req.body?.notes, 4000),
    clean(req.body?.color, 20) || 'plain',
    req.body?.flagged ? 1 : 0,
    position
  );
  res.status(201).json(db.prepare('SELECT * FROM cards WHERE id = ?').get(lastInsertRowid));
});

api.patch('/cards/:id', (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'card not found' });
  const b = req.body || {};

  if (b.column_key !== undefined && !COLUMNS.includes(b.column_key)) {
    return bad(res, `column_key must be one of: ${COLUMNS.join(', ')}`);
  }
  if (b.project_id !== undefined &&
      !db.prepare('SELECT id FROM projects WHERE id = ?').get(Number(b.project_id))) {
    return bad(res, 'project_id must be an existing project');
  }

  const title = b.title === undefined ? card.title : clean(b.title, 300);
  if (!title) return bad(res, 'title cannot be empty');

  const projectId = b.project_id === undefined ? card.project_id : Number(b.project_id);
  const column = b.column_key === undefined ? card.column_key : b.column_key;

  // Moved to another list with no slot given? Drop it at the end of that list.
  const movedList = projectId !== card.project_id || column !== card.column_key;
  const position =
    b.position !== undefined ? Number(b.position)
    : movedList ? nextPosition('cards', 'project_id = ? AND column_key = ?', [projectId, column])
    : card.position;

  db.prepare(
    `UPDATE cards
        SET project_id = ?, column_key = ?, title = ?, notes = ?, color = ?, flagged = ?,
            position = ?, updated_at = ${NOW}
      WHERE id = ?`
  ).run(
    projectId, column, title,
    b.notes === undefined ? card.notes : clean(b.notes, 4000),
    b.color === undefined ? card.color : clean(b.color, 20),
    b.flagged === undefined ? card.flagged : (b.flagged ? 1 : 0),
    position, card.id
  );
  res.json(db.prepare('SELECT * FROM cards WHERE id = ?').get(card.id));
});

/** Drop a card into a list at a slot index — easier for an agent than picking positions. */
api.post('/cards/:id/move', (req, res) => {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(Number(req.params.id));
  if (!card) return res.status(404).json({ error: 'card not found' });

  const column = req.body?.column_key === undefined ? card.column_key : clean(req.body.column_key, 20);
  if (!COLUMNS.includes(column)) return bad(res, `column_key must be one of: ${COLUMNS.join(', ')}`);

  const projectId = req.body?.project_id === undefined ? card.project_id : Number(req.body.project_id);
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
    return bad(res, 'project_id must be an existing project');
  }

  const siblings = db.prepare(
    'SELECT id, position FROM cards WHERE project_id = ? AND column_key = ? AND id <> ? ORDER BY position'
  ).all(projectId, column, card.id);

  const raw = req.body?.index;
  const index = raw === undefined
    ? siblings.length
    : Math.max(0, Math.min(siblings.length, Number(raw)));

  const before = siblings[index - 1]?.position;
  const after = siblings[index]?.position;
  const position =
    before === undefined && after === undefined ? 1000
    : before === undefined ? after - 1000
    : after === undefined ? before + 1000
    : (before + after) / 2;

  db.prepare(
    `UPDATE cards SET project_id = ?, column_key = ?, position = ?, updated_at = ${NOW} WHERE id = ?`
  ).run(projectId, column, position, card.id);
  res.json(db.prepare('SELECT * FROM cards WHERE id = ?').get(card.id));
});

api.delete('/cards/:id', (req, res) => {
  const info = db.prepare('DELETE FROM cards WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'card not found' });
  res.json({ deleted: true });
});

/* ---------------- checklist ---------------- */

api.post('/cards/:id/checks', (req, res) => {
  const cardId = Number(req.params.id);
  if (!db.prepare('SELECT id FROM cards WHERE id = ?').get(cardId)) {
    return res.status(404).json({ error: 'card not found' });
  }
  const text = clean(req.body?.text, 300);
  if (!text) return bad(res, 'text is required');
  const position = nextPosition('checks', 'card_id = ?', [cardId]);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO checks (card_id, text, done, position) VALUES (?, ?, ?, ?)')
    .run(cardId, text, req.body?.done ? 1 : 0, position);
  res.status(201).json(db.prepare('SELECT * FROM checks WHERE id = ?').get(lastInsertRowid));
});

api.patch('/checks/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM checks WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'check not found' });
  const text = req.body?.text === undefined ? row.text : clean(req.body.text, 300);
  if (!text) return bad(res, 'text cannot be empty');
  const done = req.body?.done === undefined ? row.done : (req.body.done ? 1 : 0);
  db.prepare('UPDATE checks SET text = ?, done = ? WHERE id = ?').run(text, done, row.id);
  res.json(db.prepare('SELECT * FROM checks WHERE id = ?').get(row.id));
});

api.delete('/checks/:id', (req, res) => {
  const info = db.prepare('DELETE FROM checks WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'check not found' });
  res.json({ deleted: true });
});
