import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Loose sticky notes for one board — a cork board next to the kanban.
 * `tick` changes whenever the server reports a change, so notes another tab
 * or an agent wrote show up here too.
 */
export function NoteBoard({ boardId, tick, onError }) {
  const [notes, setNotes] = useState(null);

  const load = useCallback(() => {
    if (!boardId) return;
    api.notes(boardId).then(setNotes).catch((e) => onError(e.message));
  }, [boardId, onError]);
  useEffect(() => { load(); }, [load, tick]);

  const add = async () => {
    // Each new note lands a little lower and to the right of the last one,
    // so a burst of new notes never stacks into one pile.
    const step = ((notes?.length ?? 0) % 8) * 28;
    try {
      const note = await api.addNote(boardId, { x: 24 + step, y: 24 + step });
      setNotes((list) => [...(list || []), note]);
    } catch (e) {
      onError(e.message);
    }
  };

  return (
    <div className="noteboard-wrap">
      <div className="noteboard-bar">
        <button className="btn" onClick={add}>+ Note</button>
        <span className="set-hint">
          {notes ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      <div className="noteboard">
        {notes === null ? (
          <div className="center-note">Loading…</div>
        ) : notes.length === 0 ? (
          <div className="center-note">No notes yet. Use “+ Note” to add one.</div>
        ) : (
          notes.map((note) => <Note key={note.id} note={note} />)
        )}
      </div>
    </div>
  );
}

function Note({ note }) {
  return (
    <div className={`note ${note.color || 'amber'}`} style={{ left: note.x, top: note.y }}>
      <div className="note-text">{note.text}</div>
    </div>
  );
}
