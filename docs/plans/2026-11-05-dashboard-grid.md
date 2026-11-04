# Dashboard, full-width grid

Approved by Ido 2026-11-05, after the first version went live. It builds on
`2026-11-04-dashboard-design.md`; everything there still holds unless this file
changes it.

## Why

On a 1920px screen the first version left most of the page empty:

- **Fixed-width charts.** Each chart had a fixed width, so the charts filled
  about a third of their panels and the rest was dark.
- **A third of the page was empty.** No card has a due date, so Overdue was
  always 0. Agents and time-in-column only start collecting on ship day, so
  both said "nothing yet".
- **No real finishing history.** 100 of the 153 cards finished on My board were
  archived from Done. Archiving overwrites the date, so when they were finished
  is lost, and "finished per week" was nearly blank.
- **The data that did exist wasn't shown.** That includes done against open for
  each project, how old the open work is, cards added per week (an exact
  figure), and the flagged and waiting cards themselves rather than just their
  counts.

## What a person sees

Ido asked for the dashboard to be "half operational", so it helps him run his
tasks as well as read them. On a wide screen the page splits into two halves
that share the full width:

- **Control (left):** cards he can act on right there, without opening the
  editor.
- **Insight (right):** the numbers and charts.

At 1100px or narrower the halves stack, with Control first. On a phone
everything is one column, the big numbers sit two to a row, and the card list
still rises as a bottom sheet.

Charts are measured from their panel, so they stretch to fill it. All charts
are still vertical, and every number, bar and row still opens the cards behind
it.

```
┌──────────── CONTROL ────────────┬──────────── INSIGHT ────────────┐
│ + Add  [project▾][column▾][title…] │ Open · In progress · Done 83%   │
│ IN PROGRESS (Doing, Review)     │ Added 4 wk · Waiting · Flagged   │
│  MB-12 Login      Doing [→ ✓ ⚑ ⏸ ⋯]│ BOARD NOW   ▇ ▂ ▁ ▁ ▁ ▇          │
│ NEEDS ATTENTION                 │ PROJECTS ▆ ▆ ▂ ▃ ▁ (% done)       │
│  ⚑ MB-41 Fix login  9d [→ ✓ ⚑ ⏸ ⋯]│ ADDED AND FINISHED PER WEEK      │
│  ⏸ MB-60 Vendor     4d [...]    │ AGE OF OPEN WORK                 │
│ UP NEXT                         │ agents · time in column (slim)   │
│  MB-70 Tender   [Start ▶] [...] │                                  │
│ OLDEST OPEN                     │                                  │
└─────────────────────────────────┴──────────────────────────────────┘
```

## Control half

### Quick add

Adding a card takes one line:

- **Project:** a dropdown of the board's active projects. The browser remembers
  the last one picked for each board.
- **Column:** To do, Next or Doing, with To do as the default.
- **Title:** typed in the field. Enter adds the card, using
  `api.createCard({ project_id, column_key, title })`.

The field then clears and keeps focus, so several cards can be added in a row.
Errors go through the usual `onError`.

### Lists, and which card goes where

Each card appears **once** in the Control half. It goes to the first list below
that claims it; the lists are shown in this order:

1. **Needs attention:**
   - **Which cards:** waiting, flagged, overdue or gone quiet. Each row carries
     one small tag per reason: ⏸ waiting, ⚑ flagged, "overdue", "quiet Nd".
   - **Order:** untouched longest first.
2. **In progress:** the remaining cards in Doing and Review. Each row shows its
   column; the list is ordered by column, then untouched longest first.
3. **Up next:** the first 5 remaining cards in Next, in board order: project
   order, then the card's position. Each has a **Start ▶** button that moves it
   to Doing.
4. **Oldest open:** the 5 oldest remaining open cards, by `created_at`.

On screen, In progress comes first, then Needs attention, then Up next, then
Oldest open.

**Long lists:** a list with more than 8 rows shows 8, and "All N" opens the
whole list in the card list.

**Empty lists:** an empty list says so in one line ("Nothing in progress",
"Nothing flagged, waiting, overdue or quiet", "Next is empty"). It is not
hidden.

### Row quick actions

These are on every card row in the Control lists **and** in the card list a
chart opens. Clicking the title still opens the editor.

| Action | What it does |
| --- | --- |
| → | Moves the card one step on: To do → Next → Doing → Review → Done. From Waiting it goes back to Doing. Hidden on Done |
| ✓ | Moves the card to Done. Hidden on Done |
| ⚑ | Flags or unflags the card, with `api.updateCard(id, { flagged })` |
| ⏸ | Moves the card to Waiting. Hidden on Waiting and Done |
| ⋯ | A small menu to move the card to any column |

