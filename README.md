# Kanban

A small personal kanban board. Rows are projects, columns are `To do`,
`Next`, `Doing`, `Done` — `Next` and `Doing` sit under one "In progress" header.

One password protects the whole thing. The browser gets a signed cookie,
an agent sends the same password as a Bearer token. See [API.md](API.md).

## What it is made of

- **Server** — Node + Express. Data in SQLite through Node's built-in
  `node:sqlite`, so there is no native module to compile.
- **Web** — React + Vite. Card moves update the screen first and talk to the
  server after, so dragging feels instant.
- **One service** — the same Node process serves the API and the built UI.

```
server/
  index.js    app wiring, login, static files
  auth.js     password check, signed cookie, bearer token
  db.js       schema and the database handle
  routes.js   the JSON API
web/src/
  App.jsx        state, optimistic updates
  Board.jsx      the grid and its headers
  List.jsx       one cell: cards, drag and drop, quick add
  Card.jsx       a single card
  CardModal.jsx  the edit dialog
  api.js         fetch wrapper
```

## Run it locally

```bash
npm install
npm run build          # builds the web UI into web/dist
```

Put a password in `.env` at the repo root:

```
APP_PASSWORD=choose-something-long
DB_PATH=./data/kanban.db
```

Then start it:

```bash
node --env-file=.env server/index.js
```

Open http://localhost:3000.

For frontend work with hot reload, run the server as above and in another
terminal `npm --prefix web run dev`, then open http://localhost:5173.
Vite proxies `/api` to port 3000.

## Environment variables

| Name | Needed | What it does |
| --- | --- | --- |
| `APP_PASSWORD` | yes | The only password. The app refuses to start without it |
| `DB_PATH` | no | Where the SQLite file lives. Defaults to `./data/kanban.db` |
| `PORT` | no | Railway sets this. Defaults to 3000 |
| `NODE_ENV` | no | Set to `production` so the cookie gets the `Secure` flag |

## Deploy on Railway

The app is one service with a volume mounted at `/data`, and
`DB_PATH=/data/kanban.db` so the board survives restarts and redeploys.

```bash
railway up            # push the current folder
railway logs          # watch it start
```

To change the password later, set `APP_PASSWORD` in the Railway dashboard
under Variables. The service restarts and old cookies stop working, which is
exactly what you want.

## Notes

- `node:sqlite` prints an "experimental" warning on start. It is safe to ignore.
- Failed logins from one address are limited to 8 a minute.
- Never commit `.env` — it is in `.gitignore`.

## Live

- App: https://kanban-production-e69e.up.railway.app
- Railway project: `kanban` (workspace DevTeam), service `kanban`,
  volume `kanban-volume` mounted at `/data`.

Your password is in `.env` in this folder. Open that file to read it —
it was never printed to a terminal.

### A note on `railway.json`

Railway now prefers `.railway/railway.ts` and warns that `railway.json`
is deprecated. The current file keeps working until 2026-12-01. Run
`railway config migrate` when you want to switch.

## UI smoke test

The board has no browser-based tests, so there is a headless one. It mounts the
real React app in jsdom against a fake API and clicks through the main flows.

```bash
npm run smoke
```

It fails if any step breaks, if React logs an error, or if the app ever calls
`window.prompt`, `window.confirm` or `window.alert` — the app uses its own
dialogs instead, so those must stay unused.

## Agent access

Two ways in, both behind the same password:

- **REST** — plain JSON endpoints, documented in [API.md](API.md).
- **MCP** — `POST /mcp`, so an agent discovers the tools on its own.
  Ten tools cover reading the board and adding or editing projects, cards and
  checklist items. See the "Connect an agent" section of [API.md](API.md).

The MCP tools call this app's own REST API over localhost, so an agent goes
through exactly the same checks as the browser does. There is no second copy
of the rules to keep in step.
