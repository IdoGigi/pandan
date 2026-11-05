import { useId } from 'react';
import { ago, CardRow, daysSince } from './CardRow.jsx';
import { QuickAdd } from './QuickAdd.jsx';

const SHOWN = 8; // a longer list shows this many, and "All N" opens the rest in the card list
const PICKS = 5; // Up next and Oldest open show this many

const untouchedFirst = (a, b) => a.updated_at.localeCompare(b.updated_at);
const WORKING = ['doing', 'review'];

/**
 * Sorts the open cards into the four lists. Each card goes to the first list
 * that claims it, in this order: Needs attention, Working on, Up next, Oldest
 * open. Up next and Oldest open claim only the five they show.
 */
function placeCards({ stuck, columns, totals, cards, projects }) {
  // The live cards among `ids` that no earlier list has taken, each once.
  const unclaimed = (ids, taken) => [...new Set(ids)].filter((id) => !taken.has(id))
    .map((id) => cards[id]).filter((c) => c && !c.archived);

  const attention = unclaimed([...stuck.waiting, ...stuck.flagged, ...stuck.overdue, ...stuck.quiet], new Set())
    .sort(untouchedFirst);
  const taken = new Set(attention.map((c) => c.id));

  const workingOn = unclaimed(WORKING.flatMap((col) => columns[col]), taken)
    .sort((a, b) => WORKING.indexOf(a.column_key) - WORKING.indexOf(b.column_key) || untouchedFirst(a, b));
  const taken2 = new Set([...taken, ...workingOn.map((c) => c.id)]);

  // Board order: the projects as the board lists them, then each card's place in its column.
  const rank = new Map(projects.map((p, i) => [p.id, i]));
  const upNext = unclaimed(columns.next, taken2)
    .sort((a, b) => (rank.get(a.project_id) ?? Infinity) - (rank.get(b.project_id) ?? Infinity) || a.position - b.position)
    .slice(0, PICKS);
  const taken3 = new Set([...taken2, ...upNext.map((c) => c.id)]);

  const oldest = unclaimed(totals.open, taken3)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, PICKS);

  return { attention, workingOn, upNext, oldest };
}

/** One small tag per reason a card needs attention. */
function reasons(card, stuck) {
  return [
    stuck.waiting.includes(card.id) && { key: 'waiting', text: '⏸ waiting' },
    stuck.flagged.includes(card.id) && { key: 'flagged', text: '⚑ flagged' },
    stuck.overdue.includes(card.id) && { key: 'overdue', text: 'overdue' },
    stuck.quiet.includes(card.id) && { key: 'quiet', text: `quiet ${daysSince(card.updated_at)}d` },
  ].filter(Boolean);
}

/** A titled list of card rows; an empty one says so instead of hiding. */
function CardList({ title, empty, rows, row, onPick }) {
  const head = useId();
  return (
    <section className="dash-block" aria-labelledby={head}>
      {/* The name is the title alone; the count beside it would read "Working on3". */}
      <h3><span id={head}>{title}</span>{rows.length > 0 && <span className="list-count">{rows.length}</span>}</h3>
      {rows.length === 0 ? <p className="dash-empty">{empty}</p> : (
        <>
          <ul className="card-list">
            {rows.slice(0, SHOWN).map((r) => (
              <CardRow key={r.card.id} {...r} color={row.colorOf[r.card.project_id]}
                onOpenCard={row.onOpenCard} onChanged={row.onChanged} onError={row.onError} />
            ))}
          </ul>
          {rows.length > SHOWN && (
            <button type="button" className="btn btn-xs list-all" aria-label={`All ${rows.length} in ${title}`}
              onClick={() => onPick(title, rows.map((r) => r.card.id))}>
              All {rows.length}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The left half of the dashboard: the cards to act on, each in one list, with
 * quick actions on every row, and a line to add new ones.
 */
export function Control({ data, onPick, onOpenCard, onChanged, onError }) {
  const { attention, workingOn, upNext, oldest } = placeCards(data);
  const row = { colorOf: Object.fromEntries(data.projects.map((p) => [p.id, p.color])), onOpenCard, onChanged, onError };
  return (
    <section className="dash-half dash-control" aria-labelledby="dash-control-head">
      <h2 id="dash-control-head">Control</h2>
      <QuickAdd boardId={data.board.id} projects={data.projects} onAdded={onChanged} onError={onError} />
      {/* Not "In progress": the board's In progress group and the Active number each mean other columns. */}
      <CardList title="Working on" empty="Nothing else in Doing or Review" row={row} onPick={onPick}
        rows={workingOn.map((card) => ({ card }))} />
      <CardList title="Needs attention" empty="Nothing flagged, waiting, overdue or quiet" row={row} onPick={onPick}
        rows={attention.map((card) => ({ card, tags: reasons(card, data.stuck) }))} />
      <CardList title="Up next" empty="Next is empty" row={row} onPick={onPick}
        rows={upNext.map((card) => ({ card, start: true }))} />
      <CardList title="Oldest open" empty="Nothing else open" row={row} onPick={onPick}
        rows={oldest.map((card) => ({ card, note: ago(card.created_at, true) }))} />
    </section>
  );
}
