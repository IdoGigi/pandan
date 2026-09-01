import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CARD_COLORS } from './Card.jsx';

const SWATCH = {
  plain: '#eaebed', lime: '#c3d117', sky: '#4bb3d4',
  amber: '#f0b429', rose: '#e2725b', violet: '#9b8ec4',
};
const NAMES = {
  plain: 'None', lime: 'Lime', sky: 'Blue',
  amber: 'Amber', rose: 'Red', violet: 'Purple',
};

/** Small menu at the pointer for the quick visual changes to a card. */
export function CardMenu({ x, y, card, onPickColor, onToggleFlag, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, visible: false });

  // Measure first, then place, so the menu never hangs off the screen.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    const w = box?.width || 190;
    const h = box?.height || 120;
    setPos({
      left: Math.max(6, Math.min(x, window.innerWidth - w - 6)),
      top: Math.max(6, Math.min(y, window.innerHeight - h - 6)),
      visible: true,
    });
  }, [x, y]);

  useEffect(() => {
    // This listener runs in the capture phase, before React sees the event, so
    // it must ignore presses on the menu itself. Closing here would unmount the
    // buttons before their click could ever fire.
    const onPointerDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      onClose();
    };
    const close = () => onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx"
      style={{ left: pos.left, top: pos.top, visibility: pos.visible ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      <div className="ctx-title">{card.title}</div>

      <div className="ctx-colors">
        {CARD_COLORS.map((c) => (
          <button
            key={c}
            className={`ctx-swatch${card.color === c ? ' on' : ''}`}
            style={{ background: SWATCH[c] }}
            title={NAMES[c]}
            aria-label={NAMES[c]}
            onClick={() => onPickColor(c)}
          />
        ))}
      </div>

      <button className="ctx-item" onClick={onToggleFlag}>
        <span className="ctx-dot" style={{ opacity: card.flagged ? 1 : 0.25 }} />
        {card.flagged ? 'Remove flag' : 'Flag this card'}
      </button>
    </div>
  );
}
