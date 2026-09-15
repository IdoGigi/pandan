import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Dialog } from './Dialog.jsx';

export function ArchiveModal({ onClose, onChanged }) {
  const [rows, setRows] = useState(null);
  const [projects, setProjects] = useState([]);
  const [destroying, setDestroying] = useState(null);
  const [error, setError] = useState('');

  const load = () =>
    Promise.all([api.archivedCards(), api.archivedProjects()])
      .then(([cards, projs]) => { setRows(cards); setProjects(projs); })
      .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const restoreProject = async (project) => {
    try {
      await api.updateProject(project.id, { archived: false });
      await load();
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !destroying && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, destroying]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal modal-wide archive" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Archive</h2>
        <p className="dialog-msg">
          Cards that were put away, newest first. Nothing here is lost — bring
          one back, or remove it for good. An agent can archive a card but can
          never delete one.
        </p>

        {projects.length > 0 && (
          <>
            <h3>Projects</h3>
            <div className="token-list">
              {projects.map((project) => (
                <div key={project.id} className="token-row">
                  <span className="chip" style={{ background: project.color }} />
                  <span className="token-name">{project.name}</span>
                  <button className="btn" onClick={() => restoreProject(project)}>Restore</button>
                </div>
              ))}
            </div>
            <h3>Cards</h3>
          </>
        )}

        {rows === null ? (
          <div className="center-note">Loading…</div>
        ) : rows.length === 0 ? (
          <p className="dialog-msg" style={{ margin: 0 }}>
            {projects.length === 0 ? 'The archive is empty.' : 'No archived cards.'}
          </p>
        ) : (
          <div className="token-list">
            {rows.map((card) => (
              <div key={card.id} className="token-row">
                <span className={`chip ${card.color || 'plain'}`} />
                <span className="token-name">{card.title}</span>
                <span className="token-when">{card.project_name}</span>
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      await api.restoreCard(card.id);
                      await load();
                      onChanged();
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Restore
                </button>
                <button className="btn btn-danger" onClick={() => setDestroying(card)}>Delete</button>
              </div>
            ))}
          </div>
        )}

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>

      {destroying && (
        <Dialog
          kind="confirm"
          title="Delete for good?"
          message={`"${destroying.title}" will be gone. This one cannot be undone.`}
          confirmLabel="Delete for good"
          danger
          onCancel={() => setDestroying(null)}
          onConfirm={async () => {
            const card = destroying;
            setDestroying(null);
            try {
              await api.deleteCardForGood(card.id);
              await load();
              onChanged();
            } catch (e) {
              setError(e.message);
            }
          }}
        />
      )}
    </div>
  );
}
