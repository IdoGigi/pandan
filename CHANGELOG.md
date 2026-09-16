# Changelog

Newest first. Versions follow `MAJOR.MINOR.PATCH`.

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
