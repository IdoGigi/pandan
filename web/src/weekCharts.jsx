/**
 * The dashboard's week-by-week charts: two upright bars a week, from the first
 * week with anything in it. Each opens on the latest week (see useLatestInView).
 */
import {
  agentWeekHasAny, fit, H, Key, niceTicks, pickable, recentWeeks, scaleTo, useLatestInView, weekLabel,
} from './chartKit.jsx';

const AXIS = 32; // room for the y-axis numbers
const MIN_WEEK = 44; // the narrowest a week gets: two bars and its date under them
const MAX_HALF = 28; // the widest each bar of a pair gets

/**
 * A pair of bars per week on a y-axis with a few round numbers. `pairOf(week)`
 * gives the two: { key, ids, color, title, estimated? }. The numbers sit
 * outside the part that scrolls, so they stay in view beside any week.
 */
function PairedWeeks({ label, weeks, pairOf, width, onPick }) {
  const scroller = useLatestInView(weeks.at(-1).start, width);
  const pairs = weeks.map(pairOf);
  const ticks = niceTicks(Math.max(...pairs.flat().map((p) => p.ids.length)));
  const y = scaleTo(ticks.at(-1));
  const { slot, full } = fit(weeks.length, width - AXIS, MIN_WEEK);
  const half = Math.min(MAX_HALF, Math.floor(slot * 0.3));
  return (
    <div className="chart-y-wrap">
      <svg className="chart" width={AXIS} height={H + 30} aria-hidden="true">
        {ticks.map((t) => <text key={t} className="chart-tick" x={AXIS - 6} y={y(t) + 4}>{t}</text>)}
      </svg>
      <div className="chart-scroll" ref={scroller}>
        <svg className="chart" role="group" width={full} height={H + 30} aria-label={label}>
          {ticks.map((t) => (
            <line key={t} className={t ? 'chart-grid' : 'chart-axis'} x1={0} x2={full} y1={y(t)} y2={y(t)} />
          ))}
          {weeks.map((w, i) => {
            const mid = slot * (i + 0.5);
            return (
              <g key={w.start}>
                {pairs[i].map((p, k) => p.ids.length > 0 && (
                  <rect key={p.key} x={k ? mid + 1 : mid - 1 - half} y={y(p.ids.length)} width={half}
                    height={H - y(p.ids.length)} style={{ fill: p.color }}
                    data-estimated={p.estimated ? '' : undefined} {...pickable(p.title, p.ids, onPick)} />
                ))}
                <text className="chart-label" x={mid} y={H + 16}>{weekLabel(w.start)}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/** Cards added against cards finished, each week. Estimated finishes are lighter. */
export function AddedFinished({ weeks, width, onPick }) {
  const shown = recentWeeks(weeks, (w) => w.added.length || w.finished.length);
  if (!shown.length) {
    return <p className="dash-empty">Nothing added or finished in the last {weeks.length} weeks.</p>;
  }
  const pairOf = (w) => {
    const when = `week of ${weekLabel(w.start)}`;
    return [
      { key: 'added', ids: w.added, color: 'var(--amber)', title: `Added · ${when}` },
      { key: 'finished', ids: w.finished, color: 'var(--pipe-done)', estimated: w.estimated,
        title: `Finished · ${when}${w.estimated ? ' (estimated)' : ''}` },
    ];
  };
  return (
    <>
      <PairedWeeks label="Added and finished per week" weeks={shown} pairOf={pairOf} width={width} onPick={onPick} />
      <div className="chart-legend">
        <Key color="var(--amber)">added</Key>
        <Key color="var(--pipe-done)">finished</Key>
        {shown.some((w) => w.estimated) && (
          <span className="est-note">Lighter bars are estimates: a card's last change stands in for when it was finished.</span>
        )}
      </div>
    </>
  );
}

/** Cards an agent touched against cards you touched, side by side per week. */
export function PairBars({ weeks, since, width, onPick }) {
  const shown = recentWeeks(weeks, agentWeekHasAny);
  // Seeded history has no "who", so an empty chart means nothing collected yet, not nobody working.
  if (!shown.length) {
    return <p className="dash-empty">Collecting since {since ?? 'today'}. Changes by agents and by you appear as cards move.</p>;
  }
  const pairOf = (w) => {
    const when = `week of ${weekLabel(w.start)}`;
    return [
      { key: 'agent', ids: w.agent, color: 'var(--sky)', title: `Agents · ${when}` },
      { key: 'you', ids: w.you, color: 'var(--muted)', title: `You · ${when}` },
    ];
  };
  return (
    <>
      <PairedWeeks label="Agent against you per week" weeks={shown} pairOf={pairOf} width={width} onPick={onPick} />
      <div className="chart-legend">
        <Key color="var(--sky)">agents</Key>
        <Key color="var(--muted)">you</Key>
      </div>
    </>
  );
}
