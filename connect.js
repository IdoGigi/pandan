#!/usr/bin/env node
/**
 * Connects a Claude Code install to this Pandan board:
 *
 *   1. registers the MCP server, so the agent gets the tools
 *   2. installs the `pandan` skill, so it knows how to write short entries
 *   3. prints the CLAUDE.md rule to paste
 *
 * The password is read from .env and handed straight to the CLI as an
 * argument. It is never printed, so it cannot end up in a terminal log.
 *
 *   node connect.js [url]      default: http://localhost:3000
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] || process.env.PANDAN_URL || 'http://localhost:3000';

/* ---- the password ---- */

const envFile = join(here, '.env');
if (!existsSync(envFile)) {
  console.error('No .env found. Run `npm run setup` first.');
  process.exit(1);
}
const password = (readFileSync(envFile, 'utf8').match(/^APP_PASSWORD=(.*)$/m) || [])[1]?.trim();
if (!password) {
  console.error('No APP_PASSWORD line in .env. Run `npm run setup` first.');
  process.exit(1);
}

/* ---- 1. register the MCP server ---- */

console.log(`Connecting Claude Code to ${url}`);

const isWindows = process.platform === 'win32';
const result = spawnSync(
  isWindows ? 'claude.cmd' : 'claude',
  [
    'mcp', 'add',
    '--transport', 'http',
    'pandan', `${url}/mcp`,
    '--header', `Authorization: Bearer ${password}`,
  ],
  // Same reason as start.js: Windows needs a shell to run claude.cmd. The
  // arguments are passed as an array, so the password is never parsed by it.
  { encoding: 'utf8', shell: isWindows }
);

if (result.error?.code === 'ENOENT') {
  console.error('\nCould not find the `claude` command.');
  console.error('Install Claude Code, or add the server by hand — see API.md.');
  process.exit(1);
}

// Never print the CLI output as-is: it can echo the header back.
const output = `${result.stdout || ''}${result.stderr || ''}`.replace(password, '<hidden>');
if (result.status === 0) {
  console.log('  MCP server added as "pandan".');
} else if (/already exists/i.test(output)) {
  console.log('  An MCP server named "pandan" is already there — left as it is.');
  console.log('  To point it somewhere else: claude mcp remove pandan, then run this again.');
} else {
  console.error('  Could not add the MCP server:');
  console.error(`  ${output.trim().split('\n')[0] || `exit code ${result.status}`}`);
}

/* ---- 2. install the skill ---- */

const source = join(here, 'examples', 'pandan-skill.md');
const target = join(homedir(), '.claude', 'skills', 'pandan', 'SKILL.md');

if (existsSync(source)) {
  mkdirSync(dirname(target), { recursive: true });
  const skill = readFileSync(source, 'utf8')
    .replace(/http:\/\/localhost:3000/g, url)
    .replace(/\/path\/to\/pandan/g, resolve(here).replace(/\\/g, '/'))
    .replace(/^> Save this as[\s\S]*?\n\n/m, '');
  writeFileSync(target, skill);
  console.log(`  Skill installed at ${target}`);
} else {
  console.log('  Skipped the skill — examples/pandan-skill.md is missing.');
}

/* ---- 3. the rule ---- */

console.log('');
console.log('One step left, and it needs you: paste the rule from');
console.log(`  ${join(here, 'examples', 'CLAUDE.md-snippet.md')}`);
console.log('into your CLAUDE.md, so the agent logs its work without being asked.');
console.log('');
console.log('Then start a new Claude Code session and ask: "what is on my board?"');
