# Error codes

Every error Pandan adds gets a code: `PND-<AREA>-<NNN>`. The API returns it as
`code`, and the `error` message starts with it, so an agent sees it too
(`"error": "PND-REF-002: \"CRC\" is already the key of the project \"Caracal\""`).
Older errors without a code are unchanged.

## REF — project keys and card refs

| Code | Where | What it means | What to do |
| --- | --- | --- | --- |
| `PND-REF-001` | `POST /projects`, MCP `create_project` (400) | The project key is not 2 to 5 capital letters | Use letters only, like `CRC`. Digits are not allowed |
| `PND-REF-002` | `POST /projects`, MCP `create_project` (400) | The key belongs to another project, or to a deleted one. A key is never given out twice | Pick another key, or leave `key` out to get one made from the name |
| `PND-REF-003` | `POST /projects`, MCP `create_project` (400) | The key is a board's key, or starts old board refs (`MB-223`), so `MB-1` would name two cards | Pick another key |
| `PND-REF-004` | `POST /boards`, `PATCH /boards/:id`, MCP `create_board` (400) | The board key is a project key, so `CRC-1` would name two cards | Pick another board key. Board keys are for display only |
| `PND-REF-005` | Server start | `project-keys.json` beside the database is broken: not a JSON object, a key that is not 2 to 5 letters, a key used twice, or a key already taken. The start stops and nothing is saved | Fix the file, or remove it to have keys made from names. The message names the project and the key |
| `PND-REF-006` | `POST /cards`, MCP `create_card` (409) | The database refused the card because another card already has that ref. The counter only goes up, so this means rows were edited by hand | Nothing was saved. Check `ref_keys.last_number` against the highest `ref_number` for that key; a restart raises the counter |
| `PND-REF-007` | Database trigger `cards_ref_never_changes` | Something tried to change a card's ref or old board ref. Refs never change, even when a card moves | Do not edit `ref_key`, `ref_number` or `legacy_ref` |
| `PND-REF-008` | `PATCH /projects/:id` (400) | The request tried to change a project's key | Keys never change, so its cards keep their refs. Send no `key`, or the same one |
| `PND-REF-009` | `POST /projects`, server start | No free key was left to make from this name (all 702 variants are taken) | Give the project a `key` yourself |
| `PND-REF-010` | Database trigger `projects_key_never_changes` | Something tried to change a project's key in the database | Do not edit `projects.key` |
| `PND-REF-011` | Database triggers `ref_keys_never_removed`, `ref_keys_only_count_up` | Something tried to delete a row from `ref_keys`, rename a key, or lower its count, which would let a key or its numbers be given out again | Do not change `ref_keys` by hand |
| `PND-REF-012` | `POST /cards`, server start | A card's project has no key, so the card cannot be numbered. Should not happen: every start keys every project | Restart the server so its start-up pass gives the project a key |
| `PND-REF-013` | `scripts/undo-project-refs.mjs` | No database file was given, or the undo failed. Nothing was changed | Pass the database path, or set `DB_PATH` |
