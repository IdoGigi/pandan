import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Control } from './Control.jsx';
import { DrillPanel } from './DrillPanel.jsx';
import { Insight } from './Insight.jsx';

/**
 * One board, in two halves that share the width: Control, the cards to act on,
 * and Insight, the numbers and charts. Every number is a list of cards;
 * clicking it lists them beside the halves. `tick` changes whenever the server
 * reports a change.
 */
export function Dashboard({ boardId, tick, onOpenCard, onError }) {
  const [data, setData] = useState(null);
  // { title, ids, notes? } — notes (id → text) keep the given order, e.g. "Longest in Doing".
  const [pick, setPick] = useState(null);
  // Counts up after a change made here, so the numbers follow at once; the live tick follows too.
  const [again, setAgain] = useState(0);

  const close = useCallback(() => setPick(null), []);
  const reread = useCallback(() => setAgain((n) => n + 1), []);

  // A late answer, for a board you have left or from before the latest change, is dropped.
  useEffect(() => {
    if (!boardId) return undefined;
    let alive = true;
    api.insights(boardId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && onError(e.message));
    return () => { alive = false; };
  }, [boardId, tick, again, onError]);
  useEffect(() => { setPick(null); }, [boardId]);

  // Never one board's numbers under another's name while the new ones load.
  if (!data || data.board.id !== boardId) return <div className="center-note">Loading…</div>;
  const show = (title, ids, notes) => setPick({ title, ids, notes });

  return (
    <div className="dash">
      <div className="dash-main">
        <Control data={data} onPick={show} onOpenCard={onOpenCard} onChanged={reread} onError={onError} />
        <Insight data={data} onPick={show} />
      </div>

      {pick && (
        <DrillPanel
          title={pick.title}
          cards={pick.ids.map((id) => data.cards[id]).filter(Boolean)}
          notes={pick.notes}
          projects={data.projects}
          onOpenCard={onOpenCard}
          onChanged={reread}
          onError={onError}
          onClose={close}
        />
      )}
    </div>
  );
}
