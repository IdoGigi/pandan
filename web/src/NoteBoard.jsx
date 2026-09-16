import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Dialog } from './Dialog.jsx';
import { CARD_COLORS } from './Card.jsx';
import { SWATCH, NAMES } from './ContextMenu.jsx';

/**
 * Loose sticky notes for one board — a cork board next to the kanban.
 * `tick` changes whenever the server reports a change, so notes another tab
 * or an agent wrote show up here too.
 */
export function NoteBoard({ boardId, tick, onError }) {
  const [notes, setNotes] = useState(null);
  const [deleting, setDeleting] = useState(null);

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

  /** Sends one change to the server and keeps the list in step with the reply. */
  const change = async (note, patch) => {
    try {
      const saved = await api.updateNote(note.id, patch);
      setNotes((list) => list.map((n) => (n.id === saved.id ? saved : n)));
    } catch (e) {
      onError(e.message);
    }
  };

  const remove = async (note) => {
    setDeleting(null);
    try {
      await api.deleteNote(note.id);
      setNotes((list) => list.filter((n) => n.id !== note.id));
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
          notes.map((note) => (
            <Note
              key={note.id}
              note={note}
              onChange={(patch) => change(note, patch)}
              onDelete={() => setDeleting(note)}
            />
          ))
        )}
      </div>

      {deleting && (
        <Dialog
          kind="confirm"
          title="Delete this note?"
          message={deleting.text.trim()
            ? `"${deleting.text.trim().slice(0, 80)}${deleting.text.trim().length > 80 ? '…' : ''}" will be gone. Notes have no archive.`
            : 'The note is empty. It will be gone.'}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        />
      )}
    </div>
  );
}

const SAVE_AFTER_MS = 600;

/**
 * A field you type into that saves a moment after you stop, and at once when
 * you leave it. Text that arrives from the server (another tab, an agent)
 * replaces the draft — unless you are in the middle of typing here.
 */
function useDraft(value, onSave) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);

  const save = useCallback((text) => {
    clearTimeout(timer.current);
    dirty.current = false;
    if (text !== value) onSave(text);
  }, [value, onSave]);

  const type = (text) => {
    setDraft(text);
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(text), SAVE_AFTER_MS);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  return { draft, type, save: () => save(draft) };
}

/** One sticky note: colour dots and a delete cross on top, then a title and the text. */
function Note({ note, onChange, onDelete }) {
  const title = useDraft(note.title || '', (t) => onChange({ title: t }));
  const text = useDraft(note.text, (t) => onChange({ text: t }));

  // Drag anywhere on the paper (not the text or the buttons) to move the note.
  // The position is local while dragging and saved once, on release.
  const [drag, setDrag] = useState(null);
  const startDrag = (e) => {
    if (e.button !== 0 && e.button !== undefined) return;
    if (e.target.closest('button, textarea, input')) return;
    const startX = e.clientX ?? 0;
    const startY = e.clientY ?? 0;
    const from = { x: note.x, y: note.y };
    let pos = from;
    const move = (ev) => {
      pos = {
        x: Math.max(0, from.x + (ev.clientX ?? 0) - startX),
        y: Math.max(0, from.y + (ev.clientY ?? 0) - startY),
      };
      setDrag(pos);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      setDrag(null);
      if (pos.x !== from.x || pos.y !== from.y) onChange({ x: pos.x, y: pos.y });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    e.preventDefault();
  };
  const left = drag ? drag.x : note.x;
  const top = drag ? drag.y : note.y;

  return (
    <div
      className={`note ${note.color || 'amber'}${drag ? ' dragging' : ''}`}
      style={{ left, top }}
      onPointerDown={startDrag}
    >
      <div className="note-head">
        <div className="note-colors">
          {CARD_COLORS.map((c) => (
            <button
              key={c}
              className={`note-swatch${note.color === c ? ' on' : ''}`}
              style={{ background: SWATCH[c] }}
              title={NAMES[c]}
              aria-label={NAMES[c]}
              onClick={() => note.color !== c && onChange({ color: c })}
            />
          ))}
        </div>
        <button className="note-delete" title="Delete note" aria-label="Delete note" onClick={onDelete}>
          ×
        </button>
      </div>
      <input
        className="note-title"
        value={title.draft}
        placeholder="Title"
        maxLength={120}
        onChange={(e) => title.type(e.target.value)}
        onBlur={title.save}
      />
      <textarea
        className="note-input"
        value={text.draft}
        placeholder="Write something…"
        maxLength={2000}
        onChange={(e) => text.type(e.target.value)}
        onBlur={text.save}
      />
    </div>
  );
}
