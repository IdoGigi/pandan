/**
 * The dashboard's charts of the board as it stands, all upright and drawn to
 * the width of their panel. The shared parts, and how a click lists the cards
 * behind a bar, are in chartKit.jsx.
 */
import { Bars, ColumnKey, fit, H, hasMedian, PALE, percent, pickable, RTL_FIRST, shortName, TOP } from './chartKit.jsx';

const PROJECT_SLOT = 64; // the narrowest a project's column gets: its bar plus room for a short name
const LETTER = 7; // about one letter of an 11px name, so a slot knows how many fit
const MIN_PART = 3; // the thinnest part of a project's column, so one card beside a hundred can be seen and clicked
const COLUMN_SLOT = 48; // the narrowest a bar gets: room for "Waiting" under it, six to a phone

// The server's five age ranges, in order, calm to warm as cards get older.
const AGES = [
  { name: '< 1 wk', title: 'Open under 1 week', color: 'var(--sky)' },
  { name: '1–2 wk', title: 'Open 1–2 weeks', color: 'var(--lime)' },
  { name: '2–4 wk', title: 'Open 2–4 weeks', color: 'var(--amber)' },
  { name: '1–3 mo', title: 'Open 1–3 months', color: 'var(--rose)' },
  { name: '3+ mo', title: 'Open over 3 months', color: 'var(--flag)' },
];

/** A big number for a list of cards; `sub` says one more thing about it. */
export function Tile({ label, hint, sub, ids, onPick }) {
  return (
    <button className="tile" disabled={!ids.length} title={hint} onClick={() => onPick(label, ids)}>
      <b>{ids.length}</b>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </button>
  );
}

/** Live cards in each column, To do to Done. */
export function BoardNow({ columns, order, labels, width, onPick }) {
  const items = order.map((col) => ({
    key: col, name: labels[col], value: columns[col].length, text: String(columns[col].length),
    color: `var(--pipe-${col})`, title: labels[col], ids: columns[col], pale: PALE.has(col),
  }));
  return <Bars label="Board now" items={items} width={width} minSlot={COLUMN_SLOT} onPick={onPick} />;
}

/** Open cards by how long ago they were made. */
export function AgeBars({ age, width, onPick }) {
  const items = age.map((range, i) => ({
    key: range.from_days, name: AGES[i].name, value: range.ids.length, text: String(range.ids.length),
    color: AGES[i].color, title: AGES[i].title, ids: range.ids,
  }));
  return <Bars label="Age of open work" items={items} width={width} minSlot={COLUMN_SLOT} onPick={onPick} />;
}

/** Median days per column, one upright bar each; a click lists the slowest cards. */
export function MedianColumns({ times, columns, labels, since, width, onPick }) {
  const known = columns.filter((col) => hasMedian(times[col]));
  if (!known.length) {
    return <p className="dash-empty">Collecting since {since ?? 'today'}. Medians appear once cards move between columns.</p>;
  }
  const items = columns.map((col) => {
    const t = times[col];
    const has = hasMedian(t);
    return {
      key: col, name: labels[col], value: t.median_days, text: has ? `${t.median_days}d` : null,
      color: `var(--pipe-${col})`, title: `Longest in ${labels[col]}`, ids: has ? t.longest : [], pale: PALE.has(col),
      notes: Object.fromEntries(t.longest.map((id, k) => [id, `${t.longest_days[k]}d in ${labels[col]}`])),
    };
  });
  return <Bars label="Median days in each column" items={items} width={width} minSlot={COLUMN_SLOT} onPick={onPick} />;
}

/**
 * Each column's part of a project, stacked from the bottom in board order, in
 * pixels above the axis: [from, to). A part with cards is never thinner than
 * MIN_PART; `unit` (pixels a card) leaves room for that, so the tallest stack still fits.
 */
const stack = (project, columns, unit) => columns.reduce((parts, col) => {
  const ids = project.by_column[col];
  const from = parts.at(-1)?.to ?? 0;
  return [...parts, { col, ids, from, to: from + (ids.length ? Math.max(MIN_PART, ids.length * unit) : 0) }];
}, []);

/**
 * One upright column per project: its open work stacked from the bottom, done
 * on top, the total above and the share done under its name.
 */
export function ProjectColumns({ projects, columns, labels, width, onPick }) {
  const totals = projects.map((p) => columns.reduce((n, col) => n + p.by_column[col].length, 0));
  const unit = (H - TOP - MIN_PART * columns.length) / Math.max(1, ...totals);
  const stacks = projects.map((p) => stack(p, columns, unit));
  const { slot, full, bar } = fit(projects.length, width, PROJECT_SLOT);
  const letters = Math.floor(slot / LETTER); // the "…" included
  return (
    <>
      <div className="chart-scroll">
        <svg className="chart" role="group" width={full} height={H + 36} aria-label="Projects">
          <line className="chart-axis" x1={0} x2={full} y1={H} y2={H} />
          {projects.map((p, i) => {
            const mid = slot * (i + 0.5);
            const done = p.by_column.done.length;
            return (
              <g key={p.id}>
                {stacks[i].filter((part) => part.ids.length).map((part) => (
                  // A thin panel-coloured edge keeps neighbouring parts apart; the class goes after the spread.
                  <rect key={part.col} x={mid - bar / 2} y={H - part.to} width={bar} height={part.to - part.from}
                    style={{ fill: `var(--pipe-${part.col})` }}
                    {...pickable(`${labels[part.col]} · ${p.name}`, part.ids, onPick)}
                    className={`pick stack-part${PALE.has(part.col) ? ' pale' : ''}`} />
                ))}
                {totals[i] > 0 && <text className="chart-num" x={mid} y={H - stacks[i].at(-1).to - 5}>{totals[i]}</text>}
                <text className="chart-label" x={mid} y={H + 16} direction={RTL_FIRST.test(p.name) ? 'rtl' : undefined}>
                  {shortName(p.name, letters)}<title>{p.name}</title>
                </text>
                <text className="chart-share" x={mid} y={H + 31}>
                  {totals[i] ? `${percent(done, totals[i])} done` : '—'}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <ColumnKey columns={columns} labels={labels} />
    </>
  );
}
