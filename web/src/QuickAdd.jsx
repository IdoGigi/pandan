import { useRef, useState } from 'react';
import { api } from './api.js';
import { COLUMN_LABELS } from './Board.jsx';

const ADD_TO = ['todo', 'next', 'doing'];
const key = (boardId) => `kanban.quickAdd.${boardId}`;

/** The project last picked on this board, or null. Storage can be off (private mode), so it may forget. */
function remembered(boardId) {
  try {
    return JSON.parse(localStorage.getItem(key(boardId)));
  } catch {
    return null;
  }
}
function remember(boardId, projectId) {
  try {
    localStorage.setItem(key(boardId), JSON.stringify(projectId));
  } catch {
    // Not remembered this time; the add itself still works.
  }
}

/**
 * Adds a card in one line: project, column, title, Enter. The title clears and
 * keeps focus, so several cards go in one after another. The browser remembers
 * the last project per board; if that project has gone, the first one is used.
 */
export function QuickAdd({ boardId, projects, onAdded, onError }) {
  const [picked, setPicked] = useState(() => remembered(boardId));
  const [column, setColumn] = useState('todo');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const field = useRef(null);
  const projectId = projects.some((p) => p.id === picked) ? picked : projects[0]?.id;

  const pick = (id) => {
    setPicked(id);
    remember(boardId, id);
  };

  const add = async (e) => {
    e.preventDefault();
    const text = title.trim();
    if (!text || busy || projectId === undefined) return;
    setBusy(true);
    try {
      await api.createCard({ project_id: projectId, column_key: column, title: text });
      setTitle('');
      onAdded();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  };

  if (!projects.length) {
    return <p className="dash-block dash-empty">Add a project on the board first, then add cards to it here.</p>;
  }
  return (
    <form className="dash-block quick-add" aria-label="Add a card" onSubmit={add}>
      <select className="select" aria-label="Project" value={projectId} onChange={(e) => pick(Number(e.target.value))}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select className="select" aria-label="Column" value={column} onChange={(e) => setColumn(e.target.value)}>
        {ADD_TO.map((col) => <option key={col} value={col}>{COLUMN_LABELS[col]}</option>)}
      </select>
      {/* Never disabled while adding: a disabled field would drop the focus the next card needs. */}
      <input ref={field} type="text" className="input" aria-label="New card title" placeholder="Add a card…"
        value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>Add</button>
    </form>
  );
}
