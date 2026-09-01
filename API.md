# Kanban API

A small REST API for the board. Made to be easy for an agent to drive.

## Auth

One password protects everything. Send it as a Bearer token:

```
Authorization: Bearer YOUR_PASSWORD
```

The browser UI uses a signed cookie instead, but an agent should always use the header.
Without it, every `/api/*` route returns `401 {"error":"unauthorized"}`.

Base URL: `https://kanban-production-e69e.up.railway.app/api`

```bash
export KB=https://kanban-production-e69e.up.railway.app/api
export KEY="Authorization: Bearer YOUR_PASSWORD"
```

## Shape of the board

- A **project** is one row (swimlane) on the board.
- A **card** belongs to one project and sits in one column.
- Columns are fixed: `todo`, `next`, `doing`, `done`.
  On screen, `next` and `doing` sit under the "In progress" header.
- `position` orders cards inside a column. Lower comes first. You rarely set it
  by hand — use the move endpoint with an `index`.

## Read the whole board

One call gives an agent everything it needs.

```bash
curl -s -H "$KEY" $KB/board
```

```json
{
  "columns": ["todo", "next", "doing", "done"],
  "projects": [{ "id": 1, "name": "House chores", "color": "#c3d117", "position": 1000 }],
  "cards": [
    {
      "id": 7, "project_id": 1, "column_key": "todo",
      "title": "Buy milk", "notes": "", "color": "lime", "flagged": 0,
      "position": 1000, "checks_total": 2, "checks_done": 1
    }
  ]
}
```

## Projects

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/projects` | All active projects |
| GET | `/projects/:id` | One project in full: its cards plus counts and progress |
| POST | `/projects` | `{ "name", "color?" }` |
| PATCH | `/projects/:id` | Any of `name`, `color`, `position`, `archived` |
| DELETE | `/projects/:id` | Also deletes that project's cards |

```bash
curl -s -H "$KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Side project","color":"#4bb3d4"}' $KB/projects
```

## Cards

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/cards` | Filter with `?project_id=1&column=todo` |
| GET | `/cards/:id` | Includes the `checklist` array |
| POST | `/cards` | `{ "project_id", "title", "column_key?", "notes?", "color?", "flagged?" }` |
| PATCH | `/cards/:id` | Any field. Changing project/column without a `position` sends it to the end |
| POST | `/cards/:id/move` | `{ "column_key?", "project_id?", "index?" }` |
| DELETE | `/cards/:id` | |

`color` is one of: `plain`, `lime`, `sky`, `amber`, `rose`, `violet`.
`flagged` shows a small red dot on the card.

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
  -d '{"column_key":"doing","index":0}' $KB/cards/7/move
```

Move it to another project too:

```bash
curl -s -H "$KEY" -H 'Content-Type: application/json' \
  -d '{"project_id":2,"column_key":"next"}' $KB/cards/7/move
```

## Checklist

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/cards/:id/checks` | `{ "text", "done?" }` |
| PATCH | `/checks/:id` | `{ "text?", "done?" }` |
| DELETE | `/checks/:id` | |

The board view shows the progress as `done/total` on the card.

```bash
curl -s -H "$KEY" -H 'Content-Type: application/json' \
  -d '{"text":"call the plumber"}' $KB/cards/7/checks

curl -s -X PATCH -H "$KEY" -H 'Content-Type: application/json' \
  -d '{"done":true}' $KB/checks/3
```

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Bad input. The body says what is wrong |
| 401 | Missing or wrong password |
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
POST https://kanban-production-e69e.up.railway.app/mcp
```

It uses the same password as a Bearer token.

### Claude Code

Run this in your own terminal, with your real password in place of the
placeholder. Do not paste your password into a chat.

```bash
claude mcp add --transport http kanban \
  https://kanban-production-e69e.up.railway.app/mcp \
  --header "Authorization: Bearer YOUR_PASSWORD"
```

### Any client that reads `.mcp.json`

Keep the password in an environment variable, never in the file:

```json
{
  "mcpServers": {
    "kanban": {
      "type": "http",
      "url": "https://kanban-production-e69e.up.railway.app/mcp",
      "headers": { "Authorization": "Bearer ${KANBAN_PASSWORD}" }
    }
  }
}
```

### The tools an agent gets

| Tool | What it does |
| --- | --- |
| `get_board` | Read every project and card in one call. Start here to get the ids |
| `get_project` | One project in full: its cards, counts per column, and percent done |
| `get_card` | Read one card in full, including its checklist |
| `create_project` | Add a project (a new row) |
| `update_project` | Rename, recolour, or archive a project |
| `create_card` | Add a card to a project |
| `update_card` | Change a card's text, notes, colour, flag, project or column |
| `move_card` | Move a card between columns or projects, and pick its place in the list |
| `delete_card` | Delete a card for good |
| `add_check` | Add a checklist item to a card |
| `update_check` | Tick, untick, or reword a checklist item |

Each tool carries its own description and typed arguments, so an agent can read
`tools/list` and work out what to do without any extra prompting. Bad input is
rejected before it reaches the board, and errors come back as plain sentences
like `card not found`.

### Checking it by hand

```bash
curl -s -X POST https://kanban-production-e69e.up.railway.app/mcp \
  -H "Authorization: Bearer YOUR_PASSWORD" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The `Accept` header must list both types, or the transport replies `406`.
