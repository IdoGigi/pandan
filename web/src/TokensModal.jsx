import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Dialog } from './Dialog.jsx';

const when = (value) => (value ? value.replace('T', ' ').slice(0, 16) : 'never');

export function TokensModal({ onClose }) {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);   // shown once, right after making it
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.tokens().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !revoking && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, revoking]);

  async function create() {
    const label = name.trim();
    if (!label) return;
    try {
      const made = await api.createToken(label);
      setName('');
      setFresh(made);
      setCopied(false);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const live = (rows || []).filter((t) => !t.revoked_at);
  const dead = (rows || []).filter((t) => t.revoked_at);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Agent keys</h2>
        <p className="dialog-msg">
          Give each agent its own key. Revoking one stops that agent and nothing
          else — your own password keeps working. A key can use the board, but
          it can never see or make other keys.
        </p>

        {fresh && (
          <div className="token-new">
            <div className="token-new-head">
              Copy <b>{fresh.name}</b> now — this is the only time it is shown.
            </div>
            <div className="token-value">
              <code>{fresh.token}</code>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fresh.token);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                    setError('Could not copy. Select the key and copy it by hand.');
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button className="btn btn-ghost token-done" onClick={() => setFresh(null)}>
              I have saved it
            </button>
          </div>
        )}

        <div className="field">
          <label>New key</label>
          <div className="link-add">
            <input
              className="input"
              value={name}
              placeholder="What is it for, e.g. Claude Code on my laptop"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), create())}
            />
            <button className="btn btn-primary" disabled={!name.trim()} onClick={create}>Create</button>
          </div>
        </div>

        {rows === null ? (
          <div className="center-note">Loading…</div>
        ) : (
          <>
            <div className="field">
              <label>In use ({live.length})</label>
              {live.length === 0 ? (
                <p className="dialog-msg" style={{ margin: 0 }}>
                  No keys yet. Until you make one, agents use your board password.
                </p>
              ) : (
                <div className="token-list">
                  {live.map((t) => (
                    <div key={t.id} className="token-row">
                      <span className="token-name">{t.name}</span>
                      <code className="token-prefix">{t.prefix}…</code>
                      <span className="token-when">last used {when(t.last_used_at)}</span>
                      <button className="btn btn-danger" onClick={() => setRevoking(t)}>Revoke</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {dead.length > 0 && (
              <div className="field">
                <label>Revoked ({dead.length})</label>
                <div className="token-list">
                  {dead.map((t) => (
                    <div key={t.id} className="token-row dead">
                      <span className="token-name">{t.name}</span>
                      <code className="token-prefix">{t.prefix}…</code>
                      <span className="token-when">revoked {when(t.revoked_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>

      {revoking && (
        <Dialog
          kind="confirm"
          title={`Revoke "${revoking.name}"?`}
          message="That agent stops working straight away. Your own password is not affected."
          confirmLabel="Revoke"
          danger
          onCancel={() => setRevoking(null)}
          onConfirm={async () => {
            const target = revoking;
            setRevoking(null);
            try {
              await api.revokeToken(target.id);
              await load();
            } catch (e) {
              setError(e.message);
            }
          }}
        />
      )}
    </div>
  );
}