- **API calls:** moves use `api.moveCard(id, { column_key })`, which puts the
  card at the bottom of its new column, as the board's right-click "Move to"
  does.
- **Buttons:** each is a real button with an aria-label that names the card,
  for example "Move SCH-3 to Done". A button is disabled while its request is
  running.
- **After a change:** the dashboard reads the data again (the live tick does
  this; a direct re-read is fine too).
- **Archived rows:** they have no actions.

## Insight half

### Big numbers (top row)

The top row has six numbers, plus two more that appear only when they are above
zero. Each one opens its cards.

| Number | Cards behind it |
| --- | --- |
| Open | Every live card not in Done |
| In progress | Live cards in Doing, Waiting or Review |
| Done | Live Done cards plus cards archived from Done. It shows its share of all work: done ÷ (done + open) |
| Added, last 4 weeks | Every card added in the last 4 weeks of `weeks` |
| Waiting | Same as before |
| Flagged | Same as before |
| Overdue | Same as before; shown only when above 0 |
| Gone quiet | Same as before; shown only when above 0 |

### Board now

One vertical bar for each column, from To do to Done, counting live cards.
Clicking a bar lists its cards.

### Projects

One stacked vertical column per project, in board order:

- **Segments:** open cards by column (To do, Next, Doing, Waiting, Review) at
  the bottom, and done on top. Done means live Done plus archived from Done.
- **Labels:** the total sits above each column. Under it are the name and the
  share done; a project with no cards shows "—".
- **Width:** each project's slot grows to fill the panel. If there are too many
  projects to fit, the chart scrolls sideways inside the panel.

### Added and finished per week

- **Bars:** a pair of vertical bars per week, added and finished.
- **Estimates:** estimated finishes are lighter, as before.
- **Y-axis:** gridlines with a few numbers on them.
- **Empty weeks:** leading weeks with nothing in them are left out, but at least
  4 weeks always show.
- **Note:** under the chart, "Cards finished and archived before tracking began
  count in Done, not per week."

### Age of open work

Open cards, grouped by days since they were made, as 5 vertical bars: under 1
week, 1–2 weeks, 2–4 weeks, 1–3 months, and over 3 months. The colours go from
calm to warm as cards get older.

### Agents and time in column

- **While neither has data:** one slim line, "Agents and time in column:
  collecting since {date or today}. They fill in as cards move; an agent counts
  as an agent when it connects with an agent key."
- **Once either has data:** two half-width panels with the existing pieces: the
  agent tiles plus agent-against-you bars, and the median days per column.

## API changes to `GET /api/insights`

These are additions only; existing fields stay as they are.

```json
{
  "totals": { "open": [], "in_progress": [], "done": [] },
  "columns": { "todo": [], "next": [], "doing": [], "waiting": [], "review": [], "done": [] },
  "projects": [{ "by_column": { "todo": [], "next": [], "doing": [], "waiting": [], "review": [], "done": [] } }],
  "age": [{ "from_days": 0, "to_days": 7, "ids": [] }, { "from_days": 7, "to_days": 14, "ids": [] },
          { "from_days": 14, "to_days": 30, "ids": [] }, { "from_days": 30, "to_days": 90, "ids": [] },
          { "from_days": 90, "to_days": null, "ids": [] }],
  "cards": { "274": { "created_at": "2026-10-31 11:40:44" } }
}
```

- **`totals.done` and `projects[].by_column.done`:**
  - They hold live Done cards plus archived cards whose `column_key` is `done`,
    meaning they were archived from Done.
  - Cards archived from any other column count nowhere: they were dropped, not
    finished.
  - A restored card counts by where it is now.
- **`columns`:** live cards only, each column including Done.
- **`age`:** open cards (live, not in Done), grouped by whole days from
  `created_at` to now. Each range includes its start and excludes its end.
- **`cards[id].created_at` and `cards[id].position`:** added to every card in
  the map. Up next uses `position`.
- **Unchanged:**
  - `weeks` still has 12 weeks; the UI leaves out the leading empty ones.
  - `stuck`, `time_in_column` and `agents` are unchanged.

## Not changing

- **Finished per week:** it still counts from real and seeded moves into Done.
  The 100 old finishes count only in totals; Ido chose this, because placing
  them at their archive date would put ~95 in the clean-up week.
- **The card list:** its behaviour (focus, Esc, archived rows) and the live
  refresh stay as they are.
- **Server:** no new endpoints. The actions use the existing card routes.
- **Still not doing:**
  - bulk actions (Ido left them out);
  - an MCP `get_insights` tool;
  - a date-range picker, CSV export, and an all-boards view.
