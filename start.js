#!/usr/bin/env node
/**
 * One command to run Pandan, from a clone or straight from npx.
 *
 * Finds your settings, makes a password the first time, builds the UI if this
 * is a source checkout, then starts the server.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { HOME, envFile, repoRoot, inRepo } from './server/paths.js';

/* ---- 1. a Node that can run this ---- */

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nPandan needs Node 22.13 or newer. You have ${process.version}.`);
  console.error("It uses Node's built-in SQLite, which older versions do not have.");
  console.error('\nGet a newer Node from https://nodejs.org and try again.\n');
  process.exit(1);
}

/* ---- 2. settings ---- */

const file = envFile();
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    // Anything already in the environment wins, so Docker and hosts stay in charge.
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

// First run with nothing set up: make a password rather than refusing to start.
if (!process.env.APP_PASSWORD) {
  mkdirSync(dirname(file), { recursive: true });
  const password = randomBytes(24).toString('base64url');
  writeFileSync(
    file,
    [
      '# Pandan settings. Keep this file private.',
      `APP_PASSWORD=${password}`,
      '',
      '# Where the board is stored.',
      `DB_PATH=${join(HOME, 'pandan.db').replace(/\\/g, '/')}`,
      '',
    ].join('\n'),
    { mode: 0o600 }
  );
  process.env.APP_PASSWORD = password;
  console.log('\nFirst run — made you a password.');
  console.log(`  It is on the APP_PASSWORD line of ${file}`);
  console.log('  Open that file to read it. It is not printed here on purpose.\n');
}

/* ---- 3. build the UI, only in a source checkout ---- */

const dist = join(repoRoot, 'web', 'dist', 'index.html');
if (!existsSync(dist)) {
  if (!inRepo && !existsSync(join(repoRoot, 'web', 'src'))) {
    console.error('\nThis copy of Pandan has no built UI and no source to build from.');
    console.error('Try installing it again.\n');
    process.exit(1);
  }
  console.log('Building the board for the first time…');
  const isWindows = process.platform === 'win32';
  const build = spawnSync(isWindows ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: repoRoot,
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
