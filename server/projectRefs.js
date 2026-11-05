/**
 * Project keys and per-project card refs. Every card is known by its project's
 * key and its number there — "CRC-3" — given once and never changed, even when
 * the card moves to another project or board. Cards numbered per board before
 * this keep that board ref as a second name ("MB-223"), so what was written
 * then still finds them.
 *
 * `ref_keys` holds every project key ever given out, with the last number
 * handed out under it. A row is never removed, so a deleted project's key (and
 * so its numbers) is never given out again. The database itself refuses two
 * cards with one ref, and a card's ref or a project's key ever changing.
 *
 * Every function takes the database, so db.js can run the start-up pass while
 * it is still loading.
 */
import { existsSync, readFileSync } from 'node:fs';
import { cleanProjectKey, suggestProjectKey } from './refs.js';

/** The parts the undo script removes; nothing here changes an existing column. */
export function createRefSchema(db, addColumn) {
  addColumn('projects', 'key', 'TEXT');
  addColumn('cards', 'ref_key', 'TEXT');
  addColumn('cards', 'ref_number', 'INTEGER');
  addColumn('cards', 'legacy_ref', 'TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ref_keys (
      key         TEXT    PRIMARY KEY,
      last_number INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_key     ON projects(key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_ref        ON cards(ref_key, ref_number);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_legacy_ref ON cards(legacy_ref);

    CREATE TRIGGER IF NOT EXISTS cards_ref_never_changes
    BEFORE UPDATE OF ref_key, ref_number, legacy_ref ON cards
    WHEN ((OLD.ref_key IS NOT NULL OR OLD.ref_number IS NOT NULL)
          AND (NEW.ref_key IS NOT OLD.ref_key OR NEW.ref_number IS NOT OLD.ref_number))
      OR (OLD.legacy_ref IS NOT NULL AND NEW.legacy_ref IS NOT OLD.legacy_ref)
    BEGIN SELECT RAISE(ABORT, 'PND-REF-007: a card''s ref never changes'); END;

    CREATE TRIGGER IF NOT EXISTS projects_key_never_changes
    BEFORE UPDATE OF key ON projects
    WHEN OLD.key IS NOT NULL AND NEW.key IS NOT OLD.key
    BEGIN SELECT RAISE(ABORT, 'PND-REF-010: a project''s key never changes'); END;

    CREATE TRIGGER IF NOT EXISTS ref_keys_never_removed
    BEFORE DELETE ON ref_keys
    BEGIN SELECT RAISE(ABORT, 'PND-REF-011: a project key, once given, is kept for good'); END;

    CREATE TRIGGER IF NOT EXISTS ref_keys_only_count_up
    BEFORE UPDATE ON ref_keys
    WHEN NEW.key IS NOT OLD.key OR NEW.last_number < OLD.last_number
    BEGIN SELECT RAISE(ABORT, 'PND-REF-011: a project key keeps its name, and its count only goes up'); END;
  `);
}

/** Every key a new project key may not be: given ones, board keys, and the start of any old board ref. */
function takenKeys(db) {
  return new Set([
    ...db.prepare('SELECT key FROM ref_keys').all().map((r) => r.key),
    ...db.prepare('SELECT key FROM boards WHERE key IS NOT NULL').all().map((r) => r.key),
    ...db.prepare(
      "SELECT DISTINCT substr(legacy_ref, 1, instr(legacy_ref, '-') - 1) AS key FROM cards WHERE legacy_ref IS NOT NULL"
    ).all().map((r) => r.key),
  ]);
}

/**
 * Why a project key cannot be used, as `{ code, reason }`, or null when it can.
 * `typed` is the key as given, in any case.
 */
export function projectKeyProblem(db, typed) {
  const key = cleanProjectKey(typed);
  if (!key) return { code: 'PND-REF-001', reason: `"${typed}" is not 2 to 5 capital letters, like CRC` };
  const given = db.prepare(
    'SELECT k.key, p.id, p.name FROM ref_keys k LEFT JOIN projects p ON p.key = k.key WHERE k.key = ?'
  ).get(key);
  if (given) {
    return {
      code: 'PND-REF-002',
      reason: given.id
        ? `"${key}" is already the key of the project "${given.name}"`
        : `"${key}" was the key of a deleted project, and a key is never given out twice`,
    };
  }
  const board = db.prepare('SELECT name FROM boards WHERE key = ?').get(key);
  if (board) return { code: 'PND-REF-003', reason: `"${key}" is the key of the board "${board.name}"` };
  const old = db.prepare('SELECT legacy_ref FROM cards WHERE legacy_ref LIKE ? LIMIT 1').get(`${key}-%`);
  if (old) return { code: 'PND-REF-003', reason: `"${key}" starts old board refs like ${old.legacy_ref}` };
  return null;
}

/** Why a board key cannot be used because a project has it, or null. Board keys are for display only. */
export function boardKeyClash(db, key) {
  if (!db.prepare('SELECT 1 FROM ref_keys WHERE key = ?').get(key)) return null;
  return {
    code: 'PND-REF-004',
    reason: `${key} is a project key, so ${key}-1 would name two cards`,
  };
}

/** Gives a project its key, for good. The caller has checked it, or it came from suggestProjectKey. */
export function giveKey(db, projectId, key) {
  db.prepare('INSERT INTO ref_keys (key) VALUES (?)').run(key);
  db.prepare('UPDATE projects SET key = ? WHERE id = ?').run(key, projectId);
}

/** A key made from a project's name that nothing has yet. */
export const suggestKeyFor = (db, name) => suggestProjectKey(name, takenKeys(db));

/** The next ref in a project: its key and the next number under it. The counter only goes up. */
export function takeRef(db, projectId) {
  const row = db.prepare(
    `UPDATE ref_keys SET last_number = last_number + 1
      WHERE key = (SELECT key FROM projects WHERE id = ?) RETURNING key, last_number`
  ).get(projectId);
  if (!row) throw new Error(`PND-REF-012: project ${projectId} has no key, so its card cannot be numbered`);
  return { key: row.key, number: row.last_number };
}

/**
 * Keys chosen ahead for projects that have none yet, from project-keys.json
 * beside the database: `{ "<project id>": "CRC", ... }`. It is read only while
 * some project has no key. Entries for projects that have a key are skipped,
 * and ones for projects that no longer exist are skipped with a line in the
 * log, so the file can stay. Anything else wrong throws, and nothing is saved.
 */
function chosenKeys(db, file) {
  const keyless = new Set(db.prepare('SELECT id FROM projects WHERE key IS NULL').all().map((p) => p.id));
  if (!keyless.size || !file || !existsSync(file)) return new Map();
  const fail = (why) => { throw new Error(`PND-REF-005: ${why}. Fix ${file}, or remove it to have keys made from names.`); };
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('project-keys.json is not a JSON object');

  const entries = Object.entries(parsed);
  const notAnId = entries.find(([id]) => !/^[1-9]\d*$/.test(id));
  if (notAnId) fail(`"${notAnId[0]}" is not a project id`);
  const chosen = new Map();
  const owner = new Map();
  for (const [id, typed] of entries.sort(([a], [b]) => Number(a) - Number(b))) {
    if (!keyless.has(Number(id))) {
      if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(Number(id))) {
        console.log(`[db] project-keys.json: no project ${id}, skipped`);
      }
      continue;
    }
    const key = cleanProjectKey(typed);
    if (!key) fail(`project ${id}: "${typed}" is not 2 to 5 capital letters`);
    if (owner.has(key)) fail(`project ${id}: "${key}" is already the key of project ${owner.get(key)}`);
    const problem = projectKeyProblem(db, key);
    if (problem) fail(`project ${id}: ${problem.reason}`);
    owner.set(key, id);
    chosen.set(Number(id), key);
  }
  return chosen;
}

/**
 * Brings every row up to per-project refs, in one transaction. Projects with
 * no key get the one chosen for them or one made from the name, oldest first.
 * Cards with a board number and no old ref keep it as `legacy_ref`. Cards with
 * no ref get the next numbers in their project, oldest first. Only rows that
 * need it are touched, so this runs on every start — and also gives refs to
 * cards an older version made after a rollback.
 */
export function backfillProjectRefs(db, inTransaction, keysFile) {
  return inTransaction(() => {
    const chosen = chosenKeys(db, keysFile);
    const keyless = db.prepare('SELECT id, name FROM projects WHERE key IS NULL ORDER BY id').all();
    const reserved = new Set([...takenKeys(db), ...chosen.values()]);
    for (const project of keyless) {
      const key = chosen.get(project.id) ?? suggestProjectKey(project.name, reserved);
      reserved.add(key);
      giveKey(db, project.id, key);
    }

    // A counter behind its highest number would hand that number out again.
    db.exec(`UPDATE ref_keys SET last_number = MAX(last_number, COALESCE(
      (SELECT MAX(ref_number) FROM cards WHERE cards.ref_key = ref_keys.key), 0))`);

    const unnumbered = db.prepare('SELECT id, project_id FROM cards WHERE ref_key IS NULL ORDER BY id').all();
    for (const card of unnumbered) {
      const { key, number } = takeRef(db, card.project_id);
      db.prepare('UPDATE cards SET ref_key = ?, ref_number = ? WHERE id = ?').run(key, number, card.id);
    }

    // The board ref a card was known by. Unique already, as board keys and numbers on a board are.
    // One that starts with a project key (an older version, run after a rollback, does not check
    // board keys against them) could read as a real ref, so it is left out rather than shadowed.
    const unnamed = db.prepare(
      `SELECT c.id, b.key, b.key || '-' || c.number AS old FROM cards c
         JOIN projects p ON p.id = c.project_id JOIN boards b ON b.id = p.board_id
        WHERE c.legacy_ref IS NULL AND c.number IS NOT NULL AND b.key IS NOT NULL ORDER BY c.id`
    ).all();
    let kept = 0;
    for (const card of unnamed) {
      if (db.prepare('SELECT 1 FROM ref_keys WHERE key = ?').get(card.key)) {
        console.log(`[db] old ref ${card.old} of card ${card.id} starts with a project key, so it is not kept`);
        continue;
      }
      if (db.prepare('SELECT 1 FROM cards WHERE legacy_ref = ?').get(card.old)) continue;
      db.prepare('UPDATE cards SET legacy_ref = ? WHERE id = ?').run(card.old, card.id);
      kept += 1;
    }
    return { projects: keyless.length, cards: unnumbered.length, kept };
  });
}
