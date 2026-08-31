import { createHmac, timingSafeEqual } from 'node:crypto';

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

/** Browser sends a signed cookie; an agent sends `Authorization: Bearer <password>`. */
export function requireAuth(req, res, next) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (bearer && checkPassword(bearer)) return next();

  const cookie = parseCookies(req.headers.cookie || '')[COOKIE];
  if (cookie && sessionValid(cookie)) return next();

  res.status(401).json({ error: 'unauthorized' });
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

