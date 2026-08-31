import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { seedIfEmpty } from './db.js';
import { api } from './routes.js';
import { requireAuth, checkPassword, setSessionCookie, clearSessionCookie, loginLimiter } from './auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, '..', 'web', 'dist');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

seedIfEmpty();

/* ---- health: the only open endpoint, and it says nothing about your data ---- */
app.get('/healthz', (req, res) => res.json({ ok: true }));

/* ---- login ---- */
app.post('/api/login', loginLimiter, (req, res) => {
  if (!checkPassword(req.body?.password)) return res.status(401).json({ error: 'wrong password' });
  setSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ ok: true }));

/* ---- everything else under /api needs the password ---- */
app.use('/api', requireAuth, api);

/* ---- static frontend ---- */
if (existsSync(webDist)) {
  app.use(express.static(webDist, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(join(webDist, 'index.html')));
} else {
  app.get('/', (req, res) =>
    res.status(503).send('UI is not built yet. Run: npm run build'));
}

app.use((err, req, res, next) => {
  console.error('[error]', err?.message);
  res.status(500).json({ error: 'server error' });
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`kanban listening on ${port}`));
