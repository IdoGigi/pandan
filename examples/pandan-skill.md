---
name: pandan
description: Record what I am working on to my personal kanban board in one short line. Use when real work on a task starts, when it is finished, or when I say "log this", "update the kanban", "put this on the board", "what am I working on". Creates the project row if it is missing. Entries must be tiny — the board is for glancing at, not reading.
---

# pandan

> Save this as `~/.claude/skills/kanban/SKILL.md` (or your client's skill
> folder) and change the URL and path to match your setup.

My board: <http://localhost:3000>

Rows are projects. Columns are `todo`, `next`, `doing`, `done`.

## The one rule

The board is for **glancing at**. A card title must be readable in one second.
If an entry is not worth reading a week from now, do not write it.

Writing less is always the safer mistake. A board with 6 clear cards beats a
board with 40 true ones.

## How to reach it

**First choice — the `kanban` MCP tools.** If tools named `get_board`,
`create_card`, `move_card` are available, use them. Nothing else to set up.

**Fallback — curl.** The password is on the `APP_PASSWORD=` line of
`/path/to/pandan/.env`. Read it into a variable; never print
it, never put it in a message, never pass it as a visible argument.

```bash
PW=$(grep '^APP_PASSWORD=' /path/to/pandan/.env | cut -d= -f2-)
curl -s -H "Authorization: Bearer $PW" \
  http://localhost:3000/api/board
```

Full endpoint list: `/path/to/pandan/API.md`.

## The flow

### 1. Find the project

Call `get_board` first. Match the project by name against the repo folder or
what the user calls it. Reuse an existing row — near-matches count
(`Caracal` covers `IdoBGdev__Caracal`).

### 2. Create it only if it is genuinely missing

```
create_project   name: the repo or product name, not a path
update_project   description: one line on what it is
                 repo_url:    the GitHub URL if there is one
```

Then keep going. Do not stop to ask.

### 3. When real work starts

Look for a card that already covers this task. If there is one, `move_card` it
to `doing`. Only if there is none, `create_card` in `doing`.

**Never open a second card for work already on the board.**

### 4. When it is finished

- `move_card` the card to **`review`** if a person should check the work, or to
  **`done`** if it plainly needs no checking. You are allowed to use either —
  `review` is a signal, not a wall.
- `add_project_update` with **one sentence** on what changed

Use `review` for anything you would want a second pair of eyes on: a change you
were unsure about, something you could not fully test, or work that touches
money, data or other people. Use `done` for the obvious ones.

That is the whole loop. Nothing else gets written.

## How short

| Field | Limit |
| --- | --- |
| Card title | 8 words, no full stop |
| Update log entry | 1 sentence |
| Project description | 1 line |

### Good

| Card title | Update log |
| --- | --- |
| `Fix login redirect loop` | `Login redirect loop fixed — bad session cookie path.` |
| `Add MCP endpoint` | `Board now speaks MCP, 14 tools.` |
| `Postgres migration for addresses` | `Address table migrated, 12k rows moved.` |

### Bad — never write these

| Wrong | Why |
| --- | --- |
| `Fixed the login bug by changing auth.js line 42 where the cookie path was wrong, then rebuilt and redeployed and verified with curl` | A card is a label, not a report |
| `Ran npm install` | A step, not a task |
| `[error] TypeError: cannot read...` | Never paste output, logs or stack traces |
| `Working on stuff` | Says nothing |
| `Updated files: a.js, b.js, c.js` | The repo already knows this |

## When NOT to touch the board

Skip it completely for:

- questions, explanations, or reading code
- small edits — a typo, a rename, a version bump
- anything the user did not ask you to build
- work already logged — check before writing
- exploring or debugging that led nowhere

**One task, one card.** Not one card per step, per file, or per command.

## Quick check before writing

1. Is this a real task, or just a step? *Step → skip.*
2. Is it already on the board? *Yes → move it, do not add.*
3. Can I say it in 8 words? *No → cut it down.*
