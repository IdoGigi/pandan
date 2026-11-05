import { useEffect, useRef } from 'react';
import { CardRow } from './CardRow.jsx';

/** The cards behind a number on the dashboard, untouched longest first, each with its quick actions. */
export function DrillPanel({ title, cards, notes, projects, onOpenCard, onChanged, onError, onClose }) {
  const box = useRef(null);

  useEffect(() => {
    // Esc belongs to the card editor while it is open over the dashboard, and to a row's ⋯ menu.
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.overlay, .row-menu')) onClose();
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

  const projectOf = Object.fromEntries(projects.map((p) => [p.id, p]));
  // A list with notes ("Longest in Doing") is already in its own order; the rest go untouched-longest first.
  const sorted = notes ? cards : [...cards].sort((a, b) => a.updated_at.localeCompare(b.updated_at));

  return (
    <aside className="drill" aria-label={title} tabIndex={-1} ref={box}>
      <header>
        {/* Isolated, so a count after a Hebrew project name is not drawn inside it. */}
        <h3><bdi>{title}</bdi> · {cards.length}</h3>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close the list">✕</button>
      </header>
      <ul className="card-list">
        {sorted.map((c) => (
          <CardRow key={c.id} card={c} project={projectOf[c.project_id]} note={notes?.[c.id]}
            onOpenCard={onOpenCard} onChanged={onChanged} onError={onError} />
        ))}
      </ul>
    </aside>
  );
}
