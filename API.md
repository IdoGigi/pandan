# Pandan API

A small REST API for the board. Made to be easy for an agent to drive.

## Auth

One password protects everything. Send it as a Bearer token:

```
Authorization: Bearer YOUR_PASSWORD
```

The browser UI uses a signed cookie instead, but an agent should always use the header.
Without it, every `/api/*` route returns `401 {"error":"unauthorized"}`.

Base URL: `http://localhost:3000/api`

```bash
export KB=http://localhost:3000/api
export KEY="Authorization: Bearer YOUR_PASSWORD"
```

## Shape of the board

- A **board** is a whole workspace, for example work or personal. There is
  always at least one, and you cannot delete your last.
- A **project** is one row (swimlane) on a board.
- A **card** belongs to one project and sits in one column.
- Columns are fixed: `todo`, `next`, `doing`, `review`, `done`.
  On screen, `next` and `doing` sit under the "In progress" header.
- `position` orders cards inside a column. Lower comes first. You rarely set it
  by hand — use the move endpoint with an `index`.

## Card references

Each board has a **key**, such as `WRK`, and numbers its cards from 1. A card's
**reference** is the two together — `WRK-7` — and it is what the board shows.

- Every `/cards/:id…` route takes the reference, in any case, or the card's
  numeric `id`: `/cards/WRK-7`, `/cards/wrk-7` and `/cards/52` can all be the
  same card. A bare number is always the `id`.
- Cards come back with `number` (7) and `ref` (`"WRK-7"`) next to `id`.
- A key is 2 to 6 letters or digits, starting with a letter, and no two boards
  share one. Leave it out when making a board and one is made from the name.
- A new key changes the reference of every card on the board; the numbers stay.
- A card that moves to a project on another board, or with its project, takes
  that board's next number. Numbers are never reused, so an old reference
  points at nothing rather than at the wrong card.

## Boards

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/boards` | Every board with its `key` and project count |
| POST | `/boards` | `{ "name", "key?" }` |
| PATCH | `/boards/:id` | `{ "name?", "key?", "position?" }` |
| DELETE | `/boards/:id` | Also deletes its projects and their cards. Refuses on the last board |

## Read one board

One call gives an agent everything it needs. Leave `board_id` out for the first
board.

```bash
curl -s -H "$KEY" "$KB/board?board_id=1"
```

```json
{
  "columns": ["todo", "next", "doing", "review", "done"],
  "board": { "id": 1, "name": "Work", "key": "WRK" },
  "projects": [{ "id": 1, "name": "House chores", "color": "#c3d117", "position": 1000 }],
  "cards": [
    {
      "id": 52, "number": 7, "ref": "WRK-7", "project_id": 1, "column_key": "todo",
      "title": "Buy milk", "notes": "", "color": "lime", "flagged": 0,
      "position": 1000, "checks_total": 2, "checks_done": 1
    }
  ]
}
```

## Projects

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/projects` | All active projects. `?archived=true` lists the archived ones instead |
| GET | `/projects/:id` | One project in full: cards, counts, links, contacts and the update log |
| POST | `/projects/:id/links` | `{ "kind": "link"\|"contact", "label", "value" }` |
| PATCH | `/links/:id` | Change a link or contact |
| DELETE | `/links/:id` | Remove a link or contact |
| POST | `/projects/:id/updates` | `{ "text" }` — add a dated entry to the log |
| DELETE | `/updates/:id` | Remove a log entry |
| POST | `/projects` | `{ "name", "board_id?", "color?", "description?", "repo_url?" }` |
| PATCH | `/projects/:id` | Any of `name`, `color`, `description`, `repo_url`, `board_id`, `position`, `archived` |
| DELETE | `/projects/:id` | Also deletes that project's cards |

```bash
curl -s -H "$KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Side project","color":"#4bb3d4"}' $KB/projects
```

## Cards

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/cards` | Filter with `?project_id=1&column=todo` |
| GET | `/cards/:id` | `:id` is the reference (`WRK-7`) or the id. Includes the `checklist` array |
| POST | `/cards` | `{ "project_id", "title", "column_key?", "notes?", "color?", "flagged?", "due_date?" }` |
| PATCH | `/cards/:id` | Any field. Changing project/column without a `position` sends it to the end |
| POST | `/cards/:id/move` | `{ "column_key?", "project_id?", "index?" }` |
| DELETE | `/cards/:id` | **Archives** it. Not destroyed, and restorable |
| POST | `/cards/:id/restore` | Put an archived card back |
| DELETE | `/cards/:id/permanent` | Really delete. Needs the password — an agent key gets `403` |
| GET | `/cards?archived=true` | What is in the archive |

`color` is one of: `plain`, `lime`, `sky`, `amber`, `rose`, `violet`.
`flagged` shows a small red dot on the card.
`due_date` is `YYYY-MM-DD`, or `""` to clear it. Late cards go red on the board.

Name a colour to turn it into a label:

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/boards/:id/labels` | Names for this board's colours |
| PUT | `/boards/:id/labels/:color` | `{ "name" }`. An empty name removes it |

Add a card:

```bash
curl -s -H "$KEY" -H 'Content-Type: application/json' \
  -d '{"project_id":1,"title":"Fix the sink","column_key":"todo","color":"lime"}' \
  $KB/cards
```

Move a card. `index` is the slot in the target list — `0` is the top,
leave it out to drop it at the bottom:

