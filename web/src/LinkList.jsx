import { useState } from 'react';

/**
 * The links and the contacts on a project are the same shape, so one component
 * does both. `kind` is 'link' or 'contact'.
 */
export function LinkList({ kind, rows, placeholderLabel, placeholderValue, onAdd, onRemove }) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');

  function submit() {
    if (!label.trim() || !value.trim()) return;
    onAdd({ kind, label: label.trim(), value: value.trim() });
    setLabel('');
    setValue('');
  }

  return (
    <div className="link-list">
      {rows.map((row) => (
        <div key={row.id} className="link-row">
          <span className="link-label">{row.label}</span>
          {row.href ? (
            <a className="link-value" href={row.href} target="_blank" rel="noreferrer noopener">
              {row.value}
            </a>
          ) : (
            <span className="link-value plain">{row.value}</span>
          )}
          <button
            className="btn btn-ghost"
            style={{ padding: '0 6px' }}
            title="Remove"
            onClick={() => onRemove(row.id)}
          >
            ×
          </button>
        </div>
      ))}

      <div className="link-add">
        <input
          className="input"
          value={label}
          placeholder={placeholderLabel}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
        />
        <input
          className="input"
          value={value}
          placeholder={placeholderValue}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
        />
        <button className="btn" disabled={!label.trim() || !value.trim()} onClick={submit}>Add</button>
      </div>
    </div>
  );
}
