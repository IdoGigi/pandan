/**
 * What every dashboard chart shares: sizes, the click-to-list pattern, fitting
 * a chart to its panel's width, and the week helpers. All charts are upright
 * and hand-drawn in SVG, with no library. Every part a person can click is a
 * button: it calls onPick(title, ids, notes) with the cards behind it (notes,
 * when given, say something per card and keep their order), and says how many
 * in its label for a screen reader. Each chart is a labelled group, so a
 * screen reader names it too.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const H = 180; // the plot's height; the labels go under it
export const TOP = 18; // room above the tallest bar for its number
const MIN_BAR = 4; // the shortest bar drawn, so one that rounds to 0 can still be seen and clicked
const MAX_BAR = 64; // wider than this a bar reads as a block
const FALLBACK_WIDTH = 560; // without a ResizeObserver (jsdom) a chart is drawn this wide
const MIN_WEEKS = 4;
// The pale column fills, nearly the panel in light mode; their bars get a fine edge (.pale).
export const PALE = new Set(['todo', 'next']);
// A name whose first letter is Hebrew or Arabic reads right to left, as dir="auto" decides elsewhere.
export const RTL_FIRST = /^[^\p{L}]*[\u0590-\u08FF]/u;

const plural = (n) => `${n} card${n === 1 ? '' : 's'}`;

/** A whole percent that says 0% or 100% only when it is: under 1% reads "<1%", nearly all "99%". */
export function percent(part, whole) {
  if (!part || part === whole) return `${part ? 100 : 0}%`;
  const share = part / whole;
  return share < 0.01 ? '<1%' : `${Math.min(99, Math.round(share * 100))}%`;
}

// The gates for "anything collected yet", shared by the dashboard and its charts so they agree.
export const hasMedian = (t) => t?.median_days !== null && t?.median_days !== undefined;
export const agentWeekHasAny = (w) => w.agent.length > 0 || w.you.length > 0;
export const shortName = (name, max) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);
export const weekLabel = (start) => new Date(`${start}T00:00:00Z`)
  .toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The y of a count on a plot whose top stands for `max`. */
export const scaleTo = (max) => (n) => H - (n / max) * (H - TOP);

/**
 * Spreads `n` slots across `width`, none narrower than `min`. When they don't
 * fit, the chart is wider than its panel and scrolls sideways inside it.
 */
export function fit(n, width, min) {
  const slot = Math.max(min, width / Math.max(1, n));
  return { slot, full: Math.max(width, slot * n), bar: Math.min(MAX_BAR, Math.round(slot * 0.6)) };
}

/**
 * The width of `ref`'s box, kept current as its panel grows or shrinks (the
 * window, the card list opening beside it). Measured before the first paint,
 * so a chart never flashes at the wrong width.
 */
export function useWidth(ref) {
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const now = Math.floor(el.getBoundingClientRect().width);
    if (now > 0) setWidth(now);
    if (typeof ResizeObserver === 'undefined') return undefined;
    // Rounded down: half a pixel too wide would give every chart a scrollbar.
    const watch = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    watch.observe(el);
    return () => watch.disconnect();
  }, [ref]);
  return width;
}

/**
 * A chart of weeks opens on the latest ones, at its right end, however narrow
 * the screen. The chart that calls this is drawn only when it has weeks to
 * show, so opening covers "drawn again after being empty". A new week brings
 * it back to the end. So does its panel narrowing or widening (`width`), but
 * only if it was at the end: older weeks you scrolled back to stay in view.
 * A live change in the same weeks moves nothing. Before paint, so the oldest
 * weeks never flash first.
 */
export function useLatestInView(latest, width) {
  const box = useRef(null);
  const atEnd = useRef(true);
  const shown = useRef(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && (latest !== shown.current || atEnd.current)) el.scrollLeft = el.scrollWidth;
    shown.current = latest;
  }, [latest, width]);
  useEffect(() => {
    const el = box.current;
    const onScroll = () => { atEnd.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1; };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  return box;
}

/**
 * The weeks from the first one with anything in it: leading empty weeks say
 * nothing. At least four always show; none when every week is empty.
 */
export function recentWeeks(weeks, hasAny) {
  const first = weeks.findIndex(hasAny);
  return first < 0 ? [] : weeks.slice(Math.max(0, Math.min(first, weeks.length - MIN_WEEKS)));
}

/** 0 and round steps up to just past `max`: three or four numbers for a y-axis. */
export function niceTicks(max) {
  const raw = Math.max(1, max) / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw));
  const top = Math.max(2 * step, Math.ceil(max / step) * step);
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/** Props that make an SVG shape a button for `ids`. Empty ones are not clickable. */
export function pickable(title, ids, onPick, notes) {
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

/**
 * Upright bars, one per item, spread across `width`: the value above each and
 * the name under it. An item is { key, name, value, text, color, title, ids,
 * notes?, pale? }; one with no cards behind it draws no bar, and a null text no number.
 */
export function Bars({ label, items, width, minSlot, onPick }) {
  const { slot, full, bar } = fit(items.length, width, minSlot);
  const y = scaleTo(Math.max(0, ...items.map((it) => it.value ?? 0)) || 1);
  return (
    <div className="chart-scroll">
      <svg className="chart" role="group" width={full} height={H + 30} aria-label={label}>
        <line className="chart-axis" x1={0} x2={full} y1={H} y2={H} />
        {items.map((it, i) => {
          const mid = slot * (i + 0.5);
          // Under an hour or so rounds to 0d; that column still gets a bar.
          const tall = it.ids.length ? Math.max(MIN_BAR, H - y(it.value)) : 0;
          return (
            <g key={it.key}>
              {tall > 0 && (
                // The class goes after the spread, which would otherwise replace it with plain "pick".
                <rect x={mid - bar / 2} y={H - tall} width={bar} height={tall}
                  style={{ fill: it.color }} {...pickable(it.title, it.ids, onPick, it.notes)}
                  className={it.pale ? 'pick pale' : 'pick'} />
              )}
              {it.text !== null && <text className="chart-num" x={mid} y={H - tall - 5}>{it.text}</text>}
              <text className="chart-label" x={mid} y={H + 16}>{it.name}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** A colour swatch and its name, for a legend. */
export const Key = ({ color, children }) => <span><i className="pipe-dot" style={{ background: color }} />{children}</span>;

/** Which blue is which column, under a chart coloured by column. */
export function ColumnKey({ columns, labels }) {
  return (
    <div className="chart-legend">
      {columns.map((col) => <Key key={col} color={`var(--pipe-${col})`}>{labels[col]}</Key>)}
    </div>
  );
}
