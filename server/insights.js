/**
 * The dashboard's numbers for one board. Pure reads: cards and their move
 * history in, lists of card ids out — a person clicks a number and sees
 * exactly the cards behind it.
 */
import { db, COLUMNS } from './db.js';

export const QUIET_DAYS = 7;
export const WEEKS = 12;
const OPEN = COLUMNS.filter((c) => c !== 'done');
const IN_FLIGHT = ['doing', 'waiting', 'review'];
const DAY = 86400000;

/** SQLite's UTC text as epoch ms. */
const ms = (text) => Date.parse(`${text.replace(' ', 'T')}Z`);
/** The local calendar date for a browser offset (getTimezoneOffset minutes). */
const localDate = (t, tz) => new Date(t - tz * 60000).toISOString().slice(0, 10);
/** Numbers are lists of ids, so the UI can count them and show the cards behind them. */
const ids = (list) => list.map((c) => c.id);

/**
 * Everything the dashboard shows for one board, or null if there is no such
 * board. `tz` is the browser's getTimezoneOffset(), so "today" and the weeks
 * are the person's own; `now` is there for tests.
 */
export function buildInsights(boardId, { tz = 0, now = Date.now() } = {}) {
  const board = db.prepare('SELECT id, name, key FROM boards WHERE id = ?').get(boardId);
  if (!board) return null;

  const cards = db.prepare(
    `SELECT c.id, b.key || '-' || c.number AS ref, c.title, c.project_id, c.column_key, c.flagged,
            c.due_date, c.updated_at, c.archived_at, c.last_actor_kind
       FROM cards c JOIN projects p ON p.id = c.project_id JOIN boards b ON b.id = p.board_id
      WHERE p.board_id = ? AND p.archived = 0
      ORDER BY c.id`
  ).all(boardId);
  const live = cards.filter((c) => !c.archived_at);
  const open = live.filter((c) => c.column_key !== 'done');
  const today = localDate(now, tz);

  const projects = db.prepare(
    'SELECT id, name, color FROM projects WHERE board_id = ? AND archived = 0 ORDER BY position'
  ).all(boardId).map((p) => ({
    ...p,
    by_column: Object.fromEntries(OPEN.map((col) =>
      [col, ids(open.filter((c) => c.project_id === p.id && c.column_key === col))])),
  }));

  return {
    board,
    quiet_days: QUIET_DAYS,
    history_since: null,
    stuck: {
      waiting: ids(open.filter((c) => c.column_key === 'waiting')),
      flagged: ids(open.filter((c) => c.flagged)),
      overdue: ids(open.filter((c) => c.due_date && c.due_date < today)),
      quiet: ids(open.filter((c) => IN_FLIGHT.includes(c.column_key) && ms(c.updated_at) <= now - QUIET_DAYS * DAY)),
    },
    projects,
    weeks: [],
    time_in_column: {},
    agents: { review_from_agents: [], this_week: [], weeks: [] },
    cards: Object.fromEntries(cards.map((c) => [c.id, {
      id: c.id, ref: c.ref, title: c.title, project_id: c.project_id, column_key: c.column_key,
      flagged: c.flagged, due_date: c.due_date, updated_at: c.updated_at,
      archived: Boolean(c.archived_at), last_actor_kind: c.last_actor_kind,
    }])),
  };
}
