/**
 * Keys and card references. A card is known by its project's key and its
 * number in that project — "CRC-3" — which is what you read off the board and
 * what you say to an agent. Cards numbered per board before that keep their
 * board ref ("MB-223") as a second name; a board key is otherwise for display.
 * Nothing here touches the database.
 */

/** 2 to 6 characters, A–Z and 0–9, starting with a letter. Kept in capitals. */
export const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;
const KEY_MAX = 6;

/** A key as typed, in capitals — or undefined when it can never be one. */
export function cleanKey(value) {
  const key = String(value ?? '').trim().toUpperCase();
  return KEY_PATTERN.test(key) ? key : undefined;
}

/**
 * A first key for a board, made from its name: the initials of a name in
 * several words ("My board" → MB), the first three letters of one word
 * ("School" → SCH). A name with no Latin letters, such as a Hebrew one, gets B
 * and the board id. A digit goes on the end while the key is taken.
 */
export function suggestKey(name, boardId, taken) {
  const words = String(name ?? '').toUpperCase().split(/\s+/)
    .map((w) => w.replace(/[^A-Z0-9]/g, ''))
    .filter((w) => /^[A-Z]/.test(w));
  const fromName = words.length > 1
    ? words.slice(0, 4).map((w) => w[0]).join('')
    : (words[0] ?? '').slice(0, 3);
  const base = KEY_PATTERN.test(fromName) ? fromName : `B${boardId}`.slice(0, KEY_MAX);

  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = String(n);
    const candidate = base.slice(0, KEY_MAX - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
}

/** 2 to 5 capital letters. No digits, so a project key never reads as a number. */
export const PROJECT_KEY_PATTERN = /^[A-Z]{2,5}$/;
const PROJECT_KEY_MAX = 5;
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/** A project key as typed, in capitals — or undefined when it can never be one. */
export function cleanProjectKey(value) {
  const key = String(value ?? '').trim().toUpperCase();
  return PROJECT_KEY_PATTERN.test(key) ? key : undefined;
}

/**
 * A first key for a project, made from its name: the initials of a name in
 * several words ("Kigali Irrigation Planner" → KIP), the first three letters of
 * one word ("Website" → WEB). A name with too few Latin letters, such as a
 * Hebrew one, starts from PRJ. While the key is taken, its end gives way to a
 * letter, A to Z, then to two.
 */
export function suggestProjectKey(name, taken) {
  const words = String(name ?? '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const fromName = words.length > 1
    ? words.slice(0, PROJECT_KEY_MAX).map((w) => w[0]).join('')
    : (words[0] ?? '').slice(0, 3);
  const base = PROJECT_KEY_PATTERN.test(fromName) ? fromName : 'PRJ';

  const used = new Set(taken);
  const tails = ['', ...LETTERS, ...LETTERS.flatMap((a) => LETTERS.map((b) => a + b))];
  for (const tail of tails) {
    const candidate = base.slice(0, PROJECT_KEY_MAX - tail.length) + tail;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`PND-REF-009: no free project key starting ${base}`);
}

/** "300" or "#300" → 300: a card's id. Anything else → null. */
export function parseCardId(value) {
  const match = /^#?(\d{1,15})$/.exec(String(value ?? '').trim());
  return match ? Number(match[1]) : null;
}

/** "CRC-3", "crc-3" or "#CRC-3" → { key: 'CRC', number: 3 }. Also an old board ref such as "MB-223". Anything else → null. */
export function parseRef(value) {
  const match = /^#?([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,9})$/.exec(String(value ?? '').trim());
  return match ? { key: match[1].toUpperCase(), number: Number(match[2]) } : null;
}
