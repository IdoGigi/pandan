import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Logo } from './Logo.jsx';

export function AboutModal({ onClose }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.about()
      .then((d) => alive && setInfo(d))
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal modal-sm about" onMouseDown={(e) => e.stopPropagation()}>
        <div className="about-head">
          <Logo size={46} />
          <div>
            <h2>Pandan</h2>
            <div className="about-sub">
              {info ? `Version ${info.version}` : error ? 'Could not load details' : 'Loading…'}
            </div>
          </div>
        </div>

        <p className="dialog-msg">
          A small kanban board you run yourself, with an MCP server so your
          agents can read and write it. Rows are projects, columns are what is
          left, what is next, what you are on, and what is finished.
        </p>

        {info && (
          <>
            <div className="about-rows">
              <div><span>Licence</span><b>{info.license}</b></div>
              <div><span>Runtime</span><b>Node {info.node}</b></div>
              <div><span>On this board</span><b>{info.counts.projects} projects · {info.counts.cards} cards</b></div>
            </div>

            {info.repo ? (
              <div className="about-links">
                <a className="btn" href={info.repo} target="_blank" rel="noreferrer noopener">Source code</a>
                <a className="btn" href={info.issues} target="_blank" rel="noreferrer noopener">Report a bug</a>
                <a className="btn" href={info.contributing} target="_blank" rel="noreferrer noopener">Contribute</a>
              </div>
            ) : (
              <p className="dialog-msg" style={{ margin: '4px 0 0' }}>
                Open source under {info.license}. Set <code>repository</code> in
                <code> package.json</code> to show links here.
              </p>
            )}

            <p className="about-foot">
              Built to be small enough to read. Patches and bug reports welcome —
              see <code>CONTRIBUTING.md</code>.
            </p>
          </>
        )}

        {error && <div className="error">{error}</div>}

        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
