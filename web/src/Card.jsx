export const CARD_COLORS = ['plain', 'lime', 'sky', 'amber', 'rose', 'violet'];

export function Card({ card, dragging, onOpen, onMenu, onDragStart, onDragEnd }) {
  const total = card.checks_total ?? 0;
  const done = card.checks_done ?? 0;

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
      <div className="card-title">{card.title}</div>
      {total > 0 && (
        <div className="card-meta">
          <span>{done}/{total}</span>
        </div>
      )}
    </div>
  );
}
