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
- **Agents can read and write it.** A built-in MCP server with 16 tools. An
  agent finds them itself — you do not have to explain your API to it.
- **The board updates live.** A card an agent adds appears in about a second.
  No refresh.
- **Small enough to read.** Around 2,300 lines. You can check what it does
  before you trust it with your work.

## The board

Keep as many boards as you like — one for work, one for home. The switcher is
in the top bar, and it remembers which one you had open. A project can be moved
between boards, and deleting a board takes its projects with it.

On a board, rows are projects. Columns are `To do`, `Next`, `Doing`, `Review` and `Done`,
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

```bash
npx pandan-board
```

That is the whole install. It makes you a password on first run and opens on
<http://localhost:3000>.

Your board lives in `~/.pandan` — the database and an `.env` holding the
password. The password is never printed, so open that file to read it.

You need [Node 22.13 or newer](https://nodejs.org). Pandan uses Node's built-in
SQLite, so there is nothing to compile and no database to install.

### With Docker

```bash
docker run -d -p 127.0.0.1:3000:3000   -v pandan:/data   -e APP_PASSWORD=pick-something-long   ghcr.io/YOUR-NAME/pandan
```

Or with compose, which binds to localhost for you:

```bash
npm run setup && docker compose up -d
```

### From the source

For hacking on it. A checkout keeps its board inside the checkout, so your
real one is never touched.

```bash
git clone https://github.com/YOUR-NAME/pandan.git
cd pandan
npm install
npm start
```

## Connect an agent

Each agent gets its own key. Revoking one stops that agent and nothing else —
your own password keeps working. A key can use the board, but it can never see,
make or revoke keys, so a leaked key cannot protect itself.

Make keys under **Agent keys** in the board, or let `npm run connect` do it.

**Claude Code** — one command:

```bash
npm run connect
```

With the board running, that makes an agent key, registers the MCP server with
it, and installs the `pandan` skill. Your board password is used once to make
the key and never handed to the agent. Pass an address if the board is not
local: `npm run connect https://board.example.com`.

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
      "headers": { "Authorization": "Bearer ${PANDAN_KEY}" }
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

Pandan is built for **one person on one machine**. One password is your login.

- Agents get their own keys, which you can revoke one at a time. Only a hash of
  each key is stored, so a copy of the database does not hand them over.
- A key cannot list, make or revoke keys. That needs your password.
- Docker compose binds to `127.0.0.1` on purpose. It is not reachable from
  your network until you change that.
- There are still no user accounts. Anyone with your **password** has full
  control, including over the keys.
- If you put it on the internet, put it behind something that does real auth,
  and use a long random password.

Failed logins are rate limited, cookies are signed and HTTP-only, and stored
links only become clickable for `http`, `https`, `mailto` and `tel` — but none
of that makes it a multi-user app.

## Settings

| Name | Needed | What it does |
| --- | --- | --- |
| `APP_PASSWORD` | yes | The only password. The app refuses to start without it |
| `DB_PATH` | no | The database file. Defaults to `~/.pandan/pandan.db` |
| `PANDAN_HOME` | no | Where settings and the board live. Defaults to `~/.pandan` |
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
