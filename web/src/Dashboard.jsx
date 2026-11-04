import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { COLUMN_LABELS } from './Board.jsx';
import { Tile, StackedColumns, WeekBars, MedianColumns, PairBars } from './charts.jsx';
import { DrillPanel } from './DrillPanel.jsx';

const OPEN_COLS = ['todo', 'next', 'doing', 'waiting', 'review'];

/**
 * One board in numbers: where work is stuck, how much gets done, what agents
 * do. Every number is a list of cards; clicking it lists them beside the
 * charts. `tick` changes whenever the server reports a change.
 */
export function Dashboard({ boardId, tick, onOpenCard, onError }) {
  const [data, setData] = useState(null);
  // { title, ids, notes? } — notes (id → text) keep the given order, e.g. "Longest in Doing".
  const [pick, setPick] = useState(null);

  const close = useCallback(() => setPick(null), []);

  // A late answer, for a board you have left or from before the latest change, is dropped.
  useEffect(() => {
    if (!boardId) return undefined;
    let alive = true;
    api.insights(boardId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && onError(e.message));
    return () => { alive = false; };
  }, [boardId, tick, onError]);
  useEffect(() => { setPick(null); }, [boardId]);

  // Never one board's numbers under another's name while the new ones load.
  if (!data || data.board.id !== boardId) return <div className="center-note">Loading…</div>;
  const show = (title, ids, notes) => setPick({ title, ids, notes });

  return (
    <div className="dash">
      <div className="dash-main">
        <section className="dash-block">
          <h2>Stuck now</h2>
          <div className="tiles">
            <Tile label="Waiting" ids={data.stuck.waiting} onPick={show} />
            <Tile label="Flagged" ids={data.stuck.flagged} onPick={show} />
            <Tile label="Overdue" ids={data.stuck.overdue} onPick={show} />
            <Tile label="Gone quiet" hint={`No change for ${data.quiet_days} days or more`}
              ids={data.stuck.quiet} onPick={show} />
          </div>
          <h3>Open work by project</h3>
          {data.projects.length === 0
            ? <p className="dash-empty">No projects yet.</p>
            : <StackedColumns projects={data.projects} columns={OPEN_COLS} labels={COLUMN_LABELS} onPick={show} />}
        </section>

        <section className="dash-block">
          <h2>Getting done</h2>
          <WeekBars weeks={data.weeks} onPick={show} />
          <h3>Median days in each column</h3>
          <MedianColumns times={data.time_in_column} columns={OPEN_COLS} labels={COLUMN_LABELS}
            since={data.history_since} onPick={show} />
        </section>

        <section className="dash-block">
          <h2>Agents</h2>
          <div className="tiles">
            <Tile label="In Review from agents" ids={data.agents.review_from_agents} onPick={show} />
            <Tile label="Touched by agents this week" ids={data.agents.this_week} onPick={show} />
          </div>
          <PairBars weeks={data.agents.weeks} since={data.history_since} onPick={show} />
        </section>
      </div>

      {pick && (
        <DrillPanel
          title={pick.title}
          cards={pick.ids.map((id) => data.cards[id]).filter(Boolean)}
          notes={pick.notes}
          projects={data.projects}
          onOpenCard={onOpenCard}
          onClose={close}
        />
      )}
    </div>
  );
}
