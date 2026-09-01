export const CARD_COLORS = ['plain', 'lime', 'sky', 'amber', 'rose', 'violet'];

/** Late, today, or just upcoming — that is all the detail a glance needs. */
export function dueState(due) {
  if (!due) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (due < today) return 'late';
  if (due === today) return 'today';
  return 'soon';
}

const shortDate = (due) =>
  new Date(`${due}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function Card({ card, dragging, onOpen, onMenu, onDragStart, onDragEnd }) {
  const total = card.checks_total ?? 0;
  const done = card.checks_done ?? 0;
  const due = dueState(card.due_date);

  return (
    <div
      className={`card ${card.color || 'plain'}${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(card)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(card, e.clientX, e.clientY);
      }}
      title={card.notes || card.title}
    >
      {card.flagged ? <span className="card-flag" /> : null}
      {card.last_actor_kind === 'agent' && (
        <span className="by-agent" title={`Last changed by ${card.last_actor}`}>◆</span>
      )}
      <div className="card-title">{card.title}</div>
      {(total > 0 || due) && (
        <div className="card-meta">
          {due && (
            <span className={`due due-${due}`} title={`Due ${card.due_date}`}>
              {due === 'late' ? '⚠ ' : ''}{shortDate(card.due_date)}
            </span>
          )}
          {total > 0 && <span>{done}/{total}</span>}
        </div>
      )}
    </div>
  );
}
