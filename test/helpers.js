/**
 * Runs the real server on a throwaway database, so a test sees exactly what an
 * agent or the UI would: routes, auth, the start-up pass and the MCP server.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'test-only-not-a-real-secret';

export const tempDir = () => mkdtempSync(join(tmpdir(), 'pandan-test-'));
export const removeDir = (dir) => rmSync(dir, { recursive: true, force: true });

/** Runs one statement on the test database while the server is idle — for back-dating rows. */
export function sql(dbPath, statement, ...params) {
  const db = new DatabaseSync(dbPath);
  try { return db.prepare(statement).run(...params); } finally { db.close(); }
}

/**
 * Reads rows from the test database. node:sqlite hands back null-prototype
 * objects, which strict deepEqual never matches to a literal, so they are copied.
 */
export function rows(dbPath, statement, ...params) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare(statement).all(...params).map((row) => ({ ...row })); } finally { db.close(); }
}

const DAY = 86400000;
/** A SQLite UTC time `days` ago (fractions allowed). */
export const ago = (days) => new Date(Date.now() - days * DAY).toISOString().slice(0, 19).replace('T', ' ');

/** A port nothing is using, so test files can run side by side. */
function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startServer(dbPath) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, APP_PASSWORD: PASSWORD, DB_PATH: dbPath, PORT: String(port), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((r) => child.once('exit', r));

  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 100 && !up && child.exitCode === null; i += 1) {
    up = await fetch(`${base}/healthz`).then((r) => r.ok, () => false);
    if (!up) await sleep(50);
  }
  if (!up) {
    child.kill();
    throw new Error(`server did not start:\n${log}`);
  }

  /** A REST call, as the owner unless an agent key is given. Resolves to { status, body }. */
  async function call(method, path, body, token = PASSWORD) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  /** A JSON-RPC call to /mcp, as the owner unless an agent key is given. Resolves to the `result` member. */
  async function rpc(method, params, token = PASSWORD) {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`MCP ${method}: ${data.error.message}`);
    return data.result;
  }

  /** Calls one MCP tool, as the owner unless an agent key is given. Resolves to { isError, data } with the tool's JSON parsed. */
  async function tool(name, args, token = PASSWORD) {
    const result = await rpc('tools/call', { name, arguments: args }, token);
    const text = result.content?.[0]?.text ?? '';
    let data = text;
    try { data = JSON.parse(text); } catch { /* an error message, kept as text */ }
    return { isError: Boolean(result.isError), data };
  }

  async function stop() {
    if (child.exitCode === null) child.kill();
    await exited;
  }

  return { base, call, rpc, tool, stop, log: () => log };
}
