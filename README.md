<h1 align="center">
  <img src="web/public/favicon.svg" width="72" height="72" alt=""><br>
  Pandan
</h1>

<p align="center">
  A small kanban board you run on your own machine — with an MCP server, so you
  can see what your coding agents are actually doing.
</p>

---

Agents do a lot of work you never see. Pandan gives them somewhere to write it
down, and gives you a board that updates while they work.

- **Runs on localhost.** One Node process, one SQLite file. No database to set
  up, no account, nothing leaves your machine.
- **Agents can read and write it.** A built-in MCP server with 14 tools. An
  agent finds them itself — you do not have to explain your API to it.
- **The board updates live.** A card an agent adds appears in about a second.
  No refresh.
- **Small enough to read.** Around 2,300 lines. You can check what it does
  before you trust it with your work.

## The board

Rows are projects. Columns are `To do`, `Next`, `Doing`, `Review` and `Done`,
with `Next` and `Doing` grouped under **In progress**.

**Review** is where an agent puts work it wants you to look at. It is a signal,
not a gate — an agent can still move a card straight to `Done` when the work
plainly needs no checking. The point is that it can tell you which is which.

Cards carry a colour, a flag, notes and a checklist. Right-click one to recolour
it. Each project also holds notes, a repo link, links, contacts, and a dated
update log — so the context lives next to the work.

Rows fold away and every column scrolls on its own, so a project with fifty
cards takes the same room as one with five.

## Run it

You need [Node 22.13 or newer](https://nodejs.org) — it uses Node's built-in
SQLite, so there is nothing to compile.

```bash
git clone https://github.com/YOUR-NAME/pandan.git
cd pandan
npm install
npm start
```

That is it. `npm install` writes a `.env` with a random password, and
`npm start` builds the board the first time and serves it.

Open <http://localhost:3000>. Your password is on the `APP_PASSWORD` line of
`.env` — it is never printed, so open the file to read it.

### With Docker

```bash
npm run setup           # or write your own .env
docker compose up -d
```

Same address. The database sits on a named volume, so it survives a rebuild.

## Connect an agent

One password protects everything. The browser uses a cookie; an agent sends the
same password as a Bearer token.

**Claude Code** — one command:

```bash
npm run connect
```

It registers the MCP server and installs the `pandan` skill, reading the
password from `.env` so it is never printed. Pass an address if the board is
not local: `npm run connect https://board.example.com`.

By hand instead:

```bash
claude mcp add --transport http pandan http://localhost:3000/mcp \
  --header "Authorization: Bearer YOUR_PASSWORD"
```

**Anything that reads `.mcp.json`** — keep the password in an environment
variable, not in the file:

```json
{
  "mcpServers": {
    "pandan": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer ${PANDAN_PASSWORD}" }
    }
  }
}
```

The agent then gets tools to read the board, add and edit cards, move them
between columns, manage projects and write update entries. Full list and a
plain REST API in [API.md](API.md).

## Make agents actually use it

An agent will not log its work unless you tell it to, and left alone it writes
far too much. [`examples/`](examples/) has the two pieces that fix that:

- `examples/CLAUDE.md-snippet.md` — a short rule to paste into your `CLAUDE.md`
- `examples/pandan-skill.md` — a Claude Code skill with the same rules in detail

Both are built around one idea: **the board is for glancing at.** Card titles
are capped at 8 words, log entries at one sentence, and most work is not worth
a card at all. A board with six clear cards beats one with forty true ones.

## Security — read this before exposing it

Pandan is built for **one person on one machine**. It has one password, and
that password is both your login and your agent key.

- Docker compose binds to `127.0.0.1` on purpose. It is not reachable from
  your network until you change that.
- There are no user accounts, and no way to revoke an agent's access without
  changing your own password too.
- If you put it on the internet, put it behind something that does real auth,
  and use a long random password.

Failed logins are rate limited, cookies are signed and HTTP-only, and stored
links only become clickable for `http`, `https`, `mailto` and `tel` — but none
of that makes it a multi-user app.

## Settings

| Name | Needed | What it does |
| --- | --- | --- |
| `APP_PASSWORD` | yes | The only password. The app refuses to start without it |
| `DB_PATH` | no | Where the SQLite file lives. Defaults to `./data/pandan.db` |
| `PORT` | no | Port to listen on. Defaults to 3000 |
| `NODE_ENV` | no | Set to `production` so the cookie gets the `Secure` flag |

## Development

```bash
npm run dev                  # server with reload
npm --prefix web run dev     # UI on :5173, proxies /api to :3000
npm run check                # syntax check the server
npm run smoke                # headless UI test
```

`npm run smoke` mounts the real React app in jsdom against a fake API and clicks
through every flow with true pointer events. It fails if the app ever calls
`window.prompt`, `confirm` or `alert` — Pandan uses its own dialogs.

```
server/
  index.js    wiring, login, static files
  auth.js     password check, signed cookie, bearer token
  db.js       schema and migrations
  routes.js   the JSON API
  mcp.js      the MCP server
  events.js   live updates over Server-Sent Events
web/src/      the React board
```

Existing boards upgrade in place: new columns are added only when missing, and
new tables use `CREATE TABLE IF NOT EXISTS`.

## Licence

MIT. See [LICENSE](LICENSE).
