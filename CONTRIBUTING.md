# Contributing to Pandan

Thanks for looking. Pandan is small on purpose, and the aim is to keep it that
way — small enough that one person can read the whole thing and trust it.

## Before you write code

For anything more than a small fix, **open an issue first** and say what you
want to change. That is not bureaucracy: the most likely reason a pull request
gets turned down here is scope, not quality, and an issue saves you the work.

## Get it running

```bash
npm install
npm run setup     # writes .env with a random password
npm run build
npm run serve
```

Working on the UI:

```bash
npm run dev                  # server on :3000, reloads
npm --prefix web run dev     # UI on :5173, proxies /api to :3000
```

## Before you open a pull request

```bash
npm run check     # syntax check the server
npm run smoke     # headless UI test
npm run build     # the UI must build
```

All three must pass. Paste the output in the pull request.

### About the tests

`npm run smoke` mounts the real React app in jsdom against a fake API and clicks
through every flow. Two rules it enforces that are easy to trip over:

- **Clicks are real.** Every click fires `pointerdown`, `mousedown`,
  `pointerup`, `mouseup`, `click`, each with a re-render in between. A bare
  `click` event once hid a bug where the colour menu closed before the click
  landed. Do not go back to bare clicks.
- **No native popups.** The test makes `window.prompt`, `window.confirm` and
  `window.alert` throw. Pandan has its own dialogs — use `Dialog.jsx`.

If you add a feature, add a step to `web/smoke.mjs`. If you fix a bug, add the
step that fails without your fix, and say in the pull request that you watched
it fail first.

## House style

- **Small and readable beats clever.** One idea per function.
- **Plain JavaScript.** No TypeScript, no build step for the server.
- **Few dependencies.** Adding one needs a reason in the issue. The server has
  three: Express, the MCP SDK, and Zod.
- Comments explain *why*, not *what*. If the code needs a comment to say what it
  does, rename things instead.
- Match the file you are editing.

## Things that will not be merged

- User accounts, teams, or roles. Pandan is for one person. This is the whole
  design, not a missing feature.
- Configurable columns. Four fixed columns is the opinion.
- A rewrite in another framework.
- Anything that prints a password, or puts one in a URL or a log line.

## Database changes

Existing boards must keep working. Add columns with the `addColumn` helper in
`server/db.js`, which only adds when missing, and create tables with
`CREATE TABLE IF NOT EXISTS`. Test against a database made with the old schema
before you send it.

## Security

Do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree your work is released under the MIT licence, the same
as the rest of the project.
