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

/** The Sunday that starts the local week holding t, as YYYY-MM-DD. */
function weekStart(t, tz) {
  const local = new Date(t - tz * 60000);
  local.setUTCDate(local.getUTCDate() - local.getUTCDay());
  return local.toISOString().slice(0, 10);
}
/** The week `n` weeks on from the one starting `start` (back, for negative n). */
const shiftWeeks = (start, n) => new Date(Date.parse(`${start}T00:00:00Z`) + n * 7 * DAY).toISOString().slice(0, 10);

/**
 * The last WEEKS local weeks, oldest first and ending with this one, and a
 * lookup from a row's time to its week's index (undefined outside them).
 */
function calendar(now, tz) {
  const thisWeek = weekStart(now, tz);
  const starts = Array.from({ length: WEEKS }, (_, i) => shiftWeeks(thisWeek, i - (WEEKS - 1)));
  const slot = new Map(starts.map((s, i) => [s, i]));
  return { starts, weekOf: (at) => slot.get(weekStart(ms(at), tz)) };
}

/** The last event that put a card into `col`, by a move or by being made there. */
const lastInto = (events, col) => [...events].reverse()
  .find((e) => e.to_column === col && (e.kind === 'moved' || e.kind === 'created'));

/**
 * Cards added and finished in each week. A card is finished in the week it
 * last moved into Done, so one moved back out stops counting and one archived
 * from Done still counts. A week is estimated when any of its finishes is.
 */
function weekCounts({ starts, weekOf }, cards, history, byCard) {
  const weeks = starts.map((start) => ({ start, added: [], finished: [], estimated: false }));
  for (const e of history) {
    const w = e.kind === 'created' ? weekOf(e.at) : undefined;
    if (w !== undefined) weeks[w].added.push(e.card_id);
  }
  for (const c of cards.filter((x) => x.column_key === 'done')) {
    const finish = lastInto(byCard.get(c.id) ?? [], 'done');
    const w = finish && weekOf(finish.at);
    if (w === undefined) continue;
    weeks[w].finished.push(c.id);
    if (finish.estimated) weeks[w].estimated = true;
  }
  return weeks;
}

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

  // `lastInto` relies on each card's events being in time order.
  const history = db.prepare(
    `SELECT e.id, e.card_id, e.kind, e.from_column, e.to_column, e.actor_kind, e.at, e.estimated
       FROM card_events e JOIN cards c ON c.id = e.card_id JOIN projects p ON p.id = c.project_id
      WHERE p.board_id = ? AND p.archived = 0
      ORDER BY e.card_id, e.at, e.id`
  ).all(boardId);
  const byCard = new Map();
  for (const e of history) byCard.set(e.card_id, [...(byCard.get(e.card_id) ?? []), e]);
  const cal = calendar(now, tz);

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
    weeks: weekCounts(cal, cards, history, byCard),
    time_in_column: {},
    agents: { review_from_agents: [], this_week: [], weeks: [] },
    cards: Object.fromEntries(cards.map((c) => [c.id, {
      id: c.id, ref: c.ref, title: c.title, project_id: c.project_id, column_key: c.column_key,
      flagged: c.flagged, due_date: c.due_date, updated_at: c.updated_at,
      archived: Boolean(c.archived_at), last_actor_kind: c.last_actor_kind,
    }])),
  };
}
