import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Dialog } from './Dialog.jsx';
import { CARD_COLORS } from './Card.jsx';
import { SWATCH, NAMES } from './ContextMenu.jsx';
import { renderMarks, stripMarks } from './marks.jsx';

/**
 * Loose sticky notes for one board — a cork board next to the kanban.
 * `tick` changes whenever the server reports a change, so notes another tab
 * or an agent wrote show up here too.
 */
export function NoteBoard({ boardId, tick, onError }) {
  const [notes, setNotes] = useState(null);
  const [deleting, setDeleting] = useState(null);
  // The note just added here opens straight into its editor; nothing else does.
  const [freshId, setFreshId] = useState(null);

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
      setFreshId(note.id);
      setNotes((list) => [...(list || []), note]);
    } catch (e) {
      onError(e.message);
    }
  };

  /**
   * Shows a change at once, then sends it. A dropped note must not jump back
   * to its old spot while the server is answering. If the save fails, the
   * list is re-read so the screen is true again.
   */
  const change = async (note, patch) => {
    setNotes((list) => list.map((n) => (n.id === note.id ? { ...n, ...patch } : n)));
    try {
      const saved = await api.updateNote(note.id, patch);
      setNotes((list) => list.map((n) => (n.id === saved.id ? saved : n)));
    } catch (e) {
      onError(e.message);
      load();
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
              fresh={note.id === freshId}
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
          message={(() => {
            const words = (deleting.title || stripMarks(deleting.text)).trim();
            return words
              ? `"${words.slice(0, 80)}${words.length > 80 ? '…' : ''}" will be gone. Notes have no archive.`
              : 'The note is empty. It will be gone.';
          })()}
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
function Note({ note, fresh = false, onChange, onDelete }) {
  const title = useDraft(note.title || '', (t) => onChange({ title: t }));
  const text = useDraft(note.text, (t) => onChange({ text: t }));

  // A note shows its text formatted until you click it. Only a note you just
  // added opens in the editor by itself — a note with a title and no text
  // must not keep its toolbar open every time the board loads.
  const [editing, setEditing] = useState(fresh);
  const inputRef = useRef(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  const stopEditing = () => {
    text.save();
    setEditing(false);
  };

  // The toolbar edits the draft around the selection, then puts the caret
  // back once React has shown the new text.
  const pendingCaret = useRef(null);
  useEffect(() => {
    if (!pendingCaret.current || !inputRef.current) return;
    const [start, end] = pendingCaret.current;
    pendingCaret.current = null;
    inputRef.current.focus();
    inputRef.current.setSelectionRange(start, end);
  }, [text.draft]);

  const mark = (which) => {
    const el = inputRef.current;
    if (!el) return;
    const v = text.draft;
    const s = el.selectionStart ?? v.length;
    const e = el.selectionEnd ?? s;
    let next;
    if (which === 'list') {
      // Bullets work on whole lines: every selected line gets "- ", or loses it if all have it.
      const from = v.lastIndexOf('\n', s - 1) + 1;
      const nl = v.indexOf('\n', e);
      const to = nl === -1 ? v.length : nl;
      const lines = v.slice(from, to).split('\n');
      const all = lines.every((l) => l.startsWith('- '));
      const block = lines.map((l) => (all ? l.slice(2) : l.startsWith('- ') ? l : `- ${l}`)).join('\n');
      next = v.slice(0, from) + block + v.slice(to);
      pendingCaret.current = [from, from + block.length];
    } else {
      const n = which.length;
      const sel = v.slice(s, e);
      if (sel.length >= n * 2 && sel.startsWith(which) && sel.endsWith(which)) {
        // The marks are inside the selection: take them off.
        const inner = sel.slice(n, -n);
        next = v.slice(0, s) + inner + v.slice(e);
        pendingCaret.current = [s, s + inner.length];
      } else if (v.slice(s - n, s) === which && v.slice(e, e + n) === which) {
        // The marks sit just around the selection, as they do right after wrapping: take them off.
        next = v.slice(0, s - n) + sel + v.slice(e + n);
        pendingCaret.current = [s - n, e - n];
      } else {
        next = `${v.slice(0, s)}${which}${sel}${which}${v.slice(e)}`;
        pendingCaret.current = [s + n, e + n];
      }
    }
    text.type(next);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') return e.currentTarget.blur();
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'b') { e.preventDefault(); mark('**'); }
    else if (key === 'u') { e.preventDefault(); mark('__'); }
  };

  // Drag anywhere on the paper (not the fields or the buttons) to move the
  // note. The position is local while dragging and saved once, on release.
  // A press on the shown text that does not move opens the editor instead.
  const [drag, setDrag] = useState(null);
  const startDrag = (e) => {
    if (e.button !== 0 && e.button !== undefined) return;
    if (e.target.closest('button, textarea, input')) return;
    const onText = Boolean(e.target.closest('.note-view'));
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
      else if (onText) setEditing(true);
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
      {editing ? (
        <>
          {/* mousedown is stopped so a click here never takes focus from the text */}
          <div className="note-tools" onMouseDown={(e) => e.preventDefault()}>
            <button className="note-tool" title="Bold (Ctrl+B)" onClick={() => mark('**')}><b>B</b></button>
            <button className="note-tool" title="Underline (Ctrl+U)" onClick={() => mark('__')}><u>U</u></button>
            <button className="note-tool" title="Strike through" onClick={() => mark('~~')}><s>S</s></button>
            <button className="note-tool" title="Bullet list" onClick={() => mark('list')}>• List</button>
          </div>
          <textarea
            ref={inputRef}
            className="note-input"
            value={text.draft}
            placeholder="Write something…"
            maxLength={2000}
            onChange={(e) => text.type(e.target.value)}
            onBlur={stopEditing}
            onKeyDown={onKey}
          />
        </>
      ) : (
        <div className="note-view">{renderMarks(text.draft)}</div>
      )}
    </div>
  );
}
