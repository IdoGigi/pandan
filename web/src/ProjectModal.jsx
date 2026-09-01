import { useEffect, useState } from 'react';
import { api } from './api.js';
import { COLUMN_LABELS } from './Board.jsx';
import { Dialog } from './Dialog.jsx';

const PROJECT_COLORS = ['#c3d117', '#4bb3d4', '#f0b429', '#e2725b', '#9b8ec4', '#57a773', '#94a3b8'];
const COLS = ['todo', 'next', 'doing', 'done'];

export function ProjectModal({ projectId, onClose, onSaved, onDeleted, onOpenCard }) {
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.getProject(projectId)
      .then((d) => {
        if (!alive) return;
        setName(d.name);
        setColor(d.color);
        setData(d);
      })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (confirmDelete) setConfirmDelete(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmDelete]);

  if (!data) {
    return (
      <div className="overlay" onMouseDown={onClose}>
        <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
          {error ? <div className="error">{error}</div> : <div className="center-note">Loading…</div>}
        </div>
      </div>
    );
  }

  const s = data.stats;
  const changed = name.trim() !== data.name || color !== data.color;

  async function save() {
    try {
      await api.updateProject(data.id, { name: name.trim(), color });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="project-head">
          <span className="dot lg" style={{ background: color }} />
          <input
            className="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && changed && name.trim() && save()}
          />
        </div>

        <div className="progress">
          <div className="progress-bar"><span style={{ width: `${s.percent_done}%` }} /></div>
          <span className="progress-text">{s.percent_done}% done</span>
        </div>

        <div className="stat-row">
          <div className="stat"><b>{s.total}</b><span>cards</span></div>
          <div className="stat"><b>{s.open}</b><span>open</span></div>
          {COLS.map((c) => (
            <div className="stat" key={c}><b>{s.by_column[c]}</b><span>{COLUMN_LABELS[c]}</span></div>
          ))}
          <div className="stat"><b>{s.flagged}</b><span>flagged</span></div>
          {s.checks_total > 0 && (
            <div className="stat"><b>{s.checks_done}/{s.checks_total}</b><span>checklist</span></div>
          )}
        </div>

        <div className="field">
          <label>Colour</label>
          <div className="swatches">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${color === c ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <label>Cards</label>
          {data.cards.length === 0 ? (
            <p className="dialog-msg" style={{ margin: 0 }}>No cards in this project yet.</p>
          ) : (
            <div className="project-cards">
              {COLS.filter((c) => s.by_column[c] > 0).map((c) => (
                <div key={c} className="project-col">
                  <div className="project-col-head">{COLUMN_LABELS[c]} · {s.by_column[c]}</div>
                  {data.cards.filter((card) => card.column_key === c).map((card) => (
                    <button
                      key={card.id}
                      className={`mini-card ${card.color || 'plain'}`}
                      onClick={() => onOpenCard(card.id)}
                      title="Open this card"
                    >
                      {card.flagged ? <span className="card-flag" /> : null}
                      <span className="mini-title">{card.title}</span>
                      {card.checks_total > 0 && (
                        <span className="mini-meta">{card.checks_done}/{card.checks_total}</span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="dialog-msg" style={{ marginBottom: 0 }}>
          Created {data.created_at}. Last change {s.last_activity}.
        </p>

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Delete project</button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={!changed || !name.trim()} onClick={save}>Save</button>
        </div>
      </div>

      {confirmDelete && (
        <Dialog
          kind="confirm"
          title={`Delete "${data.name}"?`}
          message={
            s.total === 0
              ? 'This project has no cards.'
              : `This also deletes ${s.total} card${s.total === 1 ? '' : 's'}. You cannot undo this.`
          }
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false);
            try {
              await api.deleteProject(data.id);
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
