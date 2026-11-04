import { useEffect, useRef } from 'react';
import { COLUMN_LABELS } from './Board.jsx';

const DAY = 86400000;
/** "9d" since a SQLite UTC time; "today" under a day. */
function age(updatedAt) {
  const days = Math.floor((Date.now() - Date.parse(`${updatedAt.replace(' ', 'T')}Z`)) / DAY);
  return days < 1 ? 'today' : `${days}d`;
}

/** The cards behind a number on the dashboard, untouched longest first. */
export function DrillPanel({ title, cards, notes, projects, onOpenCard, onClose }) {
  const box = useRef(null);

  useEffect(() => {
    // Esc belongs to the card editor while it is open over the dashboard.
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.overlay')) onClose();
    };
    // Capture runs before the editor's own listener closes it, whatever order they were added in.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Keyboard and screen reader land on the new list; the page stays where it is. What had focus
  // before (the tile or bar that opened it) gets it back when the list closes.
  const opener = useRef(null);
  useEffect(() => {
    const was = document.activeElement;
    if (!box.current?.contains(was)) opener.current = was === document.body ? null : was;
    box.current?.focus({ preventScroll: true });
  }, [title]);
  useEffect(() => () => {
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  }, []);

  const colorOf = Object.fromEntries(projects.map((p) => [p.id, p.color]));
  // A list with notes ("Longest in Doing") is already in its own order; the rest go untouched-longest first.
  const sorted = notes ? cards : [...cards].sort((a, b) => a.updated_at.localeCompare(b.updated_at));

  return (
    <aside className="drill" aria-label={title} tabIndex={-1} ref={box}>
      <header>
        <h3>{title} · {cards.length}</h3>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close the list">✕</button>
      </header>
      <ul>
        {sorted.map((c) => (
          <li key={c.id}>
            <button
              className="drill-row"
              disabled={c.archived}
              onClick={() => onOpenCard(c.id)}
              title={c.archived ? 'Archived — restore it from the Archive to edit it' : 'Open this card'}
            >
              <span className="card-no">{c.ref}</span>
              <span className="drill-title" dir="auto">{c.title}</span>
              <i className="dot" style={{ background: colorOf[c.project_id] ?? 'var(--muted)' }} />
              <span className="drill-col">{c.archived ? 'archived' : COLUMN_LABELS[c.column_key]}</span>
              <span className="drill-age">{notes?.[c.id] ?? age(c.updated_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
