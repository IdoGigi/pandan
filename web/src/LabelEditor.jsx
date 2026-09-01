import { useState } from 'react';
import { api } from './api.js';
import { CARD_COLORS } from './Card.jsx';

export const SWATCH = {
  plain: '#eaebed', lime: '#c3d117', sky: '#4bb3d4',
  amber: '#f0b429', rose: '#e2725b', violet: '#9b8ec4',
};

/**
 * Names the six card colours for one board. Naming a colour is what turns it
 * from decoration into a label, so this is the same editor wherever it appears.
 */
export function LabelEditor({ boardId, labels, onSaved }) {
  const [names, setNames] = useState(labels);
  const [error, setError] = useState('');

  async function save(color) {
    const next = (names[color] ?? '').trim();
    if (next === (labels[color] ?? '')) return;
    try {
      await api.setLabel(boardId, color, next);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="label-editor">
      {CARD_COLORS.map((c) => (
        <div key={c} className="label-row">
          <span className="swatch on" style={{ background: SWATCH[c], cursor: 'default' }} />
          <input
            className="input"
            value={names[c] ?? ''}
            placeholder={`no name — ${c}`}
            onChange={(e) => setNames((n) => ({ ...n, [c]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            onBlur={() => save(c)}
          />
        </div>
      ))}
      <p className="set-hint" style={{ margin: '2px 0 0' }}>
        Names belong to this board. Clear one to remove it.
      </p>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
