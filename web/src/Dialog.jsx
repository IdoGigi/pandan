import { useEffect, useRef, useState } from 'react';

/**
 * In-app replacement for window.prompt and window.confirm.
 * `kind` is 'prompt' (asks for text) or 'confirm' (just asks).
 * Enter accepts, Escape cancels, and focus starts in the right place.
 */
export function Dialog({
  kind = 'confirm',
  title,
  message,
  initialValue = '',
  placeholder = '',
  confirmLabel = 'OK',
  danger = false,
  onConfirm,
  onCancel,
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);
  const okRef = useRef(null);

  useEffect(() => {
    const el = kind === 'prompt' ? inputRef.current : okRef.current;
    el?.focus();
    if (kind === 'prompt') inputRef.current?.select();
  }, [kind]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function accept() {
    if (kind === 'prompt') {
      const text = value.trim();
      if (!text) return;
      onConfirm(text);
    } else {
      onConfirm();
    }
  }

  return (
    // stopPropagation matters when this sits inside another modal's overlay
    <div className="overlay" onMouseDown={(e) => { e.stopPropagation(); onCancel(); }}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {message && <p className="dialog-msg">{message}</p>}

        {kind === 'prompt' && (
          <input
            ref={inputRef}
            className="input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                accept();
              }
            }}
          />
        )}

        <div className="modal-actions">
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            ref={okRef}
            className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`}
            disabled={kind === 'prompt' && !value.trim()}
            onClick={accept}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
