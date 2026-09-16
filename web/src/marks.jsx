/**
 * Light text marks for sticky notes, shown formatted when a note is not
 * being edited: **bold**, __underline__, ~~struck~~, and a line that starts
 * with "- " is a bullet. Plain text in, React elements out — never HTML, so
 * nothing a note carries can run.
 */

const INLINE = /(\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~)/g;

/** The text with its marks removed — for places that show plain words, like a dialog. */
export function stripMarks(text) {
  return String(text ?? '')
    .replace(INLINE, (m, whole, b, u, s) => b ?? u ?? s)
    .replace(/^- /gm, '');
}

/** One line: the marks inside it become <b>, <u>, <s>. */
export function renderLine(line, keyBase = 'l') {
  const parts = [];
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(INLINE)) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2] !== undefined) parts.push(<b key={key}>{m[2]}</b>);
    else if (m[3] !== undefined) parts.push(<u key={key}>{m[3]}</u>);
    else parts.push(<s key={key}>{m[4]}</s>);
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

/** Whole text: bullet lines group into a list, other lines stay as they are. */
export function renderMarks(text) {
  const out = [];
  let bullets = null;
  const lines = String(text ?? '').split('\n');
  lines.forEach((line, n) => {
    if (line.startsWith('- ')) {
      if (!bullets) { bullets = []; out.push(bullets); }
      bullets.push(<li key={n}>{renderLine(line.slice(2), `b${n}`)}</li>);
    } else {
      bullets = null;
      out.push(<div key={n} className="mark-line">{renderLine(line, `p${n}`)}</div>);
    }
  });
  return out.map((item, n) => (Array.isArray(item) ? <ul key={`ul${n}`}>{item}</ul> : item));
}
