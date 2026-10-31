/**
 * Runs the real server on a throwaway database, so a test sees exactly what an
 * agent or the UI would: routes, auth, the start-up pass and the MCP server.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'test-only-not-a-real-secret';

export const tempDir = () => mkdtempSync(join(tmpdir(), 'pandan-test-'));
export const removeDir = (dir) => rmSync(dir, { recursive: true, force: true });

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

  /** A REST call as the owner. Resolves to { status, body }. */
  async function call(method, path, body) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${PASSWORD}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  /** A JSON-RPC call to /mcp. Resolves to the `result` member. */
  async function rpc(method, params) {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PASSWORD}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const data = await res.json();
    if (data.error) throw new Error(`MCP ${method}: ${data.error.message}`);
    return data.result;
  }

  /** Calls one MCP tool. Resolves to { isError, data } with the tool's JSON parsed. */
  async function tool(name, args) {
    const result = await rpc('tools/call', { name, arguments: args });
    const text = result.content?.[0]?.text ?? '';
    let data = text;
    try { data = JSON.parse(text); } catch { /* an error message, kept as text */ }
    return { isError: Boolean(result.isError), data };
  }

  async function stop() {
    if (child.exitCode === null) child.kill();
    await exited;
  }

  return { call, rpc, tool, stop, log: () => log };
}
