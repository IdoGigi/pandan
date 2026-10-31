# Board keys and per-board card numbers — design

Approved 2026-10-31.

## Problem

A card's number is its global `cards.id`. A board made today starts at #274,
because every other board has used up the numbers before it. Numbers should
start at 1 on each board.

Once numbers repeat across boards, "#3" no longer names one card, so an agent
cannot be handed it on its own. Each board therefore gets a short key, and a
card is known by its **reference**: `SCH-3` — board key, dash, number.

## What a person sees

- Each card shows its reference (`SCH-3`) where it used to show `#274`.
- Keys come from the board name: initials of a name in several words
  (`My board` → `MB`), the first three letters of one word (`School` → `SCH`).
  A name with no Latin letters gets `B` and the board id (`B5`). A digit is
  added while the key is taken (`SCH2`).
- A key is 2–6 characters, A–Z and 0–9, starting with a letter, and unique.
  It can be changed in Settings → This board. Changing it changes the
  reference of every card on the board.
- Search: `#3` or `SCH-3` finds card 3 on the open board; a bare `3` matches
  the number or the words. `covid-19` is still a word search, because `COVID`
  is not this board's key.

## Data

All additive, applied on start:

| Column | Meaning |
| --- | --- |
| `boards.key` | The board key. Unique index |
| `boards.last_card_number` | Last number handed out on this board. Only counts up, so a number is never reused, even after a card is deleted for good |
| `cards.number` | The card's number on its board |

`cards.id` stays the internal key. It is still accepted everywhere, so every
existing integration keeps working.

## Rules

- A new card takes its board's next number.
- A card that moves to a project on **another board** takes that board's next
  number (`SCH-3` → `PER-9`). The old reference then points at nothing: numbers
  are never reused on a board. Keys are a different matter — a key given up by a
  rename or a deleted board can be taken by another board, and its old
  references then name that board's cards. Accepted for now; a table of retired
  keys would close it.
- A bare number is always the internal id, never the number on the card, so
  existing callers keep working. The MCP field description says so, because an
  agent told "card 14" must pass `SCH-14`, not `14`.
- A project moved to another board takes its cards along; they are numbered
  on the new board in the order they were made, archived cards included.
- Moving within a board keeps the number.

## Start-up pass (migration)

Runs on every start and only touches rows that need it:

1. Boards with no key get one, in board order.
2. Cards with no number — or with a number an older card on the same board
   already has — get the board's next number, oldest card first.
3. Each board's counter is raised to at least its highest card number.

On the first start this numbers every existing card from 1 per board, in the
order they were made. When the repair finds two cards with one number, the
older card keeps it — the database does not record which one moved. Steps 2 and 3 also repair anything an older version wrote
after a rollback (it creates cards with no number and moves cards between
boards without renumbering), so rolling back and forward again is safe.

## API and MCP

- Every `/cards/:id…` route takes a reference as well as an id:
  `/cards/SCH-3`, `/cards/sch-3`, `/cards/282`. A bare number is always the id,
  so nothing changes for existing callers.
- Card responses carry `number` and `ref`. Boards carry `key`.
- `POST /boards` and `PATCH /boards/:id` take an optional `key`.
- MCP tools keep the `card_id` argument and also take `"SCH-3"`. The server
  instructions tell the agent the reference is what a person will say.
  `create_board` takes an optional `key`.

## Not doing

- Keeping old references working after a move or key change (Jira-style
  redirects).
- An MCP tool to change a board key — Settings and `PATCH /boards/:id` cover it.

## Production

Railway service `kanban` (project `kanban`), SQLite at `/data/pandan.db` on a
volume, deployed by `railway up`. Backup on the volume with `VACUUM INTO`,
download a copy, dry-run the new code against it locally, merge to `main`,
deploy from a clean export of `main`, verify, keep deployment `2bb6140c` as the
rollback target.
