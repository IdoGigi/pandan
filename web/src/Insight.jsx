import { useRef } from 'react';
import { COLUMN_LABELS } from './Board.jsx';
import { agentWeekHasAny, hasMedian, percent, useWidth } from './chartKit.jsx';
import { AgeBars, BoardNow, MedianColumns, ProjectColumns, Tile } from './charts.jsx';
import { AddedFinished, PairBars } from './weekCharts.jsx';

const OPEN_COLS = ['todo', 'next', 'doing', 'waiting', 'review'];
const ALL_COLS = [...OPEN_COLS, 'done'];

/** A titled block; `children(width)` draws its chart to the block's own width. */
function Panel({ title, children }) {
  const body = useRef(null);
  const width = useWidth(body);
  return (
    <section className="dash-block">
      <h3>{title}</h3>
      <div ref={body}>{children(width)}</div>
    </section>
  );
}

/** Every card added in the last four weeks, each once. */
const addedLately = (weeks) => [...new Set(weeks.slice(-4).flatMap((w) => w.added))];

/**
 * Agents and time in column both start collecting on ship day; true once either
 * has something, a card an agent left in Review included, so no count is hidden.
 */
function hasHistory({ agents, time_in_column: times }) {
  return agents.review_from_agents.length > 0 || agents.weeks.some(agentWeekHasAny)
    || Object.values(times).some(hasMedian);
}

/**
 * The top two rows: how much work there is, then what needs a look. Each row
 * shares the width; Overdue and Gone quiet show only when there are some.
 */
function BigNumbers({ data, onPick }) {
  const { totals, stuck } = data;
  const all = totals.done.length + totals.open.length;
  const share = all ? `${percent(totals.done.length, all)} of all work` : null;
  return (
    <div className="big-numbers">
      <div className="tiles">
        <Tile label="Open" ids={totals.open} onPick={onPick} />
        {/* "Active", not "In progress": on the board that name is the Next, Doing and Waiting group. */}
        <Tile label="Active" hint="In Doing, Waiting or Review" ids={totals.in_progress} onPick={onPick} />
        <Tile label="Done" hint="In Done, or archived from Done" sub={share} ids={totals.done} onPick={onPick} />
      </div>
      <div className="tiles">
        <Tile label="Added, last 4 weeks" ids={addedLately(data.weeks)} onPick={onPick} />
        <Tile label="Waiting" ids={stuck.waiting} onPick={onPick} />
        <Tile label="Flagged" ids={stuck.flagged} onPick={onPick} />
        {stuck.overdue.length > 0 && <Tile label="Overdue" ids={stuck.overdue} onPick={onPick} />}
        {stuck.quiet.length > 0 && (
          <Tile label="Gone quiet" hint={`No change for ${data.quiet_days} days or more`} ids={stuck.quiet} onPick={onPick} />
        )}
      </div>
    </div>
  );
}

/** The right half of the dashboard: the numbers and charts, each opening the cards behind it. */
export function Insight({ data, onPick }) {
  return (
    <section className="dash-half dash-insight" aria-labelledby="dash-insight-head">
      <h2 id="dash-insight-head">Insight</h2>
      <BigNumbers data={data} onPick={onPick} />
      <Panel title="Board now">
        {(width) => <BoardNow columns={data.columns} order={ALL_COLS} labels={COLUMN_LABELS} width={width} onPick={onPick} />}
      </Panel>
      <Panel title="Projects">
        {(width) => (data.projects.length
          ? <ProjectColumns projects={data.projects} columns={ALL_COLS} labels={COLUMN_LABELS} width={width} onPick={onPick} />
          : <p className="dash-empty">No projects yet.</p>)}
      </Panel>
      <Panel title="Added and finished per week">
        {(width) => (
          <>
            <AddedFinished weeks={data.weeks} width={width} onPick={onPick} />
            <p className="dash-note">Cards finished and archived before tracking began count in Done, not per week.</p>
          </>
        )}
      </Panel>
      <Panel title="Age of open work">
        {(width) => <AgeBars age={data.age} width={width} onPick={onPick} />}
      </Panel>
      {hasHistory(data) ? (
        <div className="dash-pair">
          <Panel title="Agents">
            {(width) => (
              <>
                <div className="tiles">
                  <Tile label="In Review from agents" ids={data.agents.review_from_agents} onPick={onPick} />
                  <Tile label="Touched by agents this week" ids={data.agents.this_week} onPick={onPick} />
                </div>
                <PairBars weeks={data.agents.weeks} since={data.history_since} width={width} onPick={onPick} />
              </>
            )}
          </Panel>
          <Panel title="Median days in each column">
            {(width) => (
              <MedianColumns times={data.time_in_column} columns={OPEN_COLS} labels={COLUMN_LABELS}
                since={data.history_since} width={width} onPick={onPick} />
            )}
          </Panel>
        </div>
      ) : (
        <p className="dash-collecting">
          Agents and time in column: collecting since {data.history_since ?? 'today'}. They fill in as cards
          move; an agent counts as an agent when it connects with an agent key.
        </p>
      )}
    </section>
  );
}
