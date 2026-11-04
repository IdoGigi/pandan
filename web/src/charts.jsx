/**
 * Small hand-drawn charts for the dashboard — all upright, no library. Every
 * part a person can click is a button: it calls onPick(title, ids) with the
 * cards behind it, and says how many in its label for a screen reader. Each
 * chart is a labelled group, so a screen reader names it too.
 */
import { useEffect, useRef } from 'react';

const H = 160;
const TOP = 16;
const BAR = 40;
const GAP = 16;
const MIN_BAR = 4; // the shortest bar drawn, so one that rounds to 0 can still be seen and clicked
const SLOT = 72; // each project's share of "Open work by project": its bar plus room for the name
const NAME_MAX = 10; // about as many letters as fit in a slot at 11px, the "…" included
// A name whose first letter is Hebrew or Arabic reads right to left, as dir="auto" decides elsewhere.
const RTL_FIRST = /^[^\p{L}]*[\u0590-\u08FF]/u;

const plural = (n) => `${n} card${n === 1 ? '' : 's'}`;
const shortName = (name, max = NAME_MAX) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);
const weekLabel = (start) => new Date(`${start}T00:00:00Z`)
  .toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A chart of weeks opens on the latest ones, at its right end, however narrow the screen. */
function useLatestInView(weeks) {
  const box = useRef(null);
  useEffect(() => {
    if (box.current) box.current.scrollLeft = box.current.scrollWidth;
  }, [weeks]);
  return box;
}

/** Props that make an SVG shape a button for `ids`. Empty ones are not clickable. */
function pickable(title, ids, onPick, notes) {
  const go = () => { if (ids.length) onPick(title, ids, notes); };
  return {
    className: 'pick',
    role: 'button',
    tabIndex: ids.length ? 0 : -1,
    'aria-label': `${title} · ${plural(ids.length)}`,
    onClick: go,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    },
  };
}

/** A big number for a list of cards. */
export function Tile({ label, hint, ids, onPick }) {
  return (
    <button className="tile" disabled={!ids.length} title={hint} onClick={() => onPick(label, ids)}>
      <b>{ids.length}</b>
      <span>{label}</span>
    </button>
  );
}

