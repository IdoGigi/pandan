# Changelog

Newest first. Versions follow `MAJOR.MINOR.PATCH`.

## Unreleased

### Card numbers per board

Cards were numbered across all boards, so a new board started at #274. Now
every board counts from 1, and a card is known by its board's key and its
number: `SCH-3`.

- **Board keys.** Each board has a short key, made from its name: `My board` →
  `MB`, `School` → `SCH`; a name with no Latin letters gets `B` and the board
  id. Change it under **Settings → This board**. A key is 2 to 6 letters or
  digits, starting with a letter.
- **What you say is what the agent takes.** Every card tool and every
  `/cards/:id` route takes the reference (`SCH-3`, any case) as well as the
  numeric id, so existing scripts keep working. Card responses carry `number`
  and `ref`; boards carry `key`.
- **Search** takes `#3`, `SCH-3` or a bare `3` for a card on the open board.
- **Moving.** A card that moves to another board, alone or with its project,
  takes that board's next number. Numbers are never reused, even after a card
  is deleted for good.
- **Upgrading.** On first start every existing card is numbered on its own
  board in the order it was made, archived ones included, so the numbers you
  knew change once. The upgrade is additive: an older version still runs on the
  new database, and the next start of this one tidies anything it wrote.

### On a phone

Pandan now works on a phone screen (640px wide or less), and with a finger.

- **Top bar fits.** It wraps onto lines instead of running off the screen, so
  the page no longer scrolls sideways. On a phone: board and settings first,
  then the view and project tools, then search.
- **One column at a time.** Tabs above the board (To do, Next, Doing, Review,
  Done) pick the column shown next to the project names. It starts on Doing.
  A computer still shows all five.
- **Long press on a card** opens its menu, which now has **Move to** with the
  five columns. Right-click on a computer shows the same list. The menu opens
  above the finger when it does not fit below, so lifting the finger picks
  nothing. On touch screens cards can no longer be dragged; the menu replaces
  that.
- **Notes drag with a finger.** A finger on a note moves it instead of
  scrolling the board, and a tap with a little wobble still opens the text.
- **Nothing hides behind hover.** On touch screens "+ Add", a note's colour
  dots and its delete button always show, and menu rows are bigger.
- **Project panel** stacks its five card columns on a phone.

## 1.1.0 — 2026-09-16

### The note board

Every board now has a second view: a cork board of sticky notes, next to the
kanban. Switch with **Board | Notes** in the top bar.

- **Loose notes.** A note is not tied to a project or card. It has a title, a
  text, one of the six card colours, and a spot on the board. Drag it anywhere;
  it stays where you drop it.
- **Light formatting.** Text can carry `**bold**`, `__underline__`,
  `~~struck~~` and `- ` bullet lines. A note shows them formatted; click the
  text to edit, and a small toolbar (B, U, S, List) wraps the selection.
  Ctrl+B and Ctrl+U work too. Marks are plain text, never HTML, so a note can
  carry nothing that runs.
- **Live.** A note another tab or an agent writes shows up within a second,
  like cards do.
- **Agents.** Notes are on the REST API (`/boards/:id/notes`, `/notes/:id`).
  An agent key can add and edit notes but not delete one — notes have no
  archive, so deleting is for a person only. There are no MCP tools for notes
  yet.

### Project panel

- **Cards in one row.** The panel is wider, and a project's cards sit in
  all five columns side by side, each scrolling on its own past a few cards.
  A project with sixty cards no longer stretches the panel down the page.
- **Export the update log.** Copy it as Markdown, or download it as
  `<project>-updates.md`.
- **Two columns.** Details on the left, the update log on the right; they
  stack on a narrow window. The cards row sits at the bottom, since the board
  already shows those cards.
- **One bar instead of nine pills.** The counts per column are one stacked
  bar in board order, with a legend and a single line for total, open,
  flagged and checklist. The Done segment is the percent done.

### Board

- **Hebrew reads right to left.** Every card, note, field and log entry
  picks its own direction from its first letter, so Hebrew and English sit
  side by side on the same board.
- **Archive in the top bar.** The archive was only reachable from the bottom
  of Settings. It now has its own button, and it lists archived projects with
  a Restore button — before, an archived project could not come back.
- **Archive a whole project** from its panel, next to Delete. It asks first
  and says nothing is deleted.
- **Column headers scroll with the board** instead of sticking to the top.

### Fixed

- Text sent from Windows through `curl -d '...'` arrived with broken
  characters (an em dash became `�`, Hebrew became `?????`). The agent skill
  now sends bodies on stdin, which keeps UTF-8 intact.

## 1.0.0 — 2026-09-02

First release: boards, projects, cards with checklists, labels, due dates,
flags, an archive, live updates, agent keys, a REST API and an MCP server
with 19 tools.
