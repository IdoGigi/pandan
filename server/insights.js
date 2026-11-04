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
/** Where each age range starts, in days; it ends where the next one starts. */
const AGE_FROM = [0, 7, 14, 30, 90];
const DAY = 86400000;

/**
 * SQLite's UTC text as epoch ms. It assumes datetime text, `YYYY-MM-DD HH:MM:SS`,
 * which every write path uses: datetime('now'), or a copy of such a value.
 */
const ms = (text) => Date.parse(`${text.replace(' ', 'T')}Z`);
/** The local calendar date for a browser offset (getTimezoneOffset minutes). */
const localDate = (t, tz) => new Date(t - tz * 60000).toISOString().slice(0, 10);
/** Numbers are lists of ids, so the UI can count them and show the cards behind them. */
const ids = (list) => list.map((c) => c.id);
/** Cards split by column, in the order `cols` gives, so the bars match the board. */
const inColumns = (list, cols) =>
  Object.fromEntries(cols.map((col) => [col, ids(list.filter((c) => c.column_key === col))]));

/** The Sunday that starts the local week holding t, as YYYY-MM-DD. */
function weekStart(t, tz) {
  const local = new Date(t - tz * 60000);
  local.setUTCDate(local.getUTCDate() - local.getUTCDay());
  return local.toISOString().slice(0, 10);
}
/** The week `n` weeks on from the one starting `start` (back, for negative n). */
const shiftWeeks = (start, n) => new Date(Date.parse(`${start}T00:00:00Z`) + n * 7 * DAY).toISOString().slice(0, 10);

/**
 * The last WEEKS local weeks, oldest first and ending with this one; `since`,
 * the local midnight they start at, as epoch ms; and a lookup from a row's
 * time to its week's index (undefined outside them). `tz` is the browser's
 * offset today, so near a daylight-saving change an event within an hour of
 * local midnight can land in the neighbouring day — fine for weekly bars.
 */
function calendar(now, tz) {
  const thisWeek = weekStart(now, tz);
  const starts = Array.from({ length: WEEKS }, (_, i) => shiftWeeks(thisWeek, i - (WEEKS - 1)));
  const slot = new Map(starts.map((s, i) => [s, i]));
  return {
    starts,
    since: Date.parse(`${starts[0]}T00:00:00Z`) + tz * 60000,
    weekOf: (at) => slot.get(weekStart(ms(at), tz)),
  };
}

/** The last event that put a card into `col`, by a move or by being made there. */
const lastInto = (events, col) =>
  events.findLast((e) => e.to_column === col && (e.kind === 'moved' || e.kind === 'created'));

/** What needs a look now: waiting, flagged, overdue by the local date, or gone quiet in flight. */
function stuckNow(open, tz, now) {
  const today = localDate(now, tz);
  return {
    waiting: ids(open.filter((c) => c.column_key === 'waiting')),
    flagged: ids(open.filter((c) => c.flagged)),
    overdue: ids(open.filter((c) => c.due_date && c.due_date < today)),
    quiet: ids(open.filter((c) => IN_FLIGHT.includes(c.column_key) && ms(c.updated_at) <= now - QUIET_DAYS * DAY)),
  };
}

/** Each active project, in the board's order, with its open cards by column and then its finished ones. */
function workByProject(boardId, open, done) {
  return db.prepare(
    'SELECT id, name, color FROM projects WHERE board_id = ? AND archived = 0 ORDER BY position'
  ).all(boardId).map((p) => {
    const mine = (list) => list.filter((c) => c.project_id === p.id);
    return { ...p, by_column: { ...inColumns(mine(open), OPEN), done: ids(mine(done)) } };
  });
}

/**
 * Open cards by whole days since they were made, so old work stands out. Each
 * card lands in exactly one range, so the ranges add up to the open total.
 */
function ageOfOpen(open, now) {
  const ranges = AGE_FROM.map((from, i) => ({ from_days: from, to_days: AGE_FROM[i + 1] ?? null, ids: [] }));
  for (const c of open) {
    const days = Math.floor((now - ms(c.created_at)) / DAY);
    ranges.find((r) => r.to_days === null || days < r.to_days).ids.push(c.id);
  }
  return ranges;
}

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
 * The cards an agent touched each week, against the ones you did. Only live
 * rows name who acted, so seeded history never shows up here.
 */
function agentWeeks({ starts, weekOf }, history) {
  const touched = starts.map((start) => ({ start, agent: new Set(), you: new Set() }));
  for (const e of history) {
    const w = !e.estimated && e.actor_kind ? weekOf(e.at) : undefined;
    if (w !== undefined) touched[w][e.actor_kind === 'agent' ? 'agent' : 'you'].add(e.card_id);
  }
  return touched.map((t) => ({ start: t.start, agent: [...t.agent], you: [...t.you] }));
}

/** The middle value, or the mean of the two middle ones. */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Days to one decimal, as the dashboard shows them. */
const tenths = (days) => Math.round(days * 10) / 10;

