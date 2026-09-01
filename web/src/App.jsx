import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Board } from './Board.jsx';
import { CardModal } from './CardModal.jsx';
import { ProjectModal } from './ProjectModal.jsx';
import { Login } from './Login.jsx';
import { Dialog } from './Dialog.jsx';
import { CardMenu } from './ContextMenu.jsx';
import { Logo } from './Logo.jsx';

const PROJECT_COLORS = ['#c3d117', '#4bb3d4', '#f0b429', '#e2725b', '#9b8ec4', '#57a773'];

/** View settings live in the browser. Reading them can throw, so never trust it. */
function readSetting(key, fallback) {
  try {
    const raw = localStorage.getItem(`kanban.${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeSetting(key, value) {
  try {
    localStorage.setItem(`kanban.${key}`, JSON.stringify(value));
  } catch {
    /* private window, or storage blocked — the board still works */
  }
}

export function App() {
  const [authed, setAuthed] = useState(null); // null = still checking
  const [projects, setProjects] = useState([]);
  const [cards, setCards] = useState([]);
  const [focus, setFocus] = useState('all');
  const [openCardId, setOpenCardId] = useState(null);
  const [openProjectId, setOpenProjectId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [menu, setMenu] = useState(null);
  const [compact, setCompact] = useState(() => readSetting('compact', true));
  const [rowCap, setRowCap] = useState(() => readSetting('rowCap', 240));
  const [collapsed, setCollapsed] = useState(() => new Set(readSetting('collapsed', [])));
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.board();
      setProjects(data.projects);
      setCards(data.cards);
      setAuthed(true);
    } catch (err) {
      if (err.unauthorized) setAuthed(false);
      else setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Keep the board in step with the server. The stream sends a ping whenever
   * anything changes — from another tab, another device, or an agent — and we
   * re-read the board. EventSource reconnects on its own if the link drops.
   */
  useEffect(() => {
    if (authed !== true) return undefined;
    // Very old browsers have no EventSource. The board still works, it just
    // will not update on its own.
    if (typeof EventSource === 'undefined') return undefined;

    const stream = new EventSource('/api/events');
    stream.addEventListener('hello', () => setLive(true));
    stream.addEventListener('change', () => { load(); });
    stream.onerror = () => setLive(false);
    stream.onopen = () => setLive(true);

    // A tab that slept can miss pings, so re-read when it comes back.
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stream.close();
      document.removeEventListener('visibilitychange', onVisible);
      setLive(false);
    };
  }, [authed, load]);

  useEffect(() => { writeSetting('compact', compact); }, [compact]);
  useEffect(() => { writeSetting('rowCap', rowCap); }, [rowCap]);
  useEffect(() => { writeSetting('collapsed', [...collapsed]); }, [collapsed]);

  function toggleRow(id) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  /** Run a write, but keep the UI honest: reload from the server, and roll back if it failed. */
  const commit = useCallback(async (fn, rollback) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      if (err.unauthorized) setAuthed(false);
      else {
        setError(err.message);
        rollback?.();
      }
    } finally {
      setBusy(false);
    }
  }, [load]);

  function addCard(projectId, columnKey, title) {
    const temp = {
      id: `tmp-${Date.now()}`, project_id: projectId, column_key: columnKey,
      title, notes: '', color: 'plain', flagged: 0,
      position: Number.MAX_SAFE_INTEGER, checks_total: 0, checks_done: 0,
    };
    const before = cards;
    setCards((list) => [...list, temp]);
    commit(() => api.createCard({ project_id: projectId, column_key: columnKey, title }),
      () => setCards(before));
  }

  /** Reorder locally first so the drop feels instant, then confirm with the server. */
  function dropCard(card, projectId, columnKey, index) {
    const before = cards;
    const others = cards.filter((c) => c.id !== card.id);
    const target = others
      .filter((c) => c.project_id === projectId && c.column_key === columnKey)
      .sort((a, b) => a.position - b.position);

    const prev = target[index - 1]?.position;
    const next = target[index]?.position;
    const position =
      prev === undefined && next === undefined ? 1000
      : prev === undefined ? next - 1000
      : next === undefined ? prev + 1000
      : (prev + next) / 2;

    setCards([...others, { ...card, project_id: projectId, column_key: columnKey, position }]);
    commit(() => api.moveCard(card.id, { project_id: projectId, column_key: columnKey, index }),
      () => setCards(before));
  }

  /** Right-click edits show at once, then go to the server. */
  function quickEdit(card, patch) {
    const before = cards;
    setCards((list) => list.map((c) => (c.id === card.id ? { ...c, ...patch } : c)));
    commit(() => api.updateCard(card.id, patch), () => setCards(before));
  }

  function addProject() {
    setDialog({
      kind: 'prompt',
      title: 'New project',
      placeholder: 'Project name',
      confirmLabel: 'Add project',
      onConfirm: (name) => {
        setDialog(null);
        const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
        commit(() => api.createProject({ name, color }));
      },
    });
  }

  if (authed === null) return <div className="center-note">Loading…</div>;
  if (authed === false) return <Login onSuccess={load} />;

  const shown = focus === 'all' ? projects : projects.filter((p) => p.id === Number(focus));

  return (
    <div className="app">
      <div className="topbar">
        <h1><Logo /> Pandan</h1>
        <select className="filter-select" value={focus} onChange={(e) => setFocus(e.target.value)}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn" onClick={addProject}>+ Project</button>
        <button
          className="btn"
          onClick={() => setCompact((c) => !c)}
          title="Switch between tight rows and roomy ones"
        >
          {compact ? 'Compact' : 'Roomy'}
        </button>
        <label className="cap">
          rows
          <input
            type="range"
            min="120" max="640" step="40"
            value={rowCap}
            onChange={(e) => setRowCap(Number(e.target.value))}
            title="How tall a row can grow before it scrolls"
          />
        </label>
        <button
          className="btn btn-ghost"
          onClick={() => setCollapsed((prev) =>
            prev.size === projects.length ? new Set() : new Set(projects.map((p) => p.id)))}
        >
          {collapsed.size === projects.length && projects.length > 0 ? 'Open all' : 'Fold all'}
        </button>
        <span className={`saving${busy ? ' on' : ''}`}>Saving…</span>
        <span className={`live${live ? ' on' : ''}`} title={live ? 'Updating live' : 'Reconnecting…'}>
          <i /> {live ? 'live' : 'offline'}
        </span>
        {error && <span className="error" style={{ margin: 0 }}>{error}</span>}
        <span className="spacer" />
        <button
          className="btn btn-ghost"
          onClick={async () => { await api.logout(); setAuthed(false); }}
        >
          Log out
        </button>
      </div>

      <div className="board-scroll">
        {shown.length === 0 ? (
          <div className="center-note">No projects yet. Use “+ Project” to add one.</div>
        ) : (
          <Board
            projects={shown}
            cards={cards}
            compact={compact}
            rowCap={rowCap}
            collapsed={collapsed}
            onToggleRow={toggleRow}
            onOpenCard={(card) => typeof card.id === 'number' && setOpenCardId(card.id)}
            onCardMenu={(card, x, y) => {
              if (typeof card.id === 'number') setMenu({ card, x, y });
            }}
            onOpenProject={setOpenProjectId}
            onAddCard={addCard}
            onDropCard={dropCard}
          />
        )}
      </div>

      {menu && (
        <CardMenu
          x={menu.x}
          y={menu.y}
          card={cards.find((c) => c.id === menu.card.id) || menu.card}
          onClose={() => setMenu(null)}
          onPickColor={(color) => { quickEdit(menu.card, { color }); setMenu(null); }}
          onToggleFlag={() => {
            quickEdit(menu.card, { flagged: menu.card.flagged ? 0 : 1 });
            setMenu(null);
          }}
        />
      )}

      {dialog && <Dialog {...dialog} onCancel={() => setDialog(null)} />}

      {openProjectId && (
        <ProjectModal
          projectId={openProjectId}
          onClose={() => setOpenProjectId(null)}
          onSaved={load}
          onDeleted={load}
          onOpenCard={(id) => { setOpenProjectId(null); setOpenCardId(id); }}
        />
      )}

      {openCardId && (
        <CardModal
          cardId={openCardId}
          projects={projects}
          onClose={() => setOpenCardId(null)}
          onSaved={load}
          onDeleted={load}
        />
      )}
    </div>
  );
}
