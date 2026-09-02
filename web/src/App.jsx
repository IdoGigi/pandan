import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Board } from './Board.jsx';
import { CardModal } from './CardModal.jsx';
import { ProjectModal } from './ProjectModal.jsx';
import { Login } from './Login.jsx';
import { Dialog } from './Dialog.jsx';
import { CardMenu } from './ContextMenu.jsx';
import { Logo } from './Logo.jsx';
import { Gear, Bot } from './Icons.jsx';
import { SettingsModal } from './SettingsModal.jsx';
import { TokensModal } from './TokensModal.jsx';
import { ArchiveModal } from './ArchiveModal.jsx';

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
  const [boards, setBoards] = useState([]);
  const [boardId, setBoardId] = useState(() => readSetting('boardId', null));
  const [projects, setProjects] = useState([]);
  const [cards, setCards] = useState([]);
  const [focus, setFocus] = useState('all');
  const [openCardId, setOpenCardId] = useState(null);
  const [openProjectId, setOpenProjectId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [menu, setMenu] = useState(null);
  const [settings, setSettings] = useState(false);
  const [tokens, setTokens] = useState(false);
  const [archive, setArchive] = useState(false);
  const [labels, setLabels] = useState({});
  const [search, setSearch] = useState('');
  const [agentOnly, setAgentOnly] = useState(false);
  // First visit follows the system setting; after that your choice sticks.
  const [theme, setTheme] = useState(() => readSetting(
    'theme',
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  ));
  const [compact, setCompact] = useState(() => readSetting('compact', true));
  const [rowCap, setRowCap] = useState(() => readSetting('rowCap', 240));
  const [collapsed, setCollapsed] = useState(() => new Set(readSetting('collapsed', [])));
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await api.boards();
      setBoards(list);
      // The remembered board may have been deleted, so fall back to the first.
      const wanted = list.some((b) => b.id === boardId) ? boardId : list[0]?.id ?? null;
      const data = await api.board(wanted);
      setBoardId(data.board.id);
      setProjects(data.projects);
      setCards(data.cards);
      setLabels(data.labels || {});
      setAuthed(true);
    } catch (err) {
      if (err.unauthorized) setAuthed(false);
      else setError(err.message);
    }
  }, [boardId]);

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeSetting('theme', theme);
  }, [theme]);

  useEffect(() => { if (boardId) writeSetting('boardId', boardId); }, [boardId]);

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

  function addBoard() {
    setDialog({
      kind: 'prompt',
      title: 'New board',
      placeholder: 'What is it for, e.g. Personal',
      confirmLabel: 'Add board',
      onConfirm: async (name) => {
        setDialog(null);
        try {
          const made = await api.createBoard(name);
          setBoardId(made.id);   // switch to it straight away
          await load();
        } catch (e) {
          setError(e.message);
        }
      },
    });
  }

  function renameBoard() {
    const current = boards.find((b) => b.id === boardId);
    if (!current) return;
    setDialog({
      kind: 'prompt',
      title: 'Rename board',
      initialValue: current.name,
      confirmLabel: 'Save',
      onConfirm: (name) => {
        setDialog(null);
        if (name === current.name) return;
        commit(() => api.updateBoard(current.id, { name }));
      },
    });
  }

  function deleteBoard() {
    const current = boards.find((b) => b.id === boardId);
    if (!current) return;
    if (boards.length <= 1) {
      setError('This is your only board, so it cannot be deleted.');
      return;
    }
    setDialog({
      kind: 'confirm',
      title: `Delete the board "${current.name}"?`,
      message: current.projects === 0
        ? 'It has no projects.'
        : `This also deletes its ${current.projects} project${current.projects === 1 ? '' : 's'} and every card on them. You cannot undo this.`,
      confirmLabel: 'Delete board',
      danger: true,
      onConfirm: async () => {
        setDialog(null);
        try {
          await api.deleteBoard(current.id);
          setBoardId(boards.find((b) => b.id !== current.id)?.id ?? null);
          await load();
        } catch (e) {
          setError(e.message);
        }
      },
    });
  }

  /** Drop a project row above or below another, and save the new order. */
  function reorderProjects(dragId, overId) {
    if (dragId === overId) return;
    const ordered = [...projects].sort((a, b) => a.position - b.position);
    const from = ordered.findIndex((p) => p.id === dragId);
    const to = ordered.findIndex((p) => p.id === overId);
    if (from < 0 || to < 0) return;

    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);

    const before = projects;
    const spaced = ordered.map((p, i) => ({ ...p, position: (i + 1) * 1000 }));
    setProjects(spaced);
    const target = spaced.find((p) => p.id === dragId);
    commit(() => api.updateProject(dragId, { position: target.position }), () => setProjects(before));
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
        commit(() => api.createProject({ name, color, board_id: boardId }));
      },
    });
  }

  if (authed === null) return <div className="center-note">Loading…</div>;
  if (authed === false) return <Login onSuccess={load} />;

  const raw = search.trim();
  const needle = raw.toLowerCase();

  /**
   * "#54" looks up a card number and nothing else. A bare number does both, so
   * typing 24 finds card #24 and also "24 hour support". Numbers match on the
   * start, so the right card shows up before you finish typing.
   */
  const byNumber = (card, digits) => String(card.id).startsWith(digits);
  const idOnly = raw.startsWith('#');
  const digits = (idOnly ? raw.slice(1) : raw).trim();
  const looksNumeric = /^\d+$/.test(digits);

  let visibleCards = cards;
  if (idOnly) {
    visibleCards = looksNumeric ? cards.filter((c) => byNumber(c, digits)) : [];
  } else if (needle) {
    visibleCards = cards.filter((c) =>
      `${c.title} ${c.notes || ''}`.toLowerCase().includes(needle) ||
      (looksNumeric && byNumber(c, digits)));
  }
  if (agentOnly) visibleCards = visibleCards.filter((c) => c.last_actor_kind === 'agent');

  const filtering = raw || agentOnly;
  const needleCount = filtering
    ? `${visibleCards.length} card${visibleCards.length === 1 ? '' : 's'}`
    : null;

  let shown = focus === 'all' ? projects : projects.filter((p) => p.id === Number(focus));
  if (filtering) {
    const withHits = new Set(visibleCards.map((c) => c.project_id));
    shown = shown.filter((p) => withHits.has(p.id));
  }

  return (
    <div className="app">
      <div className="topbar">
        <button className="brand" onClick={() => setSettings(true)} title="Settings and about">
          <Logo /> Pandan
        </button>

        <select
          className="filter-select board-select"
          value={boardId ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            if (value === '__new') return addBoard();
            setBoardId(Number(value));
            setFocus('all');
          }}
          title="Switch board"
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
          <option value="__new">+ New board…</option>
        </select>

        <select
          className="filter-select project-filter"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
        >
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <button className="btn" onClick={addProject}>+ Project</button>

        <input
          className="search"
          value={search}
          placeholder="Search cards or #12…"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
        />
        <button
          className={`btn agent-filter${agentOnly ? ' on' : ''}`}
          onClick={() => setAgentOnly((v) => !v)}
          title={agentOnly
            ? 'Showing only cards an agent changed — click to show all'
            : 'Show only the cards an agent changed'}
        >
          <Bot size={14} /> Agent changes
        </button>
        {needleCount !== null && (
          <span className="search-count">
            {agentOnly ? `${needleCount} changed by an agent` : needleCount}
          </span>
        )}

        <span className={`saving${busy ? ' on' : ''}`}>Saving…</span>
        {error && <span className="error" style={{ margin: 0 }}>{error}</span>}

        <span className="spacer" />
        <span className={`live${live ? ' on' : ''}`} title={live ? 'Updating live' : 'Reconnecting…'}>
          <i /> {live ? 'live' : 'offline'}
        </span>
        <button
          className="btn btn-ghost settings-btn"
          onClick={() => setSettings(true)}
          title="Settings"
          aria-label="Settings"
        >
          <Gear />
        </button>
      </div>

      <div className="board-scroll">
        {shown.length === 0 ? (
          <div className="center-note">No projects yet. Use “+ Project” to add one.</div>
        ) : (
          <Board
            projects={shown}
            cards={visibleCards}
            compact={compact}
            rowCap={rowCap}
            collapsed={collapsed}
            onToggleRow={toggleRow}
            onReorderProjects={reorderProjects}
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



      {settings && (
        <SettingsModal
          theme={theme}
          setTheme={setTheme}
          compact={compact}
          setCompact={setCompact}
          rowCap={rowCap}
          setRowCap={setRowCap}
          allFolded={projects.length > 0 && collapsed.size === projects.length}
          onFoldAll={() => setCollapsed((prev) =>
            prev.size === projects.length ? new Set() : new Set(projects.map((p) => p.id)))}
          board={boards.find((b) => b.id === boardId)}
          boardId={boardId}
          labels={labels}
          onLabelsSaved={load}
          boardCount={boards.length}
          onRenameBoard={() => { setSettings(false); renameBoard(); }}
          onDeleteBoard={() => { setSettings(false); deleteBoard(); }}
          onOpenArchive={() => { setSettings(false); setArchive(true); }}
          onOpenKeys={() => { setSettings(false); setTokens(true); }}
          onLogout={async () => { await api.logout(); setAuthed(false); }}
          onClose={() => setSettings(false)}
        />
      )}

      {tokens && <TokensModal onClose={() => setTokens(false)} />}

      {archive && <ArchiveModal onClose={() => setArchive(false)} onChanged={load} />}

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
          labels={labels}
          boardId={boardId}
          onClose={() => setOpenCardId(null)}
          onSaved={load}
          onDeleted={load}
        />
      )}
    </div>
  );
}
