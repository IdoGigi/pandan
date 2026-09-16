import { useEffect, useState } from 'react';
import { api } from './api.js';
import { COLUMN_LABELS } from './Board.jsx';
import { Dialog } from './Dialog.jsx';
import { LinkList } from './LinkList.jsx';

const PROJECT_COLORS = ['#c3d117', '#4bb3d4', '#f0b429', '#e2725b', '#9b8ec4', '#57a773', '#94a3b8'];
const COLS = ['todo', 'next', 'doing', 'review', 'done'];

/** The update log as Markdown: a heading, then one line per entry, newest first. */
export function logAsMarkdown(project) {
  const lines = (project.updates || []).map((u) => {
    const who = u.actor && u.actor !== 'you' ? ` _(${u.actor})_` : '';
    return `- **${u.created_at}** — ${u.text.replace(/\r?\n/g, ' ')}${who}`;
  });
  return `# ${project.name} — update log\n\n${lines.length ? lines.join('\n') : '_No updates yet._'}\n`;
}

/** A safe file name from the project name: letters, digits and dashes only. */
const fileSlug = (name) => (name.toLowerCase().replace(/[^a-z0-9֐-׿]+/g, '-').replace(/^-|-$/g, '') || 'project');

export function ProjectModal({ projectId, onClose, onSaved, onDeleted, onOpenCard }) {
  const [data, setData] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [description, setDescription] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.getProject(projectId)
      .then((d) => {
        if (!alive) return;
        setName(d.name);
        setColor(d.color);
        setDescription(d.description || '');
        setRepoUrl(d.repo_url || '');
        setData(d);
      })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (confirmDelete) setConfirmDelete(false);
      else if (confirmArchive) setConfirmArchive(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmDelete, confirmArchive]);

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
  const changed =
    name.trim() !== data.name ||
    color !== data.color ||
    description !== (data.description || '') ||
    repoUrl !== (data.repo_url || '');

  /** Re-read the project so lists and counts stay honest after a write. */
  const refresh = async () => {
    const fresh = await api.getProject(data.id);
    setData(fresh);
    onSaved();
  };

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(logAsMarkdown(data));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy. Use Download instead.');
    }
  };

  /** Saves the log as a .md file through a short-lived link, the way browsers allow. */
  const downloadLog = () => {
    if (typeof URL.createObjectURL !== 'function') return setError('Download is not available here.');
    const blob = new Blob([logAsMarkdown(data)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileSlug(data.name)}-updates.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  async function save() {
    try {
      await api.updateProject(data.id, {
        name: name.trim(), color, description, repo_url: repoUrl,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal modal-wide project-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="project-head">
          <span className="dot lg" style={{ background: color }} />
          <input
            className="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && changed && name.trim() && save()}
          />
        </div>

        {/* One bar is the whole project; each segment is a column, in board order.
            The Done segment is the percent done, so there is no second bar. */}
        <div className="pipeline">
          <div
            className="pipeline-bar"
            role="img"
            aria-label={COLS.map((c) => `${COLUMN_LABELS[c]} ${s.by_column[c]}`).join(', ')}
          >
            {s.total === 0 && <span className="pipe-empty">No cards yet</span>}
            {COLS.map((c) => s.by_column[c] > 0 && (
              <span
                key={c}
                className={`pipe-seg pipe-${c}`}
                style={{ flex: s.by_column[c] }}
                title={`${COLUMN_LABELS[c]} · ${s.by_column[c]} of ${s.total} (${Math.round((s.by_column[c] / s.total) * 100)}%)`}
              >
                {s.by_column[c]}
              </span>
            ))}
          </div>
          <div className="pipeline-legend">
            {COLS.map((c) => (
              <span key={c} className="pipe-key">
                <i className={`pipe-dot pipe-${c}`} />{COLUMN_LABELS[c]} <b>{s.by_column[c]}</b>
              </span>
            ))}
            <span className="spacer" />
            <span className="pipeline-facts">
              {s.total} cards · {s.open} open
              {s.flagged > 0 && ` · ${s.flagged} flagged`}
              {s.checks_total > 0 && ` · checklist ${s.checks_done}/${s.checks_total}`}
              {` · ${s.percent_done}% done`}
            </span>
          </div>
        </div>

        {/* Details on the left, the update log on the right; they stack on a narrow window. */}
        <div className="project-grid">
        <div className="project-details">
        <h3>Details</h3>
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
          <label>About this project</label>
          <textarea
            className="textarea"
            style={{ minHeight: 84 }}
            value={description}
            placeholder="What is this project? Anything worth remembering."
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="field">
          <label>GitHub repo</label>
          <div className="repo-row">
            <input
              className="input"
              value={repoUrl}
              placeholder="https://github.com/you/your-repo"
              onChange={(e) => setRepoUrl(e.target.value)}
            />
            {/^https?:\/\//.test(data.repo_url || '') && (
              <a className="btn" href={data.repo_url} target="_blank" rel="noreferrer noopener">Open</a>
            )}
          </div>
        </div>

        <div className="field">
          <label>Links</label>
          <LinkList
            kind="link"
            rows={data.links || []}
            placeholderLabel="Name, e.g. Staging"
            placeholderValue="https://…"
            onAdd={async (row) => { await api.addLink(data.id, row); await refresh(); }}
            onRemove={async (id) => { await api.deleteLink(id); await refresh(); }}
          />
        </div>

        <div className="field">
          <label>Contacts</label>
          <LinkList
            kind="contact"
            rows={data.contacts || []}
            placeholderLabel="Who, e.g. Dana"
            placeholderValue="mailto:dana@… or a phone number"
            onAdd={async (row) => { await api.addLink(data.id, row); await refresh(); }}
            onRemove={async (id) => { await api.deleteLink(id); await refresh(); }}
          />
        </div>
        </div>

        <div className="project-log">
        <h3>History</h3>
        <div className="field">
          <div className="field-head">
            <label>Update log</label>
            <span className="spacer" />
            <button className="btn btn-ghost btn-xs" onClick={copyLog} title="Copy the log as Markdown">
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button className="btn btn-ghost btn-xs" onClick={downloadLog} title="Save the log as a .md file">
              Download
            </button>
          </div>
          <div className="log-add">
            <textarea
              className="textarea"
              style={{ minHeight: 52 }}
              value={note}
              placeholder="What happened? Enter to save, Shift+Enter for a new line."
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const text = note.trim();
                  if (!text) return;
                  setNote('');
                  await api.addUpdate(data.id, text);
                  await refresh();
                }
              }}
            />
          </div>
          {(data.updates || []).length === 0 ? (
            <p className="dialog-msg" style={{ margin: '8px 0 0' }}>No updates yet.</p>
          ) : (
            <div className="log">
              {data.updates.map((u) => (
                <div key={u.id} className="log-row">
                  <div className="log-when">
                    {u.created_at}
                    {u.actor && u.actor !== 'you' && <><br /><b>{u.actor}</b></>}
                  </div>
                  <div className="log-text">{u.text}</div>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '0 6px' }}
                    title="Remove this entry"
                    onClick={async () => { await api.deleteUpdate(u.id); await refresh(); }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        </div>
        </div>


        {/* All five columns in one row, each scrolling on its own past a few cards,
            so a project with sixty cards takes the same room as one with five. */}
        <div className="field">
          <label>Cards</label>
          <div className="project-cards">
            {COLS.map((c) => {
              const inCol = data.cards.filter((card) => card.column_key === c);
              return (
                <div key={c} className="project-col">
                  <div className="project-col-head">{COLUMN_LABELS[c]} · {inCol.length}</div>
                  <div className="project-col-list">
                    {inCol.length === 0 && <span className="project-col-empty">—</span>}
                    {inCol.map((card) => (
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
                </div>
              );
            })}
          </div>
        </div>
        <p className="dialog-msg" style={{ marginBottom: 0 }}>
          Created {data.created_at}. Last change {s.last_activity}.
        </p>

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Delete project</button>
          <button className="btn" onClick={() => setConfirmArchive(true)}>Archive project</button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={!changed || !name.trim()} onClick={save}>Save</button>
        </div>
      </div>

      {confirmArchive && (
        <Dialog
          kind="confirm"
          title={`Archive "${data.name}"?`}
          message={
            `The row leaves the board${s.total ? ` with its ${s.total} card${s.total === 1 ? '' : 's'}` : ''}. ` +
            'Nothing is deleted — you can bring it back from the Archive.'
          }
          confirmLabel="Archive"
          onCancel={() => setConfirmArchive(false)}
          onConfirm={async () => {
            setConfirmArchive(false);
            try {
              await api.updateProject(data.id, { archived: true });
              onDeleted();
              onClose();
            } catch (e) {
              setError(e.message);
            }
          }}
        />
      )}

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
