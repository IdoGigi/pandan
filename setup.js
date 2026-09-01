#!/usr/bin/env node
/**
 * First-run setup. Makes a .env with a strong random password if there is not
 * one already. The password is written to the file and never printed, so it
 * cannot end up in a terminal log or a shared screen recording.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const quiet = process.argv.includes('--quiet');
const file = '.env';

// npm ci in a container or on CI should not write a password into the image.
if (quiet && (process.env.CI || process.env.PANDAN_NO_SETUP)) process.exit(0);

if (existsSync(file)) {
  if (quiet) process.exit(0);
  console.log('.env already exists — leaving it alone.');
  console.log('Your password is on the APP_PASSWORD line. Open the file to read it.');
  process.exit(0);
}

const password = randomBytes(24).toString('base64url');
writeFileSync(
  file,
  [
    '# Pandan settings. Keep this file private — it is gitignored.',
    `APP_PASSWORD=${password}`,
    '',
    '# Where the database file lives.',
    'DB_PATH=./data/pandan.db',
    '',
    '# Port the server listens on.',
    'PORT=3000',
    '',
  ].join('\n'),
  { mode: 0o600 }
);

console.log('');
console.log('Made a .env with a new random password.');
console.log('  Your password is on the APP_PASSWORD line of .env.');
console.log('  Open that file to read it — it is not printed here on purpose.');
console.log('');
console.log('Next:  npm start');