/** One upright column per project, stacked by board column. */
export function StackedColumns({ projects, columns, labels, onPick }) {
  const totals = projects.map((p) => columns.reduce((n, col) => n + p.by_column[col].length, 0));
  const max = Math.max(1, ...totals);
  const y = (n) => H - (n / max) * (H - TOP);
  const width = projects.length * SLOT;
  return (
    <>
      <div className="chart-scroll">
        <svg className="chart" role="group" width={width} height={H + 30} aria-label="Open work by project">
          <line className="chart-axis" x1={0} x2={width} y1={H} y2={H} />
          {projects.map((p, i) => {
            const x = i * SLOT + (SLOT - BAR) / 2;
            let below = 0;
            return (
              <g key={p.id}>
                {columns.map((col) => {
                  const list = p.by_column[col];
                  if (!list.length) return null;
                  const top = y(below + list.length);
                  const height = y(below) - top;
                  below += list.length;
                  return (
                    // A thin panel-coloured edge keeps neighbouring parts apart; the class goes after the spread.
                    <rect key={col} x={x} y={top} width={BAR} height={height}
                      style={{ fill: `var(--pipe-${col})` }} {...pickable(`${labels[col]} · ${p.name}`, list, onPick)}
                      className="pick stack-part" />
                  );
                })}
                {totals[i] > 0 && <text className="chart-num" x={x + BAR / 2} y={y(totals[i]) - 4}>{totals[i]}</text>}
                <text className="chart-label" x={x + BAR / 2} y={H + 16}
                  direction={RTL_FIRST.test(p.name) ? 'rtl' : undefined}>
                  {shortName(p.name)}<title>{p.name}</title>
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

/** Which blue is which column, under the stacked columns. */
function ColumnKey({ columns, labels }) {
  return (
    <div className="chart-legend">
      {columns.map((col) => (
        <span key={col}><i className={`pipe-dot pipe-${col}`} />{labels[col]}</span>
      ))}
    </div>
  );
}

/** Finished per week as bars, added per week as a line. Estimated weeks are lighter. */
export function WeekBars({ weeks, onPick }) {
  const scroller = useLatestInView(weeks);
  if (weeks.every((w) => !w.finished.length && !w.added.length)) {
    return <p className="dash-empty">Nothing added or finished in the last {weeks.length} weeks.</p>;
  }
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.finished.length, w.added.length)));
  const y = (n) => H - (n / max) * (H - TOP);
  const mid = (i) => GAP + i * (BAR + GAP) + BAR / 2;
  const width = GAP + weeks.length * (BAR + GAP);
  return (
    <>
      <div className="chart-scroll" ref={scroller}>
        <svg className="chart" role="group" width={width} height={H + 30} aria-label="Finished and added per week">
          <line className="chart-axis" x1={0} x2={width} y1={H} y2={H} />
          {weeks.map((w, i) => (
            <g key={w.start}>
              {w.finished.length > 0 && (
                <rect x={mid(i) - BAR / 2} y={y(w.finished.length)} width={BAR} height={H - y(w.finished.length)}
                  style={{ fill: 'var(--pipe-done)' }} data-estimated={w.estimated ? '' : undefined}
                  {...pickable(`Finished · week of ${weekLabel(w.start)}${w.estimated ? ' (estimated)' : ''}`, w.finished, onPick)} />
              )}
              <text className="chart-label" x={mid(i)} y={H + 16}>{weekLabel(w.start)}</text>
            </g>
          ))}
          <polyline className="chart-line" points={weeks.map((w, i) => `${mid(i)},${y(w.added.length)}`).join(' ')} />
          {weeks.map((w, i) => w.added.length > 0 && (
            // The class goes after the spread, which would otherwise replace it with plain "pick".
            <circle key={w.start} cx={mid(i)} cy={y(w.added.length)} r={5}
              {...pickable(`Added · week of ${weekLabel(w.start)}`, w.added, onPick)} className="pick chart-dot" />
          ))}
        </svg>
      </div>
      <div className="chart-legend">
        <span><i className="pipe-dot pipe-done" />finished</span>
        <span><i className="key-line" />added</span>
        {weeks.some((w) => w.estimated) && (
          <span className="est-note">Lighter bars are estimates: a card's last change stands in for when it was finished.</span>
        )}
      </div>
    </>
  );
}

/** Median days per column, one upright bar each; a click lists the slowest cards. */
export function MedianColumns({ times, columns, labels, since, onPick }) {
  const known = columns.filter((col) => times[col]?.median_days !== null && times[col]?.median_days !== undefined);
  if (!known.length) {
    return <p className="dash-empty">Collecting since {since ?? 'today'}. Medians appear once cards move between columns.</p>;
  }
  const max = Math.max(0.1, ...known.map((col) => times[col].median_days));
  const y = (n) => H - (n / max) * (H - TOP);
  // Under an hour or so rounds to 0d; that column still gets a bar.
  const tall = (days) => Math.max(MIN_BAR, H - y(days));
  const width = GAP + columns.length * (BAR + GAP);
  return (
    <div className="chart-scroll">
      <svg className="chart" role="group" width={width} height={H + 30} aria-label="Median days in each column">
        <line className="chart-axis" x1={0} x2={width} y1={H} y2={H} />
        {columns.map((col, i) => {
          const t = times[col];
          const x = GAP + i * (BAR + GAP);
          return (
            <g key={col}>
              {t.median_days !== null && (
                <>
                  <rect x={x} y={H - tall(t.median_days)} width={BAR} height={tall(t.median_days)}
                    style={{ fill: `var(--pipe-${col})` }}
                    {...pickable(`Longest in ${labels[col]}`, t.longest, onPick, Object.fromEntries(
                      t.longest.map((id, k) => [id, `${t.longest_days[k]}d in ${labels[col]}`])))} />
                  <text className="chart-num" x={x + BAR / 2} y={H - tall(t.median_days) - 4}>{t.median_days}d</text>
                </>
              )}
              <text className="chart-label" x={x + BAR / 2} y={H + 16}>{labels[col]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Cards an agent touched against cards you touched, side by side per week. */
export function PairBars({ weeks, since, onPick }) {
  const scroller = useLatestInView(weeks);
  // Seeded history has no "who", so an empty chart means nothing collected yet, not nobody working.
  if (weeks.every((w) => !w.agent.length && !w.you.length)) {
    return <p className="dash-empty">Collecting since {since ?? 'today'}. Changes by agents and by you appear as cards move.</p>;
  }
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.agent.length, w.you.length)));
  const y = (n) => H - (n / max) * (H - TOP);
  const half = BAR / 2 - 1;
  const width = GAP + weeks.length * (BAR + GAP);
  return (
    <>
      <div className="chart-scroll" ref={scroller}>
        <svg className="chart" role="group" width={width} height={H + 30} aria-label="Agent against you per week">
          <line className="chart-axis" x1={0} x2={width} y1={H} y2={H} />
          {weeks.map((w, i) => {
            const x = GAP + i * (BAR + GAP);
            const label = w.start ? weekLabel(w.start) : '';
            return (
              <g key={`${w.start}-${i}`}>
                {w.agent.length > 0 && (
                  <rect x={x} y={y(w.agent.length)} width={half} height={H - y(w.agent.length)}
                    style={{ fill: 'var(--sky)' }} {...pickable(`Agents · week of ${label}`, w.agent, onPick)} />
                )}
                {w.you.length > 0 && (
                  <rect x={x + half + 2} y={y(w.you.length)} width={half} height={H - y(w.you.length)}
                    style={{ fill: 'var(--muted)' }} {...pickable(`You · week of ${label}`, w.you, onPick)} />
                )}
                <text className="chart-label" x={x + BAR / 2} y={H + 16}>{label}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="chart-legend">
        <span><i className="pipe-dot" style={{ background: 'var(--sky)' }} />agents</span>
        <span><i className="pipe-dot" style={{ background: 'var(--muted)' }} />you</span>
      </div>
    </>
  );
}