/**
 * How long cards sat in each open column: from a real move (or creation) into
 * it to the next real move out, for moves out inside the window. A seeded
 * guess never starts or ends a stay, so estimates never become durations. A
 * stay goes on across an archive and restore, but the time put away is left out.
 */
function timeInColumn(byCard, since) {
  const stays = Object.fromEntries(OPEN.map((col) => [col, []]));
  for (const [cardId, events] of byCard) {
    let col = null;
    let entered = null;
    let archivedAt = null;
    for (const e of events) {
      if (e.estimated) { col = null; entered = null; continue; }
      if (e.kind === 'archived') archivedAt = ms(e.at);
      if (e.kind === 'restored') {
        if (col && archivedAt !== null) entered += ms(e.at) - archivedAt;
        archivedAt = null;
      }
      if (e.kind === 'moved' && col && e.from_column === col && ms(e.at) >= since && stays[col]) {
        stays[col].push({ cardId, days: (ms(e.at) - entered) / DAY });
      }
      if (e.kind === 'moved' || (e.kind === 'created' && e.to_column)) {
        col = e.to_column;
        entered = ms(e.at);
      }
    }
  }
  return Object.fromEntries(OPEN.map((col) => {
    const list = stays[col].sort((a, b) => b.days - a.days);
    // Each card once, at its longest stay — the first of its group, as the list is sorted.
    const slowest = [...Map.groupBy(list, (s) => s.cardId).values()].slice(0, 10).map((g) => g[0]);
    return [col, {
      median_days: list.length ? tenths(median(list.map((s) => s.days))) : null,
      moves: list.length,
      longest: slowest.map((s) => s.cardId),
      longest_days: slowest.map((s) => tenths(s.days)),
    }];
  }));
}

/**
 * Everything the dashboard shows for one board, or null if there is no such
 * board. `tz` is the browser's getTimezoneOffset(), so "today" and the weeks
 * are the person's own; `now` is there for tests.
 */
export function buildInsights(boardId, { tz = 0, now = Date.now() } = {}) {
  const board = db.prepare('SELECT id, name, key FROM boards WHERE id = ?').get(boardId);
  if (!board) return null;

  // Both queries leave out shelved (archived) projects, past weeks included, on purpose.
  const cards = db.prepare(
    `SELECT c.id, b.key || '-' || c.number AS ref, c.title, c.project_id, c.column_key, c.flagged,
            c.due_date, c.created_at, c.updated_at, c.archived_at, c.last_actor_kind, c.position
       FROM cards c JOIN projects p ON p.id = c.project_id JOIN boards b ON b.id = p.board_id
      WHERE p.board_id = ? AND p.archived = 0
      ORDER BY c.id`
  ).all(boardId);
  const live = cards.filter((c) => !c.archived_at);
  const open = live.filter((c) => c.column_key !== 'done');
  // Finished work: live Done cards, and ones archived from Done (archiving keeps
  // the column). Cards archived from any other column were dropped, so count nowhere.
  const done = cards.filter((c) => c.column_key === 'done');

  // Each card's events in time order: lastInto and timeInColumn rely on it.
  const history = db.prepare(
    `SELECT e.id, e.card_id, e.kind, e.from_column, e.to_column, e.actor_kind, e.at, e.estimated
       FROM card_events e JOIN cards c ON c.id = e.card_id JOIN projects p ON p.id = c.project_id
      WHERE p.board_id = ? AND p.archived = 0
      ORDER BY e.card_id, e.at, e.id`
  ).all(boardId);
  const byCard = Map.groupBy(history, (e) => e.card_id);
  const cal = calendar(now, tz);
  // Live rows always carry an actor; seeded ones never do (see recordEvent).
  const firstReal = history.filter((e) => !e.estimated && e.actor_kind)
    .reduce((min, e) => (min !== null && min <= e.at ? min : e.at), null);
  const byWho = agentWeeks(cal, history);

  return {
    board,
    quiet_days: QUIET_DAYS,
    history_since: firstReal ? localDate(ms(firstReal), tz) : null,
    stuck: stuckNow(open, tz, now),
    totals: {
      open: ids(open),
      in_progress: ids(open.filter((c) => IN_FLIGHT.includes(c.column_key))),
      done: ids(done),
    },
    columns: inColumns(live, COLUMNS),
    projects: workByProject(boardId, open, done),
    weeks: weekCounts(cal, cards, history, byCard),
    age: ageOfOpen(open, now),
    time_in_column: timeInColumn(byCard, cal.since),
    agents: {
      review_from_agents: ids(live.filter((c) => c.column_key === 'review'
        && lastInto(byCard.get(c.id) ?? [], 'review')?.actor_kind === 'agent')),
      this_week: byWho[WEEKS - 1].agent,
      weeks: byWho,
    },
    cards: Object.fromEntries(cards.map((c) => [c.id, {
      id: c.id, ref: c.ref, title: c.title, project_id: c.project_id, column_key: c.column_key,
      flagged: c.flagged, due_date: c.due_date, created_at: c.created_at, updated_at: c.updated_at,
      archived: Boolean(c.archived_at), last_actor_kind: c.last_actor_kind, position: c.position,
    }])),
  };
}
