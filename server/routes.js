import { Router } from 'express';
import { db, COLUMNS, nextPosition } from './db.js';

export const api = Router();

const bad = (res, msg) => res.status(400).json({ error: msg });
const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const NOW = "datetime('now')";

/* ---------------- board ---------------- */

/** Everything the UI needs in one round trip. */
api.get('/board', (req, res) => {
  const projects = db.prepare(
    'SELECT id, name, color, position, archived FROM projects WHERE archived = 0 ORDER BY position'
  ).all();
  const cards = db.prepare(
    `SELECT c.id, c.project_id, c.column_key, c.title, c.notes, c.color, c.flagged, c.position,
            (SELECT COUNT(*) FROM checks k WHERE k.card_id = c.id)                AS checks_total,
            (SELECT COUNT(*) FROM checks k WHERE k.card_id = c.id AND k.done = 1) AS checks_done
       FROM cards c
       JOIN projects p ON p.id = c.project_id
      WHERE p.archived = 0
      ORDER BY c.position`
  ).all();
  res.json({ columns: COLUMNS, projects, cards });
});

/* ---------------- projects ---------------- */

api.get('/projects', (req, res) => {
  res.json(db.prepare('SELECT * FROM projects WHERE archived = 0 ORDER BY position').all());
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

  const open = cards.length - by_column.done;
  res.json({
    ...project,
    cards,
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
  const position = nextPosition('projects', 'archived = 0', []);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO projects (name, color, position) VALUES (?, ?, ?)')
    .run(name, color, position);
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
  db.prepare('UPDATE projects SET name = ?, color = ?, position = ?, archived = ? WHERE id = ?')
    .run(name, color, position, archived, row.id);
  res.json(db.prepare('SELECT * FROM projects WHERE id = ?').get(row.id));
});

api.delete('/projects/:id', (req, res) => {
  const info = db.prepare('DELETE FROM projects WHERE id = ?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'project not found' });
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
