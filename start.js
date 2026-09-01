#!/usr/bin/env node
/**
 * One command to run Pandan.
 *
 * Loads .env if there is one, builds the UI the first time, then starts the
 * server. Everything it does is also available as a separate npm script, so
 * nothing here is magic — it just saves typing on the first run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/* ---- 1. a Node that can run this ---- */

const [major, minor] = process.versions.node.split('.').map(Number);
const oldNode = major < 22 || (major === 22 && minor < 13);
if (oldNode) {
  console.error(`\nPandan needs Node 22.13 or newer. You have ${process.version}.`);
  console.error('It uses Node\'s built-in SQLite, which older versions do not have.');
  console.error('\nGet a newer Node from https://nodejs.org and try again.\n');
  process.exit(1);
}

/* ---- 2. settings ---- */

const envFile = join(here, '.env');
if (existsSync(envFile) && !process.env.APP_PASSWORD) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    // Anything already in the environment wins, so Docker and hosts stay in charge.
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

if (!process.env.APP_PASSWORD) {
  console.error('\nNo password set.');
  console.error('Run `npm run setup` to make one, or set APP_PASSWORD yourself.\n');
  process.exit(1);
}

/* ---- 3. build the UI once ---- */

if (!existsSync(join(here, 'web', 'dist', 'index.html'))) {
  console.log('Building the board for the first time…');
  const isWindows = process.platform === 'win32';
  const build = spawnSync(isWindows ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: here,
    stdio: 'inherit',
    // Node refuses to run a .cmd without a shell, and npm on Windows is a .cmd.
    // The arguments here are fixed strings, so there is nothing to inject.
    shell: isWindows,
  });
  if (build.error) {
    console.error(`\nCould not run the build: ${build.error.message}`);
    console.error('Try `npm install` then `npm run build`.\n');
    process.exit(1);
  }
  if (build.status !== 0) {
    console.error('\nThe build failed. Try `npm install` then `npm run build`.\n');
    process.exit(1);
  }
}

/* ---- 4. go ---- */

await import('./server/index.js');
