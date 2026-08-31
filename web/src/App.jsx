import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Board } from './Board.jsx';
import { CardModal } from './CardModal.jsx';
import { Login } from './Login.jsx';
import { Dialog } from './Dialog.jsx';

const PROJECT_COLORS = ['#c3d117', '#4bb3d4', '#f0b429', '#e2725b', '#9b8ec4', '#57a773'];

export function App() {
  const [authed, setAuthed] = useState(null); // null = still checking
  const [projects, setProjects] = useState([]);
  const [cards, setCards] = useState([]);
  const [focus, setFocus] = useState('all');
  const [openCardId, setOpenCardId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
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

  function renameProject(project) {
    setDialog({
      kind: 'prompt',
      title: 'Rename project',
      initialValue: project.name,
      confirmLabel: 'Save',
      onConfirm: (name) => {
        setDialog(null);
        if (name === project.name) return;
        const before = projects;
        setProjects((list) => list.map((p) => (p.id === project.id ? { ...p, name } : p)));
        commit(() => api.updateProject(project.id, { name }), () => setProjects(before));
      },
    });
  }

  function deleteProject(project) {
    const count = cards.filter((c) => c.project_id === project.id).length;
    setDialog({
      kind: 'confirm',
      title: `Delete "${project.name}"?`,
      message: count === 0
        ? 'This project has no cards.'
        : `This also deletes ${count} card${count === 1 ? '' : 's'}. You cannot undo this.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => {
        setDialog(null);
        commit(() => api.deleteProject(project.id));
      },
    });
  }

  if (authed === null) return <div className="center-note">Loading…</div>;
  if (authed === false) return <Login onSuccess={load} />;

  const shown = focus === 'all' ? projects : projects.filter((p) => p.id === Number(focus));

  return (
    <div className="app">
      <div className="topbar">
        <h1>Kanban</h1>
        <select className="filter-select" value={focus} onChange={(e) => setFocus(e.target.value)}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn" onClick={addProject}>+ Project</button>
        <span className={`saving${busy ? ' on' : ''}`}>Saving…</span>
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
            onOpenCard={(card) => typeof card.id === 'number' && setOpenCardId(card.id)}
            onAddCard={addCard}
            onDropCard={dropCard}
            onRenameProject={renameProject}
            onDeleteProject={deleteProject}
          />
        )}
      </div>

      {dialog && <Dialog {...dialog} onCancel={() => setDialog(null)} />}

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
