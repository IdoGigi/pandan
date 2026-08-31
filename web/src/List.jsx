import { useRef, useState } from 'react';
import { Card } from './Card.jsx';

/** One grid cell: the cards of a single project in a single column. */
export function List({ projectId, columnKey, cards, drag, onOpenCard, onAddCard, onDropCard }) {
  const ref = useRef(null);
  const [dropIndex, setDropIndex] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  /** Where would the dragged card land, given the pointer's Y position? */
  function indexAt(clientY) {
    const nodes = [...(ref.current?.querySelectorAll('[data-card]') || [])];
    for (let i = 0; i < nodes.length; i += 1) {
      const box = nodes[i].getBoundingClientRect();
      if (clientY < box.top + box.height / 2) return i;
    }
    return nodes.length;
  }

  function handleDragOver(e) {
    if (!drag.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIndex(indexAt(e.clientY));
  }

  function handleDrop(e) {
    e.preventDefault();
    const card = drag.current;
    const index = dropIndex ?? indexAt(e.clientY);
    setDropIndex(null);
    if (card) onDropCard(card, projectId, columnKey, index);
  }

  function commitDraft() {
    const title = draft.trim();
    setDraft('');
    setAdding(false);
    if (title) onAddCard(projectId, columnKey, title);
  }

  return (
    <div
      ref={ref}
      className={`list ${columnKey}${dropIndex !== null ? ' drop-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={(e) => {
        if (!ref.current?.contains(e.relatedTarget)) setDropIndex(null);
      }}
      onDrop={handleDrop}
    >
      {cards.map((card, i) => (
        <div key={card.id} data-card>
          {dropIndex === i && <div className="drop-line" />}
          <Card
            card={card}
            dragging={drag.current?.id === card.id}
            onOpen={onOpenCard}
            onDragStart={(e) => {
              drag.current = card;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(card.id));
            }}
            onDragEnd={() => {
              drag.current = null;
              setDropIndex(null);
            }}
          />
        </div>
      ))}

      {dropIndex === cards.length && <div className="drop-line" />}

      {adding ? (
        <textarea
          className="quick-input"
          autoFocus
          rows={2}
          value={draft}
          placeholder="Card title, then Enter"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitDraft();
            }
            if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
        />
      ) : (
        <button className="add-card" onClick={() => setAdding(true)}>
          + Add
        </button>
      )}
    </div>
  );
}
