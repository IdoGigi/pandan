import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { COLUMN_LABELS } from './Board.jsx';

const DAY = 86400000;
const COLUMNS = Object.keys(COLUMN_LABELS);
// "→" moves a card one step on; from Waiting it goes back to Doing. Done has no step on.
const STEP_ON = { todo: 'next', next: 'doing', doing: 'review', waiting: 'doing', review: 'done' };

/** Whole days since a SQLite UTC time. */
export const daysSince = (at) => Math.floor((Date.now() - Date.parse(`${at.replace(' ', 'T')}Z`)) / DAY);
/** "9d" since a time; "today" under a day. */
const age = (at) => (daysSince(at) < 1 ? 'today' : `${daysSince(at)}d`);

/**
 * The columns a card can be sent to, under its ⋯ button. Fixed to the screen,
 * so a scrolled list never clips it; it closes on Esc, a press outside it, or
 * any scroll. Its Esc listener is on the bubble phase, so the card list's own
 * capture-phase one sees the menu still open and leaves the list alone.
 */
function MoveMenu({ card, anchor, onMove, onClose }) {
  const box = useRef(null);
  const [pos, setPos] = useState(null);

  // Measured first, then placed under the button, or above it when there is no room below.
  useLayoutEffect(() => {
    const a = anchor.current.getBoundingClientRect();
    const m = box.current.getBoundingClientRect();
    const below = a.bottom + 4 + m.height <= window.innerHeight;
    setPos({
      left: Math.max(6, Math.min(a.right - m.width, window.innerWidth - m.width - 6)),
      top: below ? a.bottom + 4 : Math.max(6, a.top - 4 - m.height),
    });
    box.current.querySelector('button')?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    // Capture phase, so it must ignore presses on the menu and on its own ⋯ (which toggles it).
    const onDown = (e) => {
      if (!box.current?.contains(e.target) && !anchor.current?.contains(e.target)) onClose(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(true); };
    const onScroll = () => onClose(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [anchor, onClose]);

  return (
    <div ref={box} className="ctx row-menu" role="menu" aria-label={`Move ${card.ref} to`}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      <div className="ctx-label">Move to</div>
      {COLUMNS.filter((col) => col !== card.column_key).map((col) => (
        <button key={col} type="button" role="menuitem" className="ctx-item" aria-label={`Move ${card.ref} to ${COLUMN_LABELS[col]}`}
          onClick={() => onMove(col)}>
          {COLUMN_LABELS[col]}
        </button>
      ))}
    </div>
  );
}

/**
 * One card in a list, in the Control half or in the card list a chart opens.
 * Its number and title open the editor; the buttons beside them change it on
 * the spot, one request at a time, and `onChanged` reads the dashboard again
 * once it is in. A move puts the card at the bottom of its new column, as the
 * board's right-click Move does. An archived card has no buttons.
 */
export function CardRow({ card, color, note, tags = [], start = false, onOpenCard, onChanged, onError }) {
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const more = useRef(null);
  const { ref, column_key: col } = card;
  const on = STEP_ON[col];

  const run = async (call) => {
    setBusy(true);
    try {
      await call();
      onChanged();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const moveTo = (to) => run(() => api.moveCard(card.id, { column_key: to }));
  // Esc and a pick hand focus back to ⋯; a press elsewhere leaves it where it went.
  const closeMenu = useCallback((refocus) => {
    setMenu(false);
    if (refocus) more.current?.focus({ preventScroll: true });
  }, []);
  const act = (className, label, title, onClick, text) => (
    <button type="button" className={`row-act ${className}`} aria-label={label} title={title}
      disabled={busy} onClick={onClick}>{text}</button>
  );

  return (
    <li className="card-row">
      <button type="button" className="row-open" disabled={card.archived} onClick={() => onOpenCard(card.id)}
        title={card.archived ? 'Archived — restore it from the Archive to edit it' : 'Open this card'}>
        <span className="card-no">{ref}</span>
        <span className="row-title" dir="auto">{card.title}</span>
        {tags.map((t) => <span key={t.key} className={`row-tag ${t.key}`}>{t.text}</span>)}
        <i className="dot" style={{ background: color ?? 'var(--muted)' }} />
        <span className="row-col">{card.archived ? 'archived' : COLUMN_LABELS[col]}</span>
        <span className="row-age">{note ?? age(card.updated_at)}</span>
      </button>
      {!card.archived && (
        <span className="row-actions">
          {start && (
            <button type="button" className="btn btn-xs row-start" aria-label={`Start ${ref}`} title="Move it to Doing"
              disabled={busy} onClick={() => moveTo('doing')}>Start ▶</button>
          )}
          {on && act('step', `Move ${ref} on to ${COLUMN_LABELS[on]}`, `Move on to ${COLUMN_LABELS[on]}`, () => moveTo(on), '→')}
          {col !== 'done' && act('done', `Move ${ref} to Done`, 'Done', () => moveTo('done'), '✓')}
          {act(card.flagged ? 'flag flagged' : 'flag', `${card.flagged ? 'Unflag' : 'Flag'} ${ref}`,
            card.flagged ? 'Remove the flag' : 'Flag it',
            () => run(() => api.updateCard(card.id, { flagged: !card.flagged })), '⚑')}
          {col !== 'waiting' && col !== 'done'
            && act('wait', `Move ${ref} to Waiting`, 'Waiting', () => moveTo('waiting'), '⏸')}
          <button ref={more} type="button" className="row-act more" aria-label={`Move ${ref} to another column`}
            title="Move to…" aria-haspopup="menu" aria-expanded={menu} disabled={busy}
            onClick={() => setMenu((open) => !open)}>⋯</button>
        </span>
      )}
      {menu && (
        <MoveMenu card={card} anchor={more} onClose={closeMenu}
          onMove={(to) => { closeMenu(true); moveTo(to); }} />
      )}
    </li>
  );
}
