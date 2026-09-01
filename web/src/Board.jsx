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

export function Board({
  projects, cards, compact, rowCap, collapsed,
  onToggleRow, onOpenCard, onCardMenu, onOpenProject, onAddCard, onDropCard,
}) {
  const drag = useRef(null);

  const byCell = new Map();
  const counts = new Map();
  for (const card of cards) {
    const key = `${card.project_id}:${card.column_key}`;
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(card);
    counts.set(card.project_id, (counts.get(card.project_id) || 0) + 1);
  }

  return (
    <div className={`board${compact ? ' compact' : ''}`} style={{ '--row-cap': `${rowCap}px` }}>
      <Header />

      {projects.map((project, r) => {
        const row = r + 3;
        const total = counts.get(project.id) || 0;
        const isShut = collapsed.has(project.id);

        return (
          <div key={project.id} style={{ display: 'contents' }}>
            <div className="cell row-label" style={{ gridColumn: 1, gridRow: row }}>
              <div className="row-top">
                <button
                  className="row-fold"
                  onClick={() => onToggleRow(project.id)}
                  title={isShut ? 'Show this project' : 'Fold this project away'}
                  aria-expanded={!isShut}
                >
                  {isShut ? '▶' : '▼'}
                </button>
                <span className="dot" style={{ background: project.color }} />
                <button
                  className="name"
                  onClick={() => onOpenProject(project.id)}
                  title={project.name}
                >
                  {project.name}
                </button>
              </div>
              <span className="row-count">{total === 0 ? 'no cards' : `${total} card${total === 1 ? '' : 's'}`}</span>
            </div>

            {isShut ? (
              <div
                className="cell last-col row-collapsed"
                style={{ gridColumn: '2 / 6', gridRow: row }}
                onDoubleClick={() => onToggleRow(project.id)}
              >
                {COLS.map((c) => (
                  <span key={c}>
                    {COLUMN_LABELS[c]} <b>{(byCell.get(`${project.id}:${c}`) || []).length}</b>
                  </span>
                ))}
              </div>
            ) : (
              COLS.map((col, c) => (
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
                    onCardMenu={onCardMenu}
                    onAddCard={onAddCard}
                    onDropCard={onDropCard}
                  />
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
