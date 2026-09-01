import { useEffect, useState } from 'react';
import { api } from './api.js';
import { CARD_COLORS } from './Card.jsx';
import { COLUMN_LABELS } from './Board.jsx';
import { Dialog } from './Dialog.jsx';

const SWATCH = {
  plain: '#eaebed', lime: '#c3d117', sky: '#4bb3d4',
  amber: '#f0b429', rose: '#e2725b', violet: '#9b8ec4',
};

export function CardModal({ cardId, projects, labels = {}, onClose, onSaved, onDeleted }) {
  const [card, setCard] = useState(null);
  const [checks, setChecks] = useState([]);
  const [newCheck, setNewCheck] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.getCard(cardId)
      .then((data) => {
        if (!alive) return;
        setChecks(data.checklist || []);
        setCard(data);
      })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [cardId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (confirmArchive) setConfirmArchive(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmArchive]);

  if (!card) {
    return (
      <div className="overlay" onMouseDown={onClose}>
        <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
          {error ? <div className="error">{error}</div> : <div className="center-note">Loading…</div>}
        </div>
      </div>
    );
  }

  const set = (patch) => setCard((c) => ({ ...c, ...patch }));

  async function save() {
    try {
      await api.updateCard(card.id, {
        title: card.title,
        notes: card.notes,
        color: card.color,
        flagged: !!card.flagged,
        due_date: card.due_date || '',
        project_id: card.project_id,
        column_key: card.column_key,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addCheck() {
    const text = newCheck.trim();
    if (!text) return;
    setNewCheck('');
    const row = await api.addCheck(card.id, text);
    setChecks((list) => [...list, row]);
    onSaved();
  }

  async function toggleCheck(row) {
    const done = row.done ? 0 : 1;
    setChecks((list) => list.map((c) => (c.id === row.id ? { ...c, done } : c)));
    await api.updateCheck(row.id, { done });
    onSaved();
  }

  async function removeCheck(row) {
    setChecks((list) => list.filter((c) => c.id !== row.id));
    await api.deleteCheck(row.id);
    onSaved();
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Edit card</h2>

        <div className="field">
          <label>Title</label>
          <textarea
            className="textarea"
            style={{ minHeight: 52 }}
            value={card.title}
            autoFocus
            onChange={(e) => set({ title: e.target.value })}
          />
        </div>

        <div className="field">
          <label>Notes</label>
          <textarea className="textarea" value={card.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Project</label>
            <select
              className="select"
              value={card.project_id}
              onChange={(e) => set({ project_id: Number(e.target.value) })}
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Column</label>
            <select
              className="select"
              value={card.column_key}
              onChange={(e) => set({ column_key: e.target.value })}
            >
              {Object.entries(COLUMN_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label>Label</label>
          <div className="swatches">
            {CARD_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${card.color === c ? ' on' : ''}`}
                style={{ background: SWATCH[c] }}
                title={labels[c] || c}
                onClick={() => set({ color: c })}
              />
            ))}
            {labels[card.color] && <span className="label-name">{labels[card.color]}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Due date</label>
            <div className="repo-row">
              <input
                className="input"
                type="date"
                value={card.due_date || ''}
                onChange={(e) => set({ due_date: e.target.value })}
              />
              {card.due_date && (
                <button className="btn" onClick={() => set({ due_date: '' })}>Clear</button>
              )}
            </div>
          </div>
        </div>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={!!card.flagged}
              onChange={(e) => set({ flagged: e.target.checked ? 1 : 0 })}
              style={{ marginRight: 6 }}
            />
            Flag this card
          </label>
        </div>

        <div className="field">
          <label>Checklist {checks.length > 0 && `(${checks.filter((c) => c.done).length}/${checks.length})`}</label>
          <div className="checklist">
            {checks.map((row) => (
              <div key={row.id} className={`check-row${row.done ? ' done' : ''}`}>
                <input type="checkbox" checked={!!row.done} onChange={() => toggleCheck(row)} />
                <span className="txt">{row.text}</span>
                <button className="btn btn-ghost" style={{ padding: '0 6px' }} onClick={() => removeCheck(row)}>×</button>
              </div>
            ))}
            <input
              className="input"
              value={newCheck}
              placeholder="Add an item, then Enter"
              onChange={(e) => setNewCheck(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCheck())}
            />
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-danger" onClick={() => setConfirmArchive(true)}>
            Archive
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>

      {confirmArchive && (
        <Dialog
          kind="confirm"
          title="Archive this card?"
          message={`"${card.title}" leaves the board. You can bring it back from the archive.`}
          confirmLabel="Archive"
          danger
          onCancel={() => setConfirmArchive(false)}
          onConfirm={async () => {
            setConfirmArchive(false);
            try {
              await api.archiveCard(card.id);
              onDeleted();
              onClose();
            } catch (e) {
              setError(e.message);
            }
          }}
        />
      )}
    </div>
  );
}
