/**
 * Takes a database back to per-board numbers, as before per-project refs:
 * removes project keys, card refs, old board refs, the ref_keys table and their
 * indexes and triggers. Every card, and its per-board number, stays.
 *
 * Only for an emergency, after the older version is running again: that
 * version ignores the new columns, so rolling back the code alone is enough.
 * Removing them loses the refs for good; migrating again would number the
 * cards afresh, so a ref written down since could then name another card.
 *
 *   node scripts/undo-project-refs.mjs <path to the database>
 *   (or with DB_PATH set, as on the server)
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const file = process.argv[2] ?? process.env.DB_PATH;
if (!file || !existsSync(file)) {
  console.error('PND-REF-013: give the database file to undo, as the first argument or DB_PATH');
  process.exit(1);
}

const db = new DatabaseSync(file);
const has = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

db.exec('BEGIN IMMEDIATE');
try {
  // Triggers and indexes first: SQLite will not drop a column they use.
  db.exec(`
    DROP TRIGGER IF EXISTS cards_ref_never_changes;
    DROP TRIGGER IF EXISTS projects_key_never_changes;
    DROP TRIGGER IF EXISTS ref_keys_never_removed;
    DROP TRIGGER IF EXISTS ref_keys_only_count_up;
    DROP INDEX IF EXISTS idx_cards_ref;
    DROP INDEX IF EXISTS idx_cards_legacy_ref;
    DROP INDEX IF EXISTS idx_projects_key;
    DROP TABLE IF EXISTS ref_keys;
  `);
  for (const column of ['ref_key', 'ref_number', 'legacy_ref']) {
    if (has('cards', column)) db.exec(`ALTER TABLE cards DROP COLUMN ${column}`);
  }
  if (has('projects', 'key')) db.exec('ALTER TABLE projects DROP COLUMN key');
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error(`PND-REF-013: nothing was changed: ${err.message}`);
  process.exit(1);
}
const check = db.prepare('PRAGMA integrity_check').get();
db.close();
console.log(`removed per-project refs from ${file}; integrity ${Object.values(check)[0]}`);
