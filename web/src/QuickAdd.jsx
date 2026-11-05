import { useRef, useState } from 'react';
import { api } from './api.js';
import { COLUMN_LABELS } from './Board.jsx';
import { readSetting, writeSetting } from './settings.js';

const ADD_TO = ['todo', 'next', 'doing'];
const key = (boardId) => `quickAdd.${boardId}`;

/**
 * Adds a card in one line: project, column, title, Enter. The title clears and
 * keeps focus, so several cards go in one after another. The browser remembers
 * the last project per board; if that project has gone, the first one is used.
 */
export function QuickAdd({ boardId, projects, onAdded, onError }) {
  const [picked, setPicked] = useState(() => readSetting(key(boardId), null));
  const [column, setColumn] = useState('todo');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useRef(null);
  const field = useRef(null);
  const projectId = projects.some((p) => p.id === picked) ? picked : projects[0]?.id;

  const pick = (id) => {
    setPicked(id);
    writeSetting(key(boardId), id);
  };

  // One at a time. An Enter while one is on its way leaves its title in the field, to add next.
  const add = async (e) => {
    e.preventDefault();
    const sent = title;
    const text = sent.trim();
    if (!text || busy || projectId === undefined) return;
    setBusy(true);
    try {
      await api.createCard({ project_id: projectId, column_key: column, title: text });
      // Only what was sent goes: a title typed meanwhile stays.
      setTitle((now) => (now === sent ? '' : now));
      onAdded();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
      // Back to the title for the next card, unless focus has moved on (to an editor, say).
      const now = document.activeElement;
      if (!now || now === document.body || form.current?.contains(now)) field.current?.focus();
    }
  };

  if (!projects.length) {
    return <p className="dash-block dash-empty">Add a project on the board first, then add cards to it here.</p>;
  }
  return (
    <form ref={form} className="dash-block quick-add" aria-label="Add a card" onSubmit={add}>
      <select className="select quick-add-project" aria-label="Project" value={projectId}
        onChange={(e) => pick(Number(e.target.value))}>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select className="select quick-add-column" aria-label="Column" value={column} onChange={(e) => setColumn(e.target.value)}>
        {ADD_TO.map((col) => <option key={col} value={col}>{COLUMN_LABELS[col]}</option>)}
      </select>
      {/* Never disabled while adding: a disabled field would drop the focus the next card needs. */}
      <input ref={field} type="text" className="input" aria-label="New card title" placeholder="Add a card…"
        value={title} onChange={(e) => setTitle(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>Add</button>
    </form>
  );
}
