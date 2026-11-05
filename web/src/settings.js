/** View settings live in the browser. Reading them can throw, so never trust it. */
export function readSetting(key, fallback) {
  try {
    const raw = localStorage.getItem(`kanban.${key}`);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
export function writeSetting(key, value) {
  try {
    localStorage.setItem(`kanban.${key}`, JSON.stringify(value));
  } catch {
    /* private window, or storage blocked — the board still works */
  }
}
