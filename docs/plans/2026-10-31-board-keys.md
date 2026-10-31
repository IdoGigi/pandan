# Board keys and per-board card numbers — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Number cards from 1 on each board and name them by board key (`SCH-3`), everywhere a card is shown or taken.

**Architecture:** Pure key/ref helpers in `server/refs.js`; schema, counter and the start-up pass in `server/db.js`; routes resolve `:id` as a ref or an id and return `number` + `ref`; MCP widens `card_id`; the UI shows `ref`. Design: `docs/plans/2026-10-31-board-keys-design.md`.

**Tech Stack:** Node 24 (`node:sqlite`, `node:test`), Express 5, `@modelcontextprotocol/sdk` + zod 4, React + Vite, jsdom smoke test.

---

### Task 1: Test harness and `npm test`

**Files:** Create `test/helpers.js`. Modify `package.json` (scripts), `.github/workflows/ci.yml`.

- `startServer(dbPath)` spawns `node server/index.js` from the repo root with
  `APP_PASSWORD`, `DB_PATH`, a free `PORT`; waits for `/healthz`; returns
  `{ call(method, path, body), mcp(tool, args), stop() }`.
- `tempDir()` under the OS temp folder; tests remove it.
- `"test": "node --test test/"`; CI step "Server tests" after the syntax check.
- Tests live in `test/`, not `server/`, so `npm publish` (which ships `server/`) leaves them out.

### Task 2: `server/refs.js` — pure helpers (TDD)

**Test:** `test/refs.test.js` first, watch it fail.

```js
export const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;
export function cleanKey(value)              // 'sch ' → 'SCH'; 'a', '1AB', 'TOOLONG7', 'S-H' → undefined
export function suggestKey(name, boardId, taken)
  // 'My board' → 'MB', 'School' → 'SCH', 'לימודים' (id 5) → 'B5',
  // 'School' with SCH taken → 'SCH2', then 'SCH3'
export function parseRef(value)              // 'sch-3' | '#SCH-3' → { key: 'SCH', number: 3 }; '3', 'SCH-', 'SCH-x' → null
```

### Task 3: Schema, counter, start-up pass (TDD)

**Test:** `test/migrate.test.js` first.

- Build a v1.1.0 database by hand (current `CREATE TABLE`s minus the new
  columns): boards `My board`, `School`; interleaved cards on both; one archived
  card; one card on an archived project.
- Start the server → keys `MB`, `SCH`; each board numbered 1..n by card id,
  archived ones included; `last_card_number` = n.
- Restart → nothing changes.
- With the server stopped, write as an older version would (a card with no
  number; a card moved to the other board keeping a colliding number) → restart
  → the new card gets the next number, the collision is renumbered, no
  duplicates on any board, every counter ≥ its highest number.

**Implementation (`server/db.js`):**

```js
addColumn('boards', 'key', 'TEXT');
addColumn('boards', 'last_card_number', 'INTEGER NOT NULL DEFAULT 0');
addColumn('cards', 'number', 'INTEGER');

export function inTransaction(fn) { BEGIN IMMEDIATE … COMMIT / ROLLBACK }
export function takeNumber(boardId)   // UPDATE boards SET last_card_number = last_card_number + 1 WHERE id = ? RETURNING last_card_number
export function renumber(cardIds, boardId)  // oldest first, new numbers on boardId
export function createBoard(name, key)      // insert + key (given, or suggestKey); used by ensureBoard and POST /boards
function backfillRefs()   // keys for unkeyed boards; numbers for NULL or duplicate numbers; raise counters; unique index on boards(key)
```

### Task 4: Routes (TDD)

**Test:** `test/numbers.test.js` first, on a fresh database.

- Board keys: seeded board `MB`; `School` → `SCH`; `Schedule` → `SCH2`;
  Hebrew name → `B<id>`; `key: 'bad key'` → 400; taken key (any case) → 400;
  `PATCH /boards/:id { key }` changes every ref; bad / taken → 400.
- Numbers: each board counts from 1; a permanent delete never frees a number.
- Refs: `GET /cards/SCH-2`, `/cards/sch-2`, numeric id → same card;
  `SCH-99`, `NOPE-1` → 404; archive, restore, checks and permanent delete by ref.
- Moves: `move` / `PATCH project_id` to another board → next number there, old
  ref 404; within a board → number kept. `PATCH /projects/:id { board_id }` →
  all its cards (archived too) renumbered on the new board by card id.
- Responses: `/board` (`board.key`, cards `number` + `ref`), `/projects/:id`
  cards, `/cards`, `/cards?archived=true`, `/cards/:id`, POST/PATCH/move bodies.

**Implementation (`server/routes.js`):** a `CARD_SELECT` joining
projects + boards with `b.key || '-' || c.number AS ref`; `cardById(id)`;
`findCard(param)` (ref first, else digits = id); every card route resolves
through `findCard`; POST /cards takes a number in a transaction; PATCH/move
compare the old and new project's board; PATCH /projects renumbers on a board
change; boards routes validate and store `key`.

### Task 5: MCP (TDD)

**Test:** `test/mcp.test.js` — `tools/list` shows `card_id` accepting a string;
`get_card { card_id: 'MB-1' }`, `move_card { card_id: 'MB-1', column_key: 'done' }`,
`get_card { card_id: <id> }` all work; `create_board { name, key }` sets the key.

**Implementation:** `cardRef` field = `z.union([z.string().min(1), z.number().int()])`
with a description naming `SCH-3`; `encodeURIComponent` in paths; instructions
and `get_board` description mention refs and board keys.

### Task 6: UI

**Files:** `web/src/Card.jsx`, `CardModal.jsx`, `App.jsx`, `SettingsModal.jsx`,
`ArchiveModal.jsx`, `web/smoke.mjs`.

- Cards and the editor show `card.ref` (nothing on a card still being made).
- Search: `#3`, `SCH-3`, `sch-3` → number only; `3` → number or words; a
  hyphenated word whose prefix is not this board's key stays a word search.
- Settings → This board: key shown, **Change key** opens a prompt; server
  errors surface in the error bar.
- Archive rows show the ref.
- Smoke: fake data gets `key` / `number` / `ref`; number, search and editor
  steps updated; a step for changing the key; run `npm run smoke`.

### Task 7: Docs

README (numbers paragraph, search), API.md (boards `key`, refs, `/cards/:ref`,
MCP), CHANGELOG (Unreleased → "Card numbers per board").

### Task 8: Verify and review

`npm run check`, `npm test`, `npm run smoke`, `npm --prefix web run build`;
code-reviewer agent; fix CRITICAL/HIGH.

### Task 9: Production

1. `railway login` (Ido), `railway link` to project `kanban` / service `kanban` / `production`.
2. Backup on the volume: `VACUUM INTO '/data/pandan-backup-2026-10-31.db'`; download a copy.
3. Dry run: new code on the copy; check every board's key and numbers and the counters.
4. PR → merge to `main`.
5. `railway up` from a clean export of `main`; watch build + deploy logs for the `[db]` line; `/healthz`.
6. Verify through the Pandan connector: `get_boards` keys, `get_board` refs, `get_card('SCH-1')`.
7. Rollback: Railway rollback to `2bb6140c`; the schema change is additive, and the start-up pass repairs anything the old version writes.
