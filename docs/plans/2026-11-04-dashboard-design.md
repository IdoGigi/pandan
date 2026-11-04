# Dashboard — design

Approved 2026-11-04.

## Problem

Pandan is a project-management board, but it only shows the present: which
card is in which column right now. It cannot answer the three questions a
person running projects asks, in this order:

1. **Where is work stuck?**
2. **How much gets done?**
3. **What are the agents doing?**

Every number should open the cards behind it.

## What a person sees

A third view in the top bar: **Board | Notes | Dashboard**. It follows the board
picker (one board at a time, never mixed) and refreshes live, like the board.
All charts are vertical. Three blocks:

- **Stuck now**
  - Four tiles:
    - *Waiting*: every card in Waiting.
    - *Flagged*: open cards with the flag set.
    - *Overdue*: the due date has passed and the card isn't Done.
    - *Gone quiet*: in Doing, Waiting or Review with no change for 7 or more days.
  - *Open work by project*: one upright stacked column per project, split by
    To do · Next · Doing · Waiting · Review in the project panel's blues. A long
    name is cut short under its column, with the full name on hover. Many
    projects scroll sideways inside the block.
- **Getting done**
  - Cards finished per week as bars, and cards added per week as a line, over
    the last 12 weeks.
  - Weeks before ship day are drawn lighter and marked as estimates.
  - Median days spent in each column, from real moves only. It reads
    "Collecting since …" until there are some.
- **Agents**
  - Cards an agent left in Review.
  - Cards agents touched this week.
  - Agent against you, per week, as paired bars.

**Deep-dive.** A tile, a part of a column, a week or a median opens a card
list beside the charts. On a phone it opens as a sheet from the bottom.

- **Header:** it names the selection, for example "Waiting · Hiring · 3".
- **Order:** the cards untouched longest come first.
- **Rows:** the reference, title, project dot, column and age (`9d`).
- **Clicking a row:** it opens the usual card editor.
- **Archived cards:** marked "archived" and not clickable.
- **Closing:** ✕ or Esc. There is one selection at a time.

## Data: move history

New table `card_events`, purely additive:

| Column | Meaning |
| --- | --- |
| `card_id` | The card; rows go when the card is deleted for good. History follows the card: one moved to another board counts on the board it is on now |
| `kind` | `created`, `moved`, `archived`, `restored` |
| `from_column`, `to_column` | For moves |
| `actor`, `actor_kind` | Who, from the same source as `cards.last_actor` |
| `at` | UTC time |
| `estimated` | 1 for a seeded guess, 0 for a real record |

**Recording.** One helper in the routes writes every row:

- A card is created.
- Its column changes, by edit or by move.
- It is archived or restored.

Agents use the same routes, so their moves are recorded too. Reordering within
a column records nothing.

**Seeding** happens in the start-up pass, for cards that have no history yet:

- A `created` row at `cards.created_at`. This is exact.
- For cards in Done, `moved → done` at `cards.updated_at`, marked `estimated`.
- For archived cards, `archived` at `archived_at`.

Every card has history after the first start, so nothing is seeded twice. An
older version ignores the table, so rolling back is safe. Moves made while
rolled back leave a gap in the history.

## API

`GET /api/insights?board_id=&tz=` is read-only and uses the usual login or agent
key. `tz` is the browser's `getTimezoneOffset()`, in minutes.

```json
{
  "board": { "id": 4, "name": "School", "key": "SCH" },
  "quiet_days": 7,
  "history_since": "2026-11-05",
  "stuck": { "waiting": [], "flagged": [], "overdue": [], "quiet": [] },
  "projects": [{ "id": 19, "name": "", "color": "", "by_column": { "todo": [] } }],
  "weeks": [{ "start": "2026-08-16", "added": [], "finished": [], "estimated": true }],
  "time_in_column": { "doing": { "median_days": 4.2, "moves": 9, "longest": [], "longest_days": [] } },
  "agents": { "review_from_agents": [], "this_week": [], "weeks": [{ "start": "", "agent": [], "you": [] }] },
  "cards": { "274": { "id": 274, "ref": "SCH-1", "title": "", "project_id": 23, "column_key": "todo",
                      "flagged": 0, "due_date": null, "updated_at": "", "archived": false } }
}
```

- **Every number is a list of card ids.** The UI counts the list and shows the
  cards from `cards`, so a click needs no second call.
- **Finished:** a card counts in the week it last moved into Done. If it is
  moved back out of Done, it no longer counts; if it is archived from Done, it
  still does. A week is `estimated` when any of its finished rows is.
- **Time in column:** the time from a real move into a column to the next real
  move out, leaving out any time the card spent archived. The median covers the
  12-week window; `longest` holds the slowest cards and `longest_days` their days,
  in the same order, and the card list keeps that order.
- **Weeks:** 12 weeks, starting on Sunday, in the browser's local time.
- **Overdue:** judged against the local date.
- **Gone quiet:** uses `updated_at`, so any change restarts the clock.

## UI

All in `web/src`, with no chart library:

- `Dashboard.jsx` holds the layout and the current selection.
- `charts.jsx` has `Tile`, `StackedColumns`, `WeekBars` and `PairBars`. These
  are SVG, and every clickable part is a button with an aria-label.
- `DrillPanel.jsx` is the card list.

Colours come from the existing tokens, in light and dark. The browser
remembers the view, as it does for Board and Notes.

## Testing

- **`test/events.test.js`:**
  - one row per create, move, column edit, archive and restore;
  - none for a reorder;
  - agent moves marked as such;
  - seeding, and that it is idempotent.
- **`test/insights.test.js`:** on controlled dates:
  - the stuck lists, with Gone quiet at 6 days against 8;
  - cards per project and column;
  - finished and added weeks, including a card moved out of Done;
  - estimated weeks;
  - the time-zone edge on a Saturday night;
  - medians from real moves only;
  - board isolation and the login.
- **Smoke:**
  - the view switch and the tile counts;
  - a click opens the list, a row opens the editor, and Esc closes the list;
  - archived rows can't be clicked;
  - estimated weeks are marked.
- **Before shipping:** headless Chrome at laptop and phone width, in light and
  dark, and a dry run on a copy of the production backup.

## Not doing

- An MCP `get_insights` tool. It is the natural next step, but a separate change.
- A date-range picker, CSV export, an all-boards view, a per-board quiet
  setting, burndown or sprints.
