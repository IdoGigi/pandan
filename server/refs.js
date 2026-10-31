/**
 * Board keys and card references. A card is known by its board's key and its
 * number on that board — "SCH-3" — which is what you read off the board and
 * what you say to an agent. Nothing here touches the database.
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

/** "SCH-3", "sch-3" or "#SCH-3" → { key: 'SCH', number: 3 }. Anything else → null. */
export function parseRef(value) {
  const match = /^#?([A-Za-z][A-Za-z0-9]{1,5})-(\d{1,9})$/.exec(String(value ?? '').trim());
  return match ? { key: match[1].toUpperCase(), number: Number(match[2]) } : null;
}
