import { useEffect, useRef } from 'react';
import { Bot } from './Icons.jsx';

export const CARD_COLORS = ['plain', 'lime', 'sky', 'amber', 'rose', 'violet'];

/** A finger held still on a card this long opens its menu, like a right-click. */
const LONG_PRESS_MS = 500;

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

  // Phones have no right-click, so a long press opens the menu instead. iPhones
  // send nothing for it; Android sends a contextmenu, which may beat the timer.
  const press = useRef(null);
  // Who opened the menu during this press: 'timer' or 'contextmenu'. Either
  // way, the click that ends the press must not also open the card.
  const openedBy = useRef(null);
  const endPress = () => {
    clearTimeout(press.current?.timer);
    press.current = null;
  };
  const startPress = (e) => {
    openedBy.current = null;
    endPress();
    if (e.pointerType !== 'touch') return;
    const { clientX: x, clientY: y } = e;
    press.current = {
      x,
      y,
      timer: setTimeout(() => {
        press.current = null;
        openedBy.current = 'timer';
        onMenu(card, x, y);
      }, LONG_PRESS_MS),
    };
  };
  const movePress = (e) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) endPress(); // a scroll
  };
  useEffect(() => endPress, []); // a card that goes away mid-press opens nothing

  return (
    <div
      className={`card ${card.color || 'plain'}${dragging ? ' dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={startPress}
      onPointerMove={movePress}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onClick={() => {
        if (openedBy.current) openedBy.current = null;
        else onOpen(card);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        endPress();
        if (openedBy.current === 'timer') return; // the long press already opened it
        openedBy.current = 'contextmenu';
        onMenu(card, e.clientX, e.clientY);
      }}
      title={card.notes || card.title}
    >
      {card.flagged ? <span className="card-flag" /> : null}
      {card.last_actor_kind === 'agent' && (
        <span className="by-agent" title={`Last changed by ${card.last_actor}, an agent`}>
          <Bot size={11} />
        </span>
      )}
      <div className="card-line">
        <span className="card-title" dir="auto">{card.title}</span>
        {/* A card made a moment ago has no real id yet, so nothing to show. */}
        {typeof card.id === 'number' && <span className="card-no">#{card.id}</span>}
      </div>
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
