# Security

## What Pandan is

Pandan is built for **one person on one machine**. One password is your login.
Agents get their own keys, which you can revoke one at a time.

That is a deliberate trade for a personal tool, not an oversight. It does mean:

- Anyone with your **password** has full control of the board and its keys.
- Any live **agent key** can read and change everything on the board. Keys are
  for revoking a specific agent, not for limiting what it may do.
- There are no user accounts.
- It is not safe to expose on the open internet without putting real
  authentication in front of it.

`docker-compose.yml` binds to `127.0.0.1` for this reason.

## What it does protect against

- Failed logins are rate limited per address.
- The browser cookie is signed, HTTP-only and `SameSite=Lax`, and gets the
  `Secure` flag when `NODE_ENV=production`.
- Passwords are compared in constant time.
- Only a SHA-256 hash of each agent key is stored, never the key itself. A key
  is shown once, when you make it.
- Managing keys needs the password. An agent key gets `403`, so a leaked key
  cannot make itself a spare or revoke the others.
- Stored links only become clickable for `http`, `https`, `mailto` and `tel`.
  Anything else, including `javascript:`, is shown as plain text.
- The app refuses to start without `APP_PASSWORD`, so it can never come up open.
- `npm run setup` writes the password to `.env` and never prints it.

## Reporting a problem

**Please do not open a public issue.**

Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability), or email the address on the maintainer's
GitHub profile.

Please include what you found, how to reproduce it, and what an attacker could
do with it. You will get a reply within a week.

If the report is about something already written down above, it will be closed
as a known limitation — but tell us anyway if you think the trade is wrong.