```bash
curl -s -H "$KEY" -H 'Content-Type: application/json' \
  -d '{"column_key":"doing","index":0}' $KB/cards/WRK-7/move
```

Move it to another project too:

```bash
curl -s -H "$KEY" -H 'Content-Type: application/json' \
  -d '{"project_id":2,"column_key":"next"}' $KB/cards/WRK-7/move
```

## Sticky notes

Each board has a note board: loose sticky notes, not tied to any project or
card. `x` and `y` are where the note sits, in pixels from the top-left.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/boards/:id/notes` | Every note on that board |
| POST | `/boards/:id/notes` | `{ "title?", "text?", "color?", "x?", "y?" }` |
| PATCH | `/notes/:id` | Any of `title`, `text`, `color`, `x`, `y` |
| DELETE | `/notes/:id` | Really deletes it. Notes have no archive, so this needs the password — an agent key gets `403` |

`color` uses the card colours, default `amber`. A title is one line of up to
120 characters; text is at most 2000. Text may carry light marks that the UI
shows formatted: `**bold**`, `__underline__`, `~~struck~~`, and a line
starting with `- ` is a bullet.

## Checklist

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/cards/:id/checks` | `{ "text", "done?" }` |
| PATCH | `/checks/:id` | `{ "text?", "done?" }` |
| DELETE | `/checks/:id` | |

The board view shows the progress as `done/total` on the card.

```bash
curl -s -H "$KEY" -H 'Content-Type: application/json' \
  -d '{"text":"call the plumber"}' $KB/cards/WRK-7/checks

curl -s -X PATCH -H "$KEY" -H 'Content-Type: application/json' \
  -d '{"done":true}' $KB/checks/3
```

## Live updates

`GET /api/events` is a Server-Sent Events stream. It sends `hello` on connect,
then a `change` event after every successful write, so a client can re-read
instead of polling. The browser authenticates with its cookie; a script sends
the usual Bearer header.

```bash
curl -N -H "$KEY" -H "Accept: text/event-stream" $KB/events
```

```
event: change
data: {"revision":4,"source":"POST /cards"}
```

Reads and failed writes send nothing.

## Agent keys

Give each agent its own key rather than your password, so you can revoke one
without changing your login. Make them under **Agent keys** in the board, or:

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/tokens` | List keys. Never returns the key itself |
| POST | `/tokens` | `{ "name" }` — returns `token` **once** |
| DELETE | `/tokens/:id` | Revoke. Takes effect on the next request |

These three need the **board password or the browser cookie**. An agent key
gets `403` — it can use the board, but never manage keys.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Bad input. The body says what is wrong |
| 401 | Missing, wrong, or revoked key |
| 403 | A valid agent key tried to do something only the owner may do |
| 404 | No such project, card, or check |
| 429 | Too many failed logins from one address. Wait a minute |

## Other

`GET /healthz` is open and needs no password. It returns `{"ok":true}` and
nothing about your data. Railway uses it to check the app is alive.

## A recipe for an agent

1. `GET /board` to see projects and cards.
2. Find the `project_id` you want by name.
3. `POST /cards` to add work.
4. `POST /cards/:id/move` with `column_key: "done"` when it is finished.

## Connect an agent (MCP)

The board also speaks **MCP**, so an agent can discover the tools by itself
instead of being told about the endpoints. The endpoint is:

```
POST http://localhost:3000/mcp
```

It uses the same password as a Bearer token.

### Claude Code

Run this in your own terminal, with your real password in place of the
placeholder. Do not paste your password into a chat.

```bash
claude mcp add --transport http pandan \
  http://localhost:3000/mcp \
  --header "Authorization: Bearer YOUR_PASSWORD"
```

### Any client that reads `.mcp.json`

Keep the password in an environment variable, never in the file:

```json
{
  "mcpServers": {
    "pandan": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer ${KANBAN_PASSWORD}" }
    }
  }
}
```

### The tools an agent gets

| Tool | What it does |
| --- | --- |
| `get_boards` | List the boards — work, personal, whatever you keep separate |
| `create_board` | Add a whole new board |
| `get_board` | Read one board's projects and cards. Start here to get the ids |
| `get_project` | One project in full: cards, counts, notes, repo, links, contacts, update log |
| `add_project_link` | Attach a link or a contact to a project |
| `delete_project_link` | Remove a link or contact |
| `add_project_update` | Write a dated entry in the project's update log |
| `get_card` | Read one card in full, including its checklist |
| `create_project` | Add a project (a new row) |
| `update_project` | Rename, recolour, or archive a project |
| `create_card` | Add a card to a project |
| `update_card` | Change a card's text, notes, colour, flag, project or column |
| `move_card` | Move a card between columns or projects, and pick its place in the list |
| `archive_card` | Put a card away. It can be restored |
| `restore_card` | Bring an archived card back |
| `list_archived_cards` | See what is in the archive |
| `set_label` | Give a colour a meaning, e.g. rose = "Blocked" |
| `add_check` | Add a checklist item to a card |
| `update_check` | Tick, untick, or reword a checklist item |

Every card tool takes the card's reference (`WRK-7`) as `card_id`, so an agent
can act on what you read off the board. The numeric id works too.

Each tool carries its own description and typed arguments, so an agent can read
`tools/list` and work out what to do without any extra prompting. Bad input is
rejected before it reaches the board, and errors come back as plain sentences
like `card not found`.

### Checking it by hand

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer YOUR_PASSWORD" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The `Accept` header must list both types, or the transport replies `406`.
