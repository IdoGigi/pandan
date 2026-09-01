import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where Pandan keeps your board when it is not told otherwise.
 *
 * Run through npx you could be in any folder, and a database dropped into
 * whatever directory you happened to be in would be lost the next day. So
 * everything lives in one place under your home folder instead.
 *
 * A source checkout keeps everything inside the checkout instead. Someone
 * hacking on Pandan must not have their test runs land on the real board they
 * use every day, so the presence of `web/src` decides it — not a config file
 * that may not exist yet.
 */
export const HOME = process.env.PANDAN_HOME || join(homedir(), '.pandan');

/** True when running from a clone of the source, false from an installed copy. */
export const inRepo = existsSync(join(repoRoot, 'web', 'src'));

/** The .env we should read, or where to write one if there is none yet. */
export function envFile() {
  const local = join(repoRoot, '.env');
  if (existsSync(local)) return local;
  return inRepo ? local : join(HOME, '.env');
}

export function dbFile() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  return inRepo ? join(repoRoot, 'data', 'pandan.db') : join(HOME, 'pandan.db');
}

export { repoRoot };
