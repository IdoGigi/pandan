import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { db } from './db.js';

const PASSWORD = process.env.APP_PASSWORD || '';
const COOKIE = 'kb_session';
const MAX_AGE_DAYS = 30;

if (!PASSWORD) {
  console.error('APP_PASSWORD is not set. Refusing to start an unprotected board.');
  process.exit(1);
}

/** Compare two strings without leaking length or content through timing. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function sign(ts) {
  return createHmac('sha256', PASSWORD).update(`kanban-v1.${ts}`).digest('hex');
}

export function makeSessionValue() {
  const ts = Date.now();
  return `${ts}.${sign(ts)}`;
}

function sessionValid(value) {
  if (typeof value !== 'string') return false;
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const ts = value.slice(0, dot);
  if (!/^\d{10,16}$/.test(ts)) return false;
  const age = Date.now() - Number(ts);
  if (age < 0 || age > MAX_AGE_DAYS * 864e5) return false;
  return safeEqual(value.slice(dot + 1), sign(ts));
}

export function checkPassword(candidate) {
  return safeEqual(candidate ?? '', PASSWORD);
}

/* ---------------- agent tokens ---------------- */

export const TOKEN_PREFIX = 'pnd_';

/** Only the hash is stored, so a copy of the database does not hand over the keys. */
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createToken(name) {
  const token = TOKEN_PREFIX + randomBytes(24).toString('base64url');
  const info = db
    .prepare('INSERT INTO tokens (name, hash, prefix) VALUES (?, ?, ?)')
    .run(name, hashToken(token), token.slice(0, TOKEN_PREFIX.length + 6));
  // The only time the token itself exists outside the caller's hands.
  return { id: Number(info.lastInsertRowid), token };
}

/** Returns the token row if it is real and still live, otherwise null. */
function findToken(candidate) {
  if (!candidate.startsWith(TOKEN_PREFIX)) return null;
  const row = db
    .prepare('SELECT id, name, revoked_at, last_used_at FROM tokens WHERE hash = ?')
    .get(hashToken(candidate));
  return row && !row.revoked_at ? row : null;
}

// "Last used" is for spotting a forgotten agent, not an audit log, so a write
// once a minute per token is plenty and keeps the hot path cheap.
const touched = new Map();
function touch(id) {
  const now = Date.now();
  if (now - (touched.get(id) || 0) < 60000) return;
  touched.set(id, now);
  db.prepare("UPDATE tokens SET last_used_at = datetime('now') WHERE id = ?").run(id);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${makeSessionValue()}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${MAX_AGE_DAYS * 86400}`);
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/** True when the caller is you: the browser cookie, or the board password. */
function isOwner(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (bearer && checkPassword(bearer)) return true;
  const cookie = parseCookies(req.headers.cookie || '')[COOKIE];
  return Boolean(cookie && sessionValid(cookie));
}

/**
 * The board password, the browser cookie, or a live agent token all get in.
 * `req.actor` says which, so routes can tell you apart from an agent.
 */
export function requireAuth(req, res, next) {
  if (isOwner(req)) {
    req.actor = { kind: 'owner', name: 'you' };
    return next();
  }

  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const token = bearer && findToken(bearer);
  if (token) {
    touch(token.id);
    req.actor = { kind: 'agent', name: token.name, token_id: token.id };
    return next();
  }

  res.status(401).json({ error: 'unauthorized' });
}

/**
 * For managing tokens. An agent token must never be able to mint or revoke
 * tokens, or revoking one would mean nothing.
 */
export function requireOwner(req, res, next) {
  if (isOwner(req)) return next();
  res.status(403).json({ error: 'this needs the board password, not an agent token' });
}

/** Slows down password guessing from a single address. */
const attempts = new Map();
export function loginLimiter(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, until: 0 };
  if (rec.until > now) {
    return res.status(429).json({ error: 'too many attempts, wait a minute' });
  }
  if (now - (rec.stamp || 0) > 6e4) rec.count = 0;
  rec.stamp = now;
  rec.count += 1;
  if (rec.count > 8) {
    rec.until = now + 6e4;
    rec.count = 0;
  }
  attempts.set(key, rec);
  if (attempts.size > 5000) attempts.clear();
  next();
}

