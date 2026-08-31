import { useRef } from 'react';
import { List } from './List.jsx';

export const COLUMN_LABELS = { todo: 'To do', next: 'Next', doing: 'Doing', done: 'Done' };
const COLS = ['todo', 'next', 'doing', 'done'];

/** Header: "To do" and "Done" stand alone; "Next" and "Doing" sit under "In progress". */
function Header() {
  return (
    <>
      <div className="cell head-blank" style={{ gridColumn: 1, gridRow: '1 / 3' }} />
      <div className="cell head-col" style={{ gridColumn: 2, gridRow: '1 / 3' }}>To do</div>
      <div className="cell head-group" style={{ gridColumn: '3 / 5', gridRow: 1 }}>In progress</div>
      <div className="cell head-col last-col" style={{ gridColumn: 5, gridRow: '1 / 3' }}>Done</div>
      <div className="cell head-col" style={{ gridColumn: 3, gridRow: 2 }}>Next</div>
      <div className="cell head-col" style={{ gridColumn: 4, gridRow: 2 }}>Doing</div>
    </>
  );
}

export function Board({ projects, cards, onOpenCard, onAddCard, onDropCard, onRenameProject, onDeleteProject }) {
  const drag = useRef(null);

  const byCell = new Map();
  for (const card of cards) {
    const key = `${card.project_id}:${card.column_key}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(card);
  }

  return (
    <div className="board">
      <Header />

      {projects.map((project, r) => {
        const row = r + 3;
        return (
          <div key={project.id} style={{ display: 'contents' }}>
            <div className="cell row-label" style={{ gridColumn: 1, gridRow: row }}>
              <span className="dot" style={{ background: project.color }} />
              <span className="name">{project.name}</span>
              <span className="row-actions">
                <button
                  className="btn btn-ghost"
                  style={{ padding: '1px 5px', fontSize: 12 }}
                  title="Rename project"
                  onClick={() => onRenameProject(project)}
                >
                  ✎
                </button>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '1px 5px', fontSize: 12 }}
                  title="Delete project"
                  onClick={() => onDeleteProject(project)}
                >
                  ×
                </button>
              </span>
            </div>

            {COLS.map((col, c) => (
              <div
                key={col}
                className={`cell${c === COLS.length - 1 ? ' last-col' : ''}`}
                style={{ gridColumn: c + 2, gridRow: row }}
              >
                <List
                  projectId={project.id}
                  columnKey={col}
                  cards={byCell.get(`${project.id}:${col}`) || []}
                  drag={drag}
                  onOpenCard={onOpenCard}
                  onAddCard={onAddCard}
                  onDropCard={onDropCard}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
