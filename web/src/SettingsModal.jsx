import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Logo } from './Logo.jsx';
import { LabelEditor } from './LabelEditor.jsx';

/**
 * Everything that is not day-to-day board work lives here, so the top bar can
 * stay down to navigation and search.
 */
export function SettingsModal({
  theme, setTheme,
  compact, setCompact,
  rowCap, setRowCap,
  allFolded, onFoldAll,
  board, onRenameBoard, onDeleteBoard, boardCount,
  boardId, labels, onLabelsSaved,
  onOpenArchive, onOpenKeys, onLogout, onClose,
}) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let alive = true;
    api.about().then((d) => alive && setInfo(d)).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal modal-sm settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <section className="set-block">
          <h3>Look</h3>

          <div className="set-row">
            <span>Theme</span>
            <div className="seg">
              <button
                className={theme === 'light' ? 'on' : ''}
                onClick={() => setTheme('light')}
              >
                ☀ Day
              </button>
              <button
                className={theme === 'dark' ? 'on' : ''}
                onClick={() => setTheme('dark')}
              >
                ☾ Night
              </button>
            </div>
          </div>

          <div className="set-row">
            <span>Card size</span>
            <div className="seg">
              <button className={compact ? 'on' : ''} onClick={() => setCompact(true)}>Compact</button>
              <button className={!compact ? 'on' : ''} onClick={() => setCompact(false)}>Roomy</button>
            </div>
          </div>

          <div className="set-row">
            <span>Row height <b>{rowCap}px</b></span>
            <input
              type="range"
              min="120" max="640" step="40"
              value={rowCap}
              onChange={(e) => setRowCap(Number(e.target.value))}
            />
          </div>
          <p className="set-hint">How tall a row grows before its columns scroll.</p>

          <div className="set-row">
            <span>All rows</span>
            <button className="btn" onClick={onFoldAll}>
              {allFolded ? 'Open all' : 'Fold all'}
            </button>
          </div>
        </section>

        <section className="set-block">
          <h3>This board</h3>
          <div className="set-row">
            <span>{board?.name || '—'}</span>
            <span className="set-actions">
              <button className="btn" onClick={onRenameBoard}>Rename</button>
              <button
                className="btn btn-danger"
                disabled={boardCount <= 1}
                title={boardCount <= 1 ? 'This is your only board' : 'Delete this board'}
                onClick={onDeleteBoard}
              >
                Delete
              </button>
            </span>
          </div>
        </section>

        <section className="set-block">
          <h3>Labels</h3>
          <LabelEditor boardId={boardId} labels={labels} onSaved={onLabelsSaved} />
        </section>

        <section className="set-block">
          <h3>Cards and agents</h3>
          <div className="set-row">
            <span>Archived cards</span>
            <button className="btn" onClick={onOpenArchive}>Open archive</button>
          </div>
          <div className="set-row">
            <span>Agent keys</span>
            <button className="btn" onClick={onOpenKeys}>Manage keys</button>
          </div>
          <p className="set-hint">
            Each agent gets its own key you can revoke. An agent can archive a
            card but never delete one.
          </p>
        </section>

        <section className="set-block">
          <h3>About</h3>
          <div className="about-head" style={{ marginBottom: 10 }}>
            <Logo size={34} />
            <div>
              <b>Pandan</b>
              <div className="about-sub">
                {info ? `Version ${info.version} · ${info.license}` : 'Loading…'}
              </div>
            </div>
          </div>
          {info?.repo ? (
            <div className="about-links">
              <a className="btn" href={info.repo} target="_blank" rel="noreferrer noopener">Source</a>
              <a className="btn" href={info.issues} target="_blank" rel="noreferrer noopener">Report a bug</a>
              <a className="btn" href={info.contributing} target="_blank" rel="noreferrer noopener">Contribute</a>
            </div>
          ) : (
            <p className="set-hint" style={{ margin: 0 }}>
              Open source under {info?.license || 'MIT'}.
            </p>
          )}
        </section>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onLogout}>Log out</button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
