/**
 * Headless smoke test: mounts the real App in jsdom against a fake API and
 * drives the flows a person actually does. Any React error, thrown exception
 * or console.error fails the run.
 *
 *   node web/smoke.mjs
 */
import { JSDOM } from 'jsdom';
import esbuild from 'esbuild';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const problems = [];

/* ---- fake board data ---- */
const state = {
  boards: [
    { id: 1, name: 'Work', key: 'WRK', position: 1000, created_at: '2026-08-01', projects: 3 },
    { id: 2, name: 'Personal', key: 'PER', position: 2000, created_at: '2026-08-02', projects: 0 },
  ],
  projects: [
    { id: 1, name: 'House chores', color: '#c3d117', position: 1000, archived: 0 },
    { id: 2, name: 'Volunteering', color: '#4bb3d4', position: 2000, archived: 0 },
    { id: 3, name: 'smart-city-dashboard', color: '#e2725b', position: 3000, archived: 0 },
  ],
  archived: [
    { id: 77, number: 9, ref: 'WRK-9', title: 'an archived card', color: 'rose', project_name: 'House chores',
      archived_at: '2026-09-01 10:00' },
  ],
  archivedProjects: [
    { id: 8, name: 'Old garden plan', color: '#8899aa', position: 4000, archived: 1 },
  ],
  notes: [],
  tokens: [
    { id: 1, name: 'laptop agent', prefix: 'pnd_aaa111',
      created_at: '2026-08-01 09:00', last_used_at: '2026-09-01 09:30', revoked_at: null },
  ],
  cards: [
    // Ids are global, numbers are per board — so they differ on purpose here.
    { id: 10, number: 1, ref: 'WRK-1', project_id: 1, column_key: 'todo', title: 'Buy milk', notes: '', color: 'lime',
      flagged: 0, position: 1000, checks_total: 2, checks_done: 1 },
    { id: 11, number: 2, ref: 'WRK-2', project_id: 1, column_key: 'doing', title: 'Fix the sink', notes: 'call plumber',
      color: 'plain', flagged: 1, position: 1000, checks_total: 0, checks_done: 0,
      due_date: '2020-01-01' },
    { id: 12, number: 3, ref: 'WRK-3', project_id: 2, column_key: 'done', title: 'Sort donations',
      notes: 'covid-19 drive', color: 'sky', flagged: 0, position: 1000, checks_total: 0, checks_done: 0 },
    { id: 13, number: 4, ref: 'WRK-4', project_id: 1, column_key: 'review', title: 'Written by an agent', notes: '',
      color: 'plain', flagged: 0, position: 1000, checks_total: 0, checks_done: 0,
      last_actor: 'Claude on laptop', last_actor_kind: 'agent' },
  ],
  // What GET /insights says (the fake answers for whichever board is asked). The cards are the
  // fake ones above (and the archived WRK-9); the lists are canned, so the steps can check order and counts.
  insights: {
    board: { id: 1, name: 'Work', key: 'WRK' }, quiet_days: 7, history_since: '2026-11-05',
    stuck: { waiting: [12, 11], flagged: [10], overdue: [], quiet: [11] },
    projects: [{ id: 1, name: 'House chores', color: '#c3d117',
      by_column: { todo: [10], next: [], doing: [], waiting: [12], review: [13] } },
    // A Hebrew name, as on the School board: too long for its slot, and read right to left.
    { id: 4, name: 'ניתוח מערכות מידע', color: '#9b8ec4',
      by_column: { todo: [], next: [], doing: [], waiting: [], review: [] } }],
    weeks: Array.from({ length: 12 }, (_, i) => ({
      start: new Date(Date.UTC(2026, 7, 16 + 7 * i)).toISOString().slice(0, 10),
      added: i === 11 ? [10, 12] : [], finished: i === 9 ? [77] : [], estimated: i === 9 })),
    time_in_column: Object.fromEntries(['todo', 'next', 'doing', 'waiting', 'review'].map((c) => [c,
      c === 'doing' ? { median_days: 2.5, moves: 3, longest: [12, 11], longest_days: [6.5, 1] }
      // Under an hour rounds to 0 days; that bar must still show and click.
      : c === 'review' ? { median_days: 0, moves: 1, longest: [13], longest_days: [0] }
      : { median_days: null, moves: 0, longest: [], longest_days: [] }])),
    agents: { review_from_agents: [13], this_week: [13],
      weeks: Array.from({ length: 12 }, (_, i) => ({ start: '', agent: i === 11 ? [13] : [], you: i === 11 ? [10] : [] })) },
    cards: {
      10: { id: 10, ref: 'WRK-1', title: 'Buy milk', project_id: 1, column_key: 'todo', flagged: 1, due_date: null, updated_at: '2026-11-01 10:00:00', archived: false },
      11: { id: 11, ref: 'WRK-2', title: 'Fix the sink', project_id: 1, column_key: 'doing', flagged: 0, due_date: null, updated_at: '2026-10-20 10:00:00', archived: false },
      12: { id: 12, ref: 'WRK-3', title: 'Sort donations', project_id: 1, column_key: 'waiting', flagged: 0, due_date: null, updated_at: '2026-10-30 10:00:00', archived: false },
      13: { id: 13, ref: 'WRK-4', title: 'Written by an agent', project_id: 1, column_key: 'review', flagged: 0, due_date: null, updated_at: '2026-11-02 10:00:00', archived: false },
      77: { id: 77, ref: 'WRK-9', title: 'an archived card', project_id: 1, column_key: 'done', flagged: 0, due_date: null, updated_at: '2026-10-15 10:00:00', archived: true },
    },
  },
};

function fakeFetch(url, opts = {}) {
  const path = String(url).replace('/api', '');
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : {};
  const json = (data, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });

  if (path === '/about') return json({
    name: 'Pandan', version: '1.0.0', description: 'test', license: 'MIT',
    node: 'v24.0.0', repo: null, issues: null, contributing: null,
    columns: ['todo', 'next', 'doing', 'waiting', 'review', 'done'],
    counts: { projects: 3, cards: 3 },
  });
  if (path === '/cards?archived=true') return json(state.archived);
  if (path === '/projects?archived=true') return json(state.archivedProjects);
  if (/^\/projects\/\d+$/.test(path) && method === 'PATCH' && body.archived === false) {
    const id = Number(path.split('/')[2]);
    state.archivedProjects = state.archivedProjects.filter((p) => p.id !== id);
    return json({ id, archived: 0 });
  }
  if (/^\/boards\/\d+\/notes$/.test(path) && method === 'GET') return json(state.notes);
  if (/^\/boards\/\d+\/notes$/.test(path) && method === 'POST') {
    const note = { id: 300 + state.notes.length, board_id: 1, text: body.text || '',
      color: body.color || 'amber', x: body.x || 0, y: body.y || 0 };
    state.notes = [...state.notes, note];
    return json(note, 201);
  }
  if (/^\/notes\/\d+$/.test(path) && method === 'PATCH') {
    const id = Number(path.split('/')[2]);
    state.notes = state.notes.map((n) => (n.id === id ? { ...n, ...body } : n));
    return json(state.notes.find((n) => n.id === id));
  }
  if (/^\/notes\/\d+$/.test(path) && method === 'DELETE') {
    const id = Number(path.split('/')[2]);
    state.notes = state.notes.filter((n) => n.id !== id);
    return json({ deleted: true });
  }
  if (/\/cards\/\d+\/restore$/.test(path)) {
    const id = Number(path.split('/')[2]);
    state.archived = state.archived.filter((c) => c.id !== id);
    return json({ id });
  }
  if (/\/cards\/\d+\/permanent$/.test(path)) {
    const id = Number(path.split('/')[2]);
    state.archived = state.archived.filter((c) => c.id !== id);
    return json({ deleted: true });
  }
  if (/\/boards\/\d+\/labels\//.test(path)) return json({ color: 'rose', name: body.name });
  if (path === '/tokens' && method === 'GET') return json(state.tokens);
  if (path === '/tokens' && method === 'POST') {
    const row = { id: 9, name: body.name, prefix: 'pnd_abc123',
      created_at: '2026-09-01 10:00', last_used_at: null, revoked_at: null };
    state.tokens = [row, ...state.tokens];
    return json({ ...row, token: 'pnd_thisisthesecretshownonce' }, 201);
  }
  if (path.startsWith('/tokens/') && method === 'DELETE') {
    const id = Number(path.split('/')[2]);
    state.tokens = state.tokens.map((t) => (t.id === id ? { ...t, revoked_at: '2026-09-01 11:00' } : t));
    return json({ revoked: true });
  }
  if (path === '/me') return json({ ok: true });
  if (path === '/login') return json({ ok: true });
  if (path === '/logout') return json({ ok: true });
  if (path === '/boards' && method === 'GET') return json(state.boards);
  if (path === '/boards' && method === 'POST') {
    const row = { id: 3, name: body.name, key: 'NEW', position: 3000, created_at: '2026-09-01', projects: 0 };
    state.boards = [...state.boards, row];
    return json(row, 201);
  }
  if (path.startsWith('/boards/') && method === 'DELETE') {
    const id = Number(path.split('/')[2]);
    state.boards = state.boards.filter((b) => b.id !== id);
    return json({ deleted: true });
  }
  if (path.startsWith('/boards/')) return json({ id: 1, name: body.name || 'Work', key: body.key || 'WRK' });
  if (path.startsWith('/insights')) {
    // A fresh copy for the board asked about, as the server would answer.
    const id = Number((path.match(/board_id=(\d+)/) || [])[1]);
    const copy = structuredClone(state.insights);
    return json({ ...copy, board: { ...copy.board, id } });
  }
  if (path.startsWith('/board')) {
    const id = Number((path.match(/board_id=(\d+)/) || [])[1] || 1);
    const board = state.boards.find((b) => b.id === id) || state.boards[0];
    // Only board 1 has the seeded projects; board 2 is empty.
    const empty = board.id !== 1;
    return json({
      columns: ['todo', 'next', 'doing', 'waiting', 'review', 'done'],
      board: { id: board.id, name: board.name, key: board.key },
      projects: empty ? [] : state.projects,
      cards: empty ? [] : state.cards,
      labels: { rose: 'Blocked' },
    });
  }
  if (path.startsWith('/cards/') && path.endsWith('/move')) return json({ id: 10 });
  if (path.startsWith('/cards/') && path.endsWith('/checks')) return json({ id: 99, text: body.text, done: 0, position: 1000 }, 201);
  if (/^\/cards\/\d+$/.test(path) && method === 'GET') {
    const card = state.cards.find((c) => c.id === Number(path.split('/')[2]));
    return json({ ...card, checklist: [{ id: 1, text: 'step one', done: 1, position: 1000 }] });
  }
  if (/^\/cards\/\d+$/.test(path)) return json({ id: 10 });
  if (path === '/cards') return json({ id: 77 }, 201);
  if (path.startsWith('/checks/')) return json({ id: 1 });
  const detail = path.match(/^\/projects\/(\d+)$/);
  if (detail && method === 'GET') {
    const id = Number(detail[1]);
    const p = state.projects.find((x) => x.id === id);
    const cards = state.cards.filter((c) => c.project_id === id);
    const by_column = { todo: 0, next: 0, doing: 0, waiting: 0, review: 0, done: 0 };
    for (const c of cards) by_column[c.column_key] += 1;
    return json({
      ...p, created_at: '2026-09-01 00:00:00', cards,
      description: 'notes about it', repo_url: 'https://github.com/x/y',
      links: [{ id: 1, kind: 'link', label: 'Staging', value: 'https://s.example.com', href: 'https://s.example.com' },
              { id: 2, kind: 'link', label: 'bad', value: 'javascript:alert(1)', href: null }],
      contacts: [{ id: 3, kind: 'contact', label: 'Dana', value: 'mailto:d@e.com', href: 'mailto:d@e.com' }],
      updates: [{ id: 1, text: 'shipped it', created_at: '2026-09-01 10:00:00' }],
      stats: {
        total: cards.length, open: cards.length - by_column.done, by_column,
        flagged: cards.filter((c) => c.flagged).length,
        checks_total: 2, checks_done: 1,
        percent_done: cards.length ? Math.round((by_column.done / cards.length) * 100) : 0,
        last_activity: '2026-09-01 00:00:00',
      },
    });
  }
  if (/\/links$/.test(path)) return json({ id: 9, kind: 'link', label: 'a', value: 'b', href: null }, 201);
  if (/\/updates$/.test(path)) return json({ id: 9, text: 'x', created_at: '2026-09-01 11:00:00' }, 201);
  if (path.startsWith('/links/') || path.startsWith('/updates/')) return json({ deleted: true });
  if (path.startsWith('/projects')) return json({ id: 3 }, 201);
  return json({ error: 'not found' }, 404);
}

/* ---- bundle the real source ---- */
// Bundle must live inside web/ so Node resolves react from web/node_modules.
const outfile = join(process.cwd(), '.smoke-bundle.mjs');

await esbuild.build({
  entryPoints: ['src/App.jsx'],
  bundle: true,
  format: 'esm',
  outfile,
  jsx: 'automatic',
  loader: { '.css': 'empty' },
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
  logLevel: 'silent',
});

/* ---- jsdom environment ---- */
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000/',
  pretendToBeVisual: true,
});

dom.window.document.head.insertAdjacentHTML(
  'beforeend',
  `<style>${readFileSync('src/styles.css', 'utf8')}</style>`
);

const g = globalThis;
g.window = dom.window;
g.localStorage = dom.window.localStorage;
dom.window.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.requestAnimationFrame = (cb) => setTimeout(cb, 0);
g.cancelAnimationFrame = clearTimeout;
g.IS_REACT_ACT_ENVIRONMENT = true;
g.fetch = fakeFetch;
dom.window.fetch = fakeFetch;
// The app must never use native popups again — make them fail loudly.
/** jsdom has no EventSource, so stand in a small one the tests can drive. */
const streams = [];
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    this.closed = false;
    streams.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, data) { for (const fn of this.listeners[type] || []) fn({ data: JSON.stringify(data) }); }
  close() { this.closed = true; }
}
g.EventSource = FakeEventSource;
dom.window.EventSource = FakeEventSource;

dom.window.prompt = () => { throw new Error('window.prompt was called'); };
dom.window.confirm = () => { throw new Error('window.confirm was called'); };
dom.window.alert = () => { throw new Error('window.alert was called'); };

// React tracks input values with its own setter, so set through that.
const setNativeValue = (el, value) => {
  const proto = el instanceof dom.window.HTMLTextAreaElement
    ? dom.window.HTMLTextAreaElement.prototype
    : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
};

dom.window.addEventListener('error', (e) => problems.push(`window error: ${e.message}`));
const realError = console.error;
console.error = (...args) => {
  const text = args.map(String).join(' ');
  if (!/not wrapped in act|ReactDOMTestUtils/.test(text)) problems.push(`console.error: ${text}`);
  realError(...args);
};

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { App } = await import(pathToFileURL(outfile).href);

const container = document.getElementById('root');
let root = createRoot(container);

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };
const remount = async () => {
  await act(async () => { root.unmount(); });
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(App)); });
  await settle();
};
const q = (sel) => [...container.querySelectorAll(sel)];
/**
 * The full sequence a browser sends, each event in its own act() so React
 * re-renders in between — exactly as it does for a real pointer. Firing them
 * all in one act() hides any handler that unmounts on pointerdown.
 */
const click = async (el) => {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const Ctor = type.startsWith('pointer') ? dom.window.Event : dom.window.MouseEvent;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true }));
    });
  }
  await settle();
};

const step = async (name, fn) => {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (e) { problems.push(`${name}: ${e.message}`); console.log(`  FAIL  ${name}: ${e.message}`); }
};

console.log('\nKanban UI smoke test\n');

await act(async () => { root.render(React.createElement(App)); });
await settle();

await step('board renders after load', () => {
  const text = container.textContent;
  if (!text.includes('House chores')) throw new Error('project row missing');
  if (!text.includes('Buy milk')) throw new Error('card missing');
  if (!text.includes('In progress')) throw new Error('In progress header missing');
});

await step('all six columns present, with Waiting under In progress', () => {
  const heads = q('.head-col').map((n) => n.textContent);
  for (const label of ['To do', 'Next', 'Doing', 'Waiting', 'Review', 'Done']) {
    if (!heads.includes(label)) throw new Error(`missing column ${label}`);
  }
  const group = q('.head-group')[0].style.gridColumn;
  const waiting = q('.head-col').find((n) => n.textContent === 'Waiting').style.gridColumn;
  if (group !== '3 / 6' || waiting !== '5') throw new Error(`In progress spans ${group}, Waiting sits at ${waiting}`);
  if (q('.list.waiting').length !== state.projects.length) throw new Error('every project should have a Waiting cell');
});

await step('a card can be dragged into Review', async () => {
  const card = q('.card')[0];
  const review = q('.list.review')[0];
  if (!review) throw new Error('no Review cell');

  let moved = null;
  const prev = g.fetch;
  const spy = (url, opts = {}) => {
    if (/\/move$/.test(String(url))) moved = JSON.parse(opts.body);
    return prev(url, opts);
  };
  g.fetch = spy; dom.window.fetch = spy;

  const dt = { data: {}, effectAllowed: '', dropEffect: '', setData() {}, getData() { return ''; } };
  const fire = async (el, type, extra = {}) => {
    await act(async () => {
      const ev = new dom.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      Object.assign(ev, extra);
      el.dispatchEvent(ev);
    });
  };
  await fire(card, 'dragstart');
  await fire(review, 'dragover', { clientY: 5 });
  await fire(review, 'drop', { clientY: 5 });
  await fire(card, 'dragend');
  await settle();

  g.fetch = prev; dom.window.fetch = prev;
  if (moved?.column_key !== 'review') throw new Error(`expected a move to review, got ${JSON.stringify(moved)}`);
});

await step('every card shows its reference', () => {
  const cards = q('.card');
  const refs = q('.card-no').map((n) => n.textContent);
  if (refs.length !== cards.length) {
    throw new Error(`${cards.length} cards but ${refs.length} references`);
  }
  // The reference, not the id, since that is what you say to an agent.
  const expected = new Set(state.cards.map((c) => c.ref));
  if (!refs.every((t) => expected.has(t))) {
    throw new Error(`references should read like WRK-1, got: ${refs.join(', ')}`);
  }
  const first = q('.card')[0].closest('[data-card]');
  if (!first) throw new Error('card wrapper missing');
});

await step('a card being created has no number yet', async () => {
  const add = q('.add-card')[0];
  await click(add);
  const box = q('.quick-input')[0];
  await act(async () => { setNativeValue(box, 'brand new card'); });
  await act(async () => {
    box.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  // Straight after adding, the optimistic card has no reference yet — showing
  // "tmp-123" or "WRK-undefined" would be worse than showing nothing.
  const bad = q('.card-no').map((n) => n.textContent).filter((t) => !/^WRK-\d+$/.test(t));
  if (bad.length) throw new Error(`bad numbers on a pending card: ${bad.join(', ')}`);
  await settle();
});

await step('checklist count shows on card', () => {
  if (!container.textContent.includes('1/2')) throw new Error('checklist badge missing');
});

await step('flagged card shows a dot', () => {
  if (q('.card-flag').length !== 1) throw new Error(`expected 1 flag, got ${q('.card-flag').length}`);
});

await step('open a card modal', async () => {
  const card = q('.card')[0];
  if (!card) throw new Error('no cards to click');
  await click(card);
  if (!document.querySelector('.modal')) throw new Error('modal did not open');
});

await step('close the modal', async () => {
  const cancel = [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Cancel');
  if (!cancel) throw new Error('cancel button missing');
  await click(cancel);
  if (document.querySelector('.modal')) throw new Error('modal did not close');
});

await step('quick add a card', async () => {
  const add = q('.add-card')[0];
  if (!add) throw new Error('add button missing');
  await click(add);
  const box = q('.quick-input')[0];
  if (!box) throw new Error('quick input did not appear');
  await act(async () => { setNativeValue(box, 'Smoke test card'); });
  await act(async () => {
    box.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await settle();
});

await step('add a project through the in-app dialog', async () => {
  const btn = q('.topbar .btn').find((b) => b.textContent.includes('Project'));
  if (!btn) throw new Error('add project button missing');
  await click(btn);

  const dlg = document.querySelector('.modal-sm');
  if (!dlg) throw new Error('dialog did not open');
  if (!dlg.textContent.includes('New project')) throw new Error('wrong dialog title');

  const ok = [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Add project');
  if (!ok.disabled) throw new Error('confirm should be disabled while the name is empty');

  const input = dlg.querySelector('.input');
  await act(async () => { setNativeValue(input, 'Side project'); });
  await settle();
  if (ok.disabled) throw new Error('confirm still disabled after typing');

  await click(ok);
  if (document.querySelector('.modal-sm')) throw new Error('dialog did not close');
});

await step('escape closes the dialog', async () => {
  const btn = q('.topbar .btn').find((b) => b.textContent.includes('Project'));
  await click(btn);
  if (!document.querySelector('.modal-sm')) throw new Error('dialog did not open');
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await settle();
  if (document.querySelector('.modal-sm')) throw new Error('escape did not close the dialog');
});

await step('archiving a card asks first, and keeps the card modal open on cancel', async () => {
  await click(q('.card')[0]);
  if (!document.querySelector('.modal')) throw new Error('card modal did not open');
  const archive = [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Archive');
  if (!archive) throw new Error('card archive button missing');
  await click(archive);
  if (!document.querySelector('.modal-sm')) throw new Error('archive confirm did not open');
  const cancel = [...document.querySelectorAll('.modal-sm .btn')].find((b) => b.textContent === 'Cancel');
  await click(cancel);
  if (document.querySelector('.modal-sm')) throw new Error('confirm did not close');
  if (!document.querySelector('.modal')) throw new Error('card modal closed too — click leaked through');
  const cardCancel = [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Cancel');
  await click(cardCancel);
});

await step('filter to one project', async () => {
  const sel = q('.project-filter')[0];
  if (!sel) throw new Error('filter missing');
  await act(async () => {
    sel.value = '2';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await settle();
  const rows = q('.row-label .name').map((n) => n.textContent);
  if (rows.includes('House chores')) throw new Error('filter did not hide other projects');
  if (!rows.includes('Volunteering')) throw new Error('filter hid the chosen project');
});

await step('filter back to all projects', async () => {
  const sel = q('.project-filter')[0];
  await act(async () => {
    sel.value = 'all';
    sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await settle();
  if (q('.row-label .name').length < 2) throw new Error('not all projects came back');
});

await step('drag a card into another column', async () => {
  const card = q('.card')[0];
  if (!card) throw new Error('no card to drag');
  const lists = q('.list');
  const target = lists[lists.length - 1];
  if (!target) throw new Error('no target list');

  const dt = {
    data: {},
    effectAllowed: '',
    dropEffect: '',
    setData(k, v) { this.data[k] = v; },
    getData(k) { return this.data[k]; },
  };
  const fire = async (el, type, extra = {}) => {
    await act(async () => {
      const ev = new dom.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      Object.assign(ev, extra);
      el.dispatchEvent(ev);
    });
  };

  await fire(card, 'dragstart');
  await fire(target, 'dragover', { clientY: 5 });
  await fire(target, 'drop', { clientY: 5 });
  await fire(card, 'dragend');
  await settle();
});

await step('dragleave with a null relatedTarget', async () => {
  const list = q('.list')[0];
  await act(async () => {
    const ev = new dom.window.Event('dragleave', { bubbles: true });
    Object.defineProperty(ev, 'relatedTarget', { value: null });
    list.dispatchEvent(ev);
  });
  await settle();
});

await step('Enter then blur must not add the card twice', async () => {
  let posts = 0;
  const prev = g.fetch;
  const counting = (url, opts = {}) => {
    if (String(url) === '/api/cards' && (opts.method || 'GET') === 'POST') posts += 1;
    return prev(url, opts);
  };
  g.fetch = counting; dom.window.fetch = counting;

  const add = q('.add-card')[0];
  await click(add);
  const box = q('.quick-input')[0];
  await act(async () => { setNativeValue(box, 'Double add probe'); });
  await act(async () => {
    box.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await act(async () => { box.dispatchEvent(new dom.window.Event('blur', { bubbles: true })); });
  await settle();

  g.fetch = prev; dom.window.fetch = prev;
  if (posts !== 1) throw new Error(`card was POSTed ${posts} times, expected 1`);
});

await step('clicking a project name opens the project panel', async () => {
  const nameBtn = q('.row-label .name')[0];
  if (!nameBtn) throw new Error('project name is not clickable');
  await click(nameBtn);
  const panel = document.querySelector('.modal-wide');
  if (!panel) throw new Error('project panel did not open');
  if (!panel.querySelector('.project-name')) throw new Error('name field missing');
  if (!panel.querySelector('.pipeline-bar')) throw new Error('pipeline bar missing');
  const legend = [...panel.querySelectorAll('.pipe-key')].map((k) => k.textContent.replace(/\s*\d+$/, ''));
  if (legend.join() !== 'To do,Next,Doing,Waiting,Review,Done') throw new Error(`legend should name all six columns, got ${legend}`);
  if (!panel.querySelector('.mini-card')) throw new Error('card list missing');
  const cols = panel.querySelectorAll('.project-col');
  if (cols.length !== 6) throw new Error(`all six columns should show, got ${cols.length}`);
  const list = panel.querySelector('.project-col-list');
  const lcss = dom.window.getComputedStyle(list);
  if (!lcss.maxHeight || lcss.maxHeight === 'none') throw new Error('a column should scroll past a few cards');
});

await step('project panel shows the right counts', async () => {
  const panel = document.querySelector('.modal-wide');
  const mine = state.cards.filter((c) => c.project_id === 1);
  const facts = panel.querySelector('.pipeline-facts').textContent;
  if (!facts.startsWith(`${mine.length} cards`)) throw new Error(`card count wrong, expected ${mine.length}: ${facts}`);
  if (!facts.includes('% done')) throw new Error('percent missing');
  // One segment per column that has cards, sized by its count; empty columns get none.
  const segs = [...panel.querySelectorAll('.pipe-seg')];
  const inTodo = mine.filter((c) => c.column_key === 'todo').length;
  const todoSeg = segs.find((el) => el.classList.contains('pipe-todo'));
  if (!todoSeg || todoSeg.textContent !== String(inTodo)) throw new Error('To do segment wrong');
  if (todoSeg.style.flexGrow !== String(inTodo)) throw new Error('segment should be sized by its count');
  if (segs.some((el) => el.classList.contains('pipe-next'))) throw new Error('an empty column should have no segment');
  if (!todoSeg.getAttribute('title')?.includes('To do')) throw new Error('segment should name its column on hover');
});

await step('a card in the panel opens that card', async () => {
  const mini = document.querySelector('.modal-wide .mini-card');
  await click(mini);
  if (document.querySelector('.modal-wide')) throw new Error('project panel should close');
  if (!document.querySelector('.modal')) throw new Error('card modal did not open');
  const cancel = [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Cancel');
  await click(cancel);
});

await step('project panel Save stays off until something changes', async () => {
  await click(q('.row-label .name')[0]);
  const panel = document.querySelector('.modal-wide');
  const save = [...panel.querySelectorAll('.btn')].find((b) => b.textContent === 'Save');
  if (!save.disabled) throw new Error('Save should start disabled');
  const input = panel.querySelector('.project-name');
  await act(async () => { setNativeValue(input, 'Renamed project'); });
  await settle();
  if (save.disabled) throw new Error('Save should enable after an edit');
  const close = [...panel.querySelectorAll('.btn')].find((b) => b.textContent === 'Close');
  await click(close);
});

await step('a whole project can be archived from its panel', async () => {
  let sent = null;
  const prev = g.fetch;
  const spy = (url, opts = {}) => {
    if (/\/projects\/\d+$/.test(String(url)) && opts.method === 'PATCH') sent = JSON.parse(opts.body);
    return prev(url, opts);
  };
  g.fetch = spy; dom.window.fetch = spy;

  await click(q('.row-label .name')[0]);
  const panel = document.querySelector('.modal-wide');
  const archive = [...panel.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Archive project');
  if (!archive) throw new Error('no Archive project button');
  await click(archive);
  const confirm = document.querySelector('.modal-sm');
  if (!confirm) throw new Error('archive confirm did not open');
  if (!confirm.textContent.includes('bring it back')) throw new Error('confirm should say it is reversible');
  await click([...confirm.querySelectorAll('.btn')].find((b) => b.textContent === 'Archive'));
  if (sent?.archived !== true) throw new Error(`expected archived:true, got ${JSON.stringify(sent)}`);
  if (document.querySelector('.modal-wide')) throw new Error('project panel should close after archiving');

  g.fetch = prev; dom.window.fetch = prev;
});

await step('project panel holds notes, repo, links, contacts and the log', async () => {
  await click(q('.row-label .name')[0]);
  const panel = document.querySelector('.modal-wide');
  if (!panel) throw new Error('panel did not open');
  const labels = [...panel.querySelectorAll('.field label')].map((n) => n.textContent);
  for (const want of ['About this project', 'GitHub repo', 'Links', 'Contacts', 'Update log']) {
    if (!labels.some((l) => l.startsWith(want))) throw new Error(`missing section: ${want}`);
  }
  if (panel.querySelectorAll('.link-row').length !== 3) throw new Error('links/contacts not listed');
  if (!panel.querySelector('.log-row')) throw new Error('update log missing');
  if (!panel.textContent.includes('shipped it')) throw new Error('log entry text missing');
});

await step('the update log can be copied as Markdown', async () => {
  const panel = document.querySelector('.modal-wide');
  let copied = null;
  const prevClip = dom.window.navigator.clipboard;
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    value: { writeText: async (t) => { copied = t; } }, configurable: true,
  });
  const copy = [...panel.querySelectorAll('.field-head .btn')].find((b) => b.textContent === 'Copy');
  if (!copy) throw new Error('no Copy button on the log');
  if (![...panel.querySelectorAll('.field-head .btn')].some((b) => b.textContent === 'Download')) {
    throw new Error('no Download button on the log');
  }
  await click(copy);
  if (!copied) throw new Error('nothing was put on the clipboard');
  if (!copied.startsWith('# House chores — update log')) throw new Error(`bad heading: ${copied.split('\n')[0]}`);
  if (!copied.includes('- **2026-09-01 10:00:00** — shipped it')) throw new Error(`entry missing: ${copied}`);
  if (copy.textContent !== 'Copied') throw new Error('button should say Copied');
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: prevClip, configurable: true });
});

await step('an unsafe link is shown as text, never as a clickable link', async () => {
  const panel = document.querySelector('.modal-wide');
  const anchors = [...panel.querySelectorAll('.link-value')];
  const bad = anchors.find((a) => a.textContent.includes('javascript:'));
  if (!bad) throw new Error('the unsafe row is missing');
  if (bad.tagName === 'A') throw new Error('unsafe value was rendered as a link');
  const safe = anchors.find((a) => a.textContent.includes('s.example.com'));
  if (safe.tagName !== 'A') throw new Error('a safe URL should be a link');
});

await step('adding a link needs both fields', async () => {
  const panel = document.querySelector('.modal-wide');
  const add = [...panel.querySelectorAll('.link-add')][0];
  const btn = add.querySelector('.btn');
  if (!btn.disabled) throw new Error('Add should start disabled');
  const [labelInput, valueInput] = add.querySelectorAll('.input');
  await act(async () => { setNativeValue(labelInput, 'Docs'); });
  await settle();
  if (!btn.disabled) throw new Error('Add should stay disabled with only a label');
  await act(async () => { setNativeValue(valueInput, 'https://docs.example.com'); });
  await settle();
  if (btn.disabled) throw new Error('Add should enable once both are filled');
});

await step('editing the notes turns Save on', async () => {
  const panel = document.querySelector('.modal-wide');
  const save = [...panel.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Save');
  if (!save.disabled) throw new Error('Save should start disabled');
  const notes = panel.querySelector('.textarea');
  await act(async () => { setNativeValue(notes, 'new notes'); });
  await settle();
  if (save.disabled) throw new Error('Save should enable after editing notes');
  const close = [...panel.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Close');
  await click(close);
});

await step('every column cell scrolls on its own, capped', async () => {
  const lists = q('.list');
  if (!lists.length) throw new Error('no lists');
  for (const el of lists) {
    const css = dom.window.getComputedStyle(el);
    if (css.overflowY !== 'auto') throw new Error(`a cell does not scroll: ${css.overflowY}`);
    if (!css.maxHeight || css.maxHeight === 'none') throw new Error('a cell has no height cap');
  }
});

await step('40 cards in one cell do not stretch the row', async () => {
  const many = [];
  for (let i = 0; i < 40; i += 1) {
    many.push({ id: 500 + i, project_id: 1, column_key: 'todo', title: `bulk card ${i}`,
      notes: '', color: 'plain', flagged: 0, position: 1000 + i, checks_total: 0, checks_done: 0 });
  }
  const kept = state.cards;
  state.cards = [...kept, ...many];
  await remount();

  const cell = q('.list')[0];
  const cardsIn = cell.querySelectorAll('[data-card]').length;
  if (cardsIn < 40) throw new Error(`expected 40+ cards in the cell, got ${cardsIn}`);
  const css = dom.window.getComputedStyle(cell);
  if (!css.maxHeight || css.maxHeight === 'none') throw new Error('the cell grew without a cap');
  state.cards = kept;
  await remount();
});

await step('a row folds to one line and remembers it', async () => {
  const fold = q('.row-fold')[0];
  if (!fold) throw new Error('fold button missing');
  await click(fold);
  if (!q('.row-collapsed').length) throw new Error('row did not fold');
  if (q('.row-collapsed')[0].textContent.replace(/\s/g, '') === '') throw new Error('folded row shows no counts');

  let saved = [];
  try { saved = JSON.parse(dom.window.localStorage.getItem('kanban.collapsed')); } catch { /* ignore */ }
  if (!Array.isArray(saved) || saved.length !== 1) throw new Error('fold was not remembered');

  await click(q('.row-fold')[0]);
  if (q('.row-collapsed').length) throw new Error('row did not open again');
});

await step('a long project name stays on one line', async () => {
  const label = q('.row-label')[2];
  if (!label) throw new Error('the long-named row is missing');
  const name = label.querySelector('.name');
  if (name.textContent !== 'smart-city-dashboard') throw new Error('wrong row picked');

  const labelCss = dom.window.getComputedStyle(label);
  if (labelCss.flexDirection !== 'column') {
    throw new Error(`row label must stack, got flex-direction: ${labelCss.flexDirection}`);
  }
  const nameCss = dom.window.getComputedStyle(name);
  if (nameCss.whiteSpace !== 'nowrap') throw new Error(`name should not wrap, got ${nameCss.whiteSpace}`);
  if (nameCss.textOverflow !== 'ellipsis') throw new Error('a cut name needs an ellipsis');
  if (name.getAttribute('title') !== 'smart-city-dashboard') {
    throw new Error('the full name should be in the tooltip');
  }
});

await step('the board opens a live stream and shows it is connected', async () => {
  const stream = streams.find((x) => !x.closed);
  if (!stream) throw new Error('no live stream was opened');
  if (stream.url !== '/api/events') throw new Error(`wrong stream url: ${stream.url}`);
  await act(async () => { stream.emit('hello', { revision: 1 }); });
  await settle();
  const badge = container.querySelector('.live');
  if (!badge) throw new Error('live badge missing');
  if (!badge.className.includes('on')) throw new Error('badge should show connected');
  if (!badge.textContent.includes('live')) throw new Error('badge should read "live"');
});

await step('a change from elsewhere reloads the board with no refresh', async () => {
  const stream = streams.find((x) => !x.closed);

  // Something else adds a card — another tab, another device, or an agent.
  state.cards = [...state.cards, {
    id: 900, project_id: 1, column_key: 'next', title: 'added by an agent',
    notes: '', color: 'sky', flagged: 0, position: 5000, checks_total: 0, checks_done: 0,
  }];

  if (container.textContent.includes('added by an agent')) throw new Error('card was already showing');
  await act(async () => { stream.emit('change', { revision: 2, source: 'POST /cards' }); });
  await settle();
  if (!container.textContent.includes('added by an agent')) {
    throw new Error('the board did not pick up the change');
  }
  state.cards = state.cards.filter((c) => c.id !== 900);
});

await step('losing the stream shows offline, not a crash', async () => {
  const stream = streams.find((x) => !x.closed);
  await act(async () => { stream.onerror?.(new Error('dropped')); });
  await settle();
  const badge = container.querySelector('.live');
  if (badge.className.includes('on')) throw new Error('badge should show offline');
  if (!badge.textContent.includes('offline')) throw new Error('badge should read "offline"');
  await act(async () => { stream.onopen?.(); });
  await settle();
  if (!container.querySelector('.live').className.includes('on')) {
    throw new Error('badge should go back to live when the stream returns');
  }
});

const rightClick = async (el, x = 100, y = 100) => {
  await act(async () => {
    const ev = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clientX', { value: x });
    Object.defineProperty(ev, 'clientY', { value: y });
    el.dispatchEvent(ev);
  });
  await settle();
};

await step('right-clicking a card opens the colour menu', async () => {
  await rightClick(q('.card')[0]);
  const ctx = document.querySelector('.ctx');
  if (!ctx) throw new Error('menu did not open');
  if (ctx.querySelectorAll('.ctx-swatch').length !== 6) throw new Error('expected 6 colours');
  if (!ctx.querySelector('.ctx-item')) throw new Error('flag option missing');
  const on = ctx.querySelectorAll('.ctx-swatch.on');
  if (on.length !== 1) throw new Error(`the current colour should be marked once, got ${on.length}`);
});

await step('picking a colour changes the card and closes the menu', async () => {
  let patched = null;
  const prev = g.fetch;
  const spy = (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH' && /\/cards\/\d+$/.test(String(url))) {
      patched = JSON.parse(opts.body);
    }
    return prev(url, opts);
  };
  g.fetch = spy; dom.window.fetch = spy;

  const ctx = document.querySelector('.ctx');
  const target = [...ctx.querySelectorAll('.ctx-swatch')].find((b) => !b.className.includes('on'));
  await click(target);

  g.fetch = prev; dom.window.fetch = prev;
  if (document.querySelector('.ctx')) throw new Error('menu should close after picking');
  if (!patched || !patched.color) throw new Error('no colour was sent to the server');
  if (Object.keys(patched).length !== 1) throw new Error('only the colour should be sent');
});

await step('the menu can flag and unflag a card', async () => {
  let patched = null;
  const prev = g.fetch;
  const spy = (url, opts = {}) => {
    if ((opts.method || 'GET') === 'PATCH' && /\/cards\/\d+$/.test(String(url))) {
      patched = JSON.parse(opts.body);
    }
    return prev(url, opts);
  };
  g.fetch = spy; dom.window.fetch = spy;

  await rightClick(q('.card')[0]);
  await click(document.querySelector('.ctx-item'));

  g.fetch = prev; dom.window.fetch = prev;
  if (!patched || patched.flagged === undefined) throw new Error('flag was not sent');
});

await step('the menu moves a card to another column', async () => {
  let moved = null;
  const prev = g.fetch;
  const spy = (url, opts = {}) => {
    if (/\/cards\/\d+\/move$/.test(String(url))) moved = { url: String(url), body: JSON.parse(opts.body) };
    return prev(url, opts);
  };
  g.fetch = spy; dom.window.fetch = spy;

  const card = q('.card')[0];
  const from = card.closest('.list').className.split(' ')[1];
  const id = state.cards.find((c) => c.title === card.querySelector('.card-title').textContent).id;
  await rightClick(card);
  const items = [...document.querySelectorAll('.ctx-move')];
  if (items.map((b) => b.textContent.replace(' ✓', '')).join() !== 'To do,Next,Doing,Waiting,Review,Done') {
    throw new Error('move options missing');
  }
  const keys = ['todo', 'next', 'doing', 'waiting', 'review', 'done'];
  const here = items.filter((b) => b.disabled);
  if (here.length !== 1 || here[0] !== items[keys.indexOf(from)]) throw new Error('the current column should be the one marked');
  const to = from === 'waiting' ? 'next' : 'waiting';
  await click(items[keys.indexOf(to)]);

  g.fetch = prev; dom.window.fetch = prev;
  if (document.querySelector('.ctx')) throw new Error('menu should close after moving');
  if (!moved?.url.endsWith(`/cards/${id}/move`) || moved.body.column_key !== to) {
    throw new Error(`expected card ${id} to move to ${to}, got ${JSON.stringify(moved)}`);
  }
});

await step('Escape closes the menu, and it stays on screen', async () => {
  await rightClick(q('.card')[0], 99999, 99999);
  const ctx = document.querySelector('.ctx');
  if (!ctx) throw new Error('menu did not open');
  const left = parseFloat(ctx.style.left);
  const top = parseFloat(ctx.style.top);
  if (left > dom.window.innerWidth || top > dom.window.innerHeight) {
    throw new Error(`menu placed off screen at ${left},${top}`);
  }
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await settle();
  if (document.querySelector('.ctx')) throw new Error('Escape did not close the menu');
});

await step('on a phone a long press opens the card menu, a tap still opens the card', async () => {
  const card = q('.card')[0];
  const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
  const finger = (type, x, y) => act(async () => {
    const ev = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, detail: 1 });
    Object.defineProperty(ev, 'pointerType', { value: 'touch' });
    card.dispatchEvent(ev);
  });
  const escape = () => act(async () => {
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  });

  // A finger that moves is scrolling, not pressing.
  await finger('pointerdown', 50, 50);
  await finger('pointermove', 50, 90);
  await wait(650);
  if (document.querySelector('.ctx')) throw new Error('a moving finger opened the menu');
  await finger('pointercancel', 50, 90);

  // Held still, it opens the menu; lifting it neither opens the card nor closes the menu.
  await finger('pointerdown', 50, 50);
  await wait(650);
  if (!document.querySelector('.ctx .ctx-move')) throw new Error('a finger held still did not open the menu');
  await finger('pointerup', 50, 50);
  await finger('click', 50, 50);
  await settle();
  if (document.querySelector('.modal')) throw new Error('lifting the finger also opened the card');
  if (!document.querySelector('.ctx')) throw new Error('lifting the finger closed the menu');
  await escape();
  await settle();

  // A short tap is still a tap.
  await finger('pointerdown', 50, 50);
  await wait(100);
  await finger('pointerup', 50, 50);
  await finger('click', 50, 50);
  await settle();
  if (document.querySelector('.ctx')) throw new Error('a short tap opened the menu');
  const editor = document.querySelector('.modal');
  if (!editor) throw new Error('a short tap did not open the card');
  await click([...editor.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Cancel'));
});

await step('near the bottom the menu opens above the pointer, not under it', async () => {
  const y = dom.window.innerHeight - 10;
  await rightClick(q('.card')[0], 40, y);
  const top = parseFloat(document.querySelector('.ctx').style.top);
  if (!(top + 120 <= y)) throw new Error(`menu covers the pointer: top ${top}, pointer at ${y}`);
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  await settle();
});

await step('a normal left click still opens the card editor', async () => {
  await click(q('.card')[0]);
  if (!document.querySelector('.modal')) throw new Error('card editor did not open');
  const cancel = [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Cancel');
  await click(cancel);
});

await step('no hardcoded light colours are left in the stylesheet', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  const body = css.replace(/:root[^}]*}/g, '');           // token blocks may hold hex
  const bad = body.match(/background:\s*#(fff|fbfcfd|f0f2f4|f2f4f6|fcfcfd)/gi) || [];
  if (bad.length) throw new Error(`still hardcoded: ${bad.join(', ')}`);
});

await step('the header has a board switcher', () => {
  const select = container.querySelector('.board-select');
  if (!select) throw new Error('no board switcher');
  const names = [...select.options].map((o) => o.textContent);
  if (!names.includes('Work') || !names.includes('Personal')) {
    throw new Error(`boards missing from the switcher: ${names.join(', ')}`);
  }
  if (!names.some((n) => n.includes('New board'))) throw new Error('no way to add a board');
});

await step('switching board swaps the projects, and is remembered', async () => {
  if (!container.textContent.includes('House chores')) throw new Error('should start on Work');

  const select = container.querySelector('.board-select');
  await act(async () => {
    select.value = '2';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await settle();

  const rows = q('.row-label .name').map((n) => n.textContent);
  if (rows.length !== 0) throw new Error(`Personal should be empty, got: ${rows.join(', ')}`);
  if (!container.textContent.includes('No projects yet')) throw new Error('no empty-board message');

  let saved = null;
  try { saved = JSON.parse(dom.window.localStorage.getItem('kanban.boardId')); } catch { /* ignore */ }
  if (saved !== 2) throw new Error(`board choice not remembered, got ${saved}`);

  await act(async () => {
    select.value = '1';
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  await settle();
  if (!container.textContent.includes('House chores')) throw new Error('did not switch back');
});

await step('a new project goes on the board you are looking at', async () => {
  let sent = null;
  const prev = g.fetch;
  const spy = (url, opts = {}) => {
    if (String(url) === '/api/projects' && (opts.method || 'GET') === 'POST') sent = JSON.parse(opts.body);
    return prev(url, opts);
  };
  g.fetch = spy; dom.window.fetch = spy;

  const btn = q('.topbar .btn').find((b) => b.textContent.includes('Project'));
  await click(btn);
  const dlg = document.querySelector('.modal-sm');
  await act(async () => { setNativeValue(dlg.querySelector('.input'), 'On this board'); });
  await settle();
  await click([...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Add project'));

  g.fetch = prev; dom.window.fetch = prev;
  if (sent?.board_id !== 1) throw new Error(`project not tied to the open board: ${JSON.stringify(sent)}`);
});

await step('an overdue card shows a late badge', () => {
  const late = container.querySelector('.due-late');
  if (!late) throw new Error('no overdue badge');
  if (!late.textContent.includes('⚠')) throw new Error('overdue should be marked');
});

await step('text picks its own direction, so Hebrew reads right to left', () => {
  const title = container.querySelector('.card-title');
  const box = container.querySelector('.search');
  for (const [name, el] of [['card title', title], ['search box', box]]) {
    const css = dom.window.getComputedStyle(el);
    if (css.unicodeBidi !== 'plaintext') throw new Error(`${name} should pick its own direction`);
    if (css.textAlign === 'left') throw new Error(`${name} should align to the start, not left`);
    // dir="auto" is what makes a field line its text up on the right for Hebrew.
    if (el.getAttribute('dir') !== 'auto') throw new Error(`${name} should carry dir="auto"`);
  }
  const addBox = container.querySelector('.add-card textarea, textarea');
  if (addBox && addBox.getAttribute('dir') !== 'auto') throw new Error('text areas should carry dir="auto"');
});

await step('search filters cards and hides empty rows', async () => {
  const box = container.querySelector('.search');
  if (!box) throw new Error('no search box');
  await act(async () => { setNativeValue(box, 'milk'); });
  await settle();

  const titles = q('.card-title').map((n) => n.textContent);
  if (!titles.includes('Buy milk')) throw new Error('the match disappeared');
  if (titles.includes('Fix the sink')) throw new Error('a non-match is still showing');
  if (!container.querySelector('.search-count')) throw new Error('no result count');

  // Searching notes too.
  await act(async () => { setNativeValue(box, 'plumber'); });
  await settle();
  if (!q('.card-title').map((n) => n.textContent).includes('Fix the sink')) {
    throw new Error('search should look at notes as well');
  }

  await act(async () => { setNativeValue(box, ''); });
  await settle();
  if (q('.card-title').length < 2) throw new Error('clearing search did not bring cards back');
});

await step('search finds a card by its number or its reference', async () => {
  const box = container.querySelector('.search');
  const target = state.cards[0];   // "Buy milk", id 10, WRK-1
  const only = async (text) => {
    await act(async () => { setNativeValue(box, text); });
    await settle();
    const titles = q('.card-title').map((n) => n.textContent);
    if (titles.length !== 1 || titles[0] !== target.title) {
      throw new Error(`"${text}" should show only ${target.ref}, got: ${titles.join(', ')}`);
    }
  };

  // With a hash, or as a whole reference in any case: only that card.
  await only(`#${target.number}`);
  await only(target.ref);
  await only(target.ref.toLowerCase());
  await only(`#${target.ref}`);

  // The id is not what the board shows, so it finds nothing.
  await act(async () => { setNativeValue(box, `#${target.id}`); });
  await settle();
  if (q('.card-title').length !== 0) throw new Error(`#${target.id} is an id, not a number on this board`);

  // A number with no hash still finds it.
  await act(async () => { setNativeValue(box, String(target.number)); });
  await settle();
  if (!q('.card-title').map((n) => n.textContent).includes(target.title)) {
    throw new Error('a bare number should find the card too');
  }

  // Another board's reference is not on this board.
  await act(async () => { setNativeValue(box, 'PER-1'); });
  await settle();
  if (q('.card-title').length !== 0) throw new Error('PER-1 is on another board');

  // A word with a dash and a number is still a word when it is not this board's key.
  await act(async () => { setNativeValue(box, 'covid-19'); });
  await settle();
  if (!q('.card-title').map((n) => n.textContent).includes('Sort donations')) {
    throw new Error('covid-19 should be a word search');
  }

  // A hash and something that is not a number finds nothing, rather than everything.
  await act(async () => { setNativeValue(box, '#milk'); });
  await settle();
  if (q('.card-title').length !== 0) throw new Error('#milk should match nothing');

  // Words still work as before.
  await act(async () => { setNativeValue(box, 'milk'); });
  await settle();
  if (!q('.card-title').map((n) => n.textContent).includes('Buy milk')) {
    throw new Error('word search broke');
  }

  await act(async () => { setNativeValue(box, ''); });
  await settle();
});

await step('the search box says you can use a number', () => {
  const box = container.querySelector('.search');
  if (!box.getAttribute('placeholder').includes('#')) {
    throw new Error('the placeholder should hint that numbers work');
  }
});

await step('the card editor archives instead of deleting', async () => {
  await click(q('.card')[0]);
  const actions = [...document.querySelectorAll('.modal-actions .btn')].map((b) => b.textContent);
  if (actions.includes('Delete')) throw new Error('the card editor should not offer Delete');
  if (!actions.includes('Archive')) throw new Error('no Archive button');

  await click([...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Archive'));
  const dlg = document.querySelector('.modal-sm');
  if (!dlg.textContent.includes('bring it back')) throw new Error('should say it can be restored');
  await click([...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Cancel'));
  await click([...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Cancel'));
});

await step('the card editor shows a due date and the label name', async () => {
  await click(q('.card')[0]);
  const modal = document.querySelector('.modal');
  if (!modal.querySelector('input[type="date"]')) throw new Error('no due date field');
  const heading = modal.querySelector('h2').textContent;
  if (!/WRK-\d+/.test(heading)) throw new Error(`the editor should show the reference, got "${heading}"`);
  const labels = [...modal.querySelectorAll('.field label')].map((n) => n.textContent);
  if (!labels.some((t) => t.startsWith('Label'))) {
    throw new Error(`colour section should be called Label, got: ${labels.join(' | ')}`);
  }
  await click([...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Cancel'));
});

await step('labels can be renamed from the card editor', async () => {
  let sent = null;
  const prev = g.fetch;
  const spy = (url, opts = {}) => {
    if (/\/labels\//.test(String(url))) sent = { url: String(url), body: JSON.parse(opts.body) };
    return prev(url, opts);
  };
  g.fetch = spy; dom.window.fetch = spy;

  await click(q('.card')[0]);
  const modal = document.querySelector('.modal');
  const toggle = [...modal.querySelectorAll('.btn')].find((b) => b.textContent === 'Rename labels');
  if (!toggle) throw new Error('no way to rename labels');
  await click(toggle);

  const rows = modal.querySelectorAll('.label-row');
  if (rows.length !== 6) throw new Error(`expected 6 colours to name, got ${rows.length}`);

  // The existing name is shown for editing.
  const values = [...rows].map((r) => r.querySelector('.input').value);
  if (!values.includes('Blocked')) throw new Error('existing label name not shown');

  const first = rows[0].querySelector('.input');
  await act(async () => { setNativeValue(first, 'Chore'); });
  await act(async () => {
    first.dispatchEvent(new dom.window.Event('blur'));
    first.dispatchEvent(new dom.window.Event('focusout', { bubbles: true }));
  });
  await settle();

  g.fetch = prev; dom.window.fetch = prev;
  if (!sent) throw new Error('the new name was never saved');
  if (sent.body.name !== 'Chore') throw new Error(`wrong name sent: ${JSON.stringify(sent.body)}`);
  if (!sent.url.includes('/boards/1/labels/')) throw new Error(`wrong board in url: ${sent.url}`);

  const cancel = [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Cancel');
  await click(cancel);
});

await step('project rows have a drag handle', () => {
  const grips = q('.row-grip');
  if (grips.length !== q('.row-label').length) throw new Error('not every row has a handle');
  if (grips[0].getAttribute('draggable') !== 'true') throw new Error('the handle is not draggable');
});

const openSettings = async () => {
  const gear = container.querySelector('.settings-btn');
  if (!gear) throw new Error('no settings button in the header');
  if (!gear.querySelector('svg')) throw new Error('the gear should be a drawn icon, not a glyph');
  await click(gear);
  const panel = document.querySelector('.settings');
  if (!panel) throw new Error('settings did not open');
  return panel;
};
const closeSettings = async () => {
  const done = [...document.querySelectorAll('.settings .modal-actions .btn')]
    .find((b) => b.textContent === 'Done');
  if (done) await click(done);
};

await step('the header is down to the everyday controls', () => {
  const bar = container.querySelector('.topbar');
  const buttons = [...bar.querySelectorAll('.btn')].map((b) => b.textContent.trim());
  for (const gone of ['About', 'Agent keys', 'Fold all', 'Compact', 'Log out']) {
    if (buttons.includes(gone)) throw new Error(`"${gone}" should have moved into settings`);
  }
  if (!buttons.some((b) => b.includes('Project'))) throw new Error('+ Project should stay');
  if (!bar.querySelector('.search')) throw new Error('search should stay');
  if (!bar.querySelector('.board-select')) throw new Error('board switcher should stay');
  if (!bar.querySelector('.project-filter')) throw new Error('project filter should stay');
});

await step('settings holds theme, size, row height and fold', async () => {
  const panel = await openSettings();
  const text = panel.textContent;
  for (const want of ['Theme', 'Card size', 'Row height', 'All rows', 'This board', 'Agent keys', 'About']) {
    if (!text.includes(want)) throw new Error(`settings is missing "${want}"`);
  }
  if (!text.includes('MIT') && !text.includes('Loading')) throw new Error('no licence shown');
  await closeSettings();
});

await step('night mode from settings, and it sticks', async () => {
  const panel = await openSettings();
  const root = document.documentElement;
  const before = root.dataset.theme;
  const night = [...panel.querySelectorAll('.seg button')].find((b) => b.textContent.includes('Night'));
  await click(night);
  if (root.dataset.theme !== 'dark') throw new Error('did not switch to night');
  let saved = null;
  try { saved = JSON.parse(dom.window.localStorage.getItem('kanban.theme')); } catch { /* ignore */ }
  if (saved !== 'dark') throw new Error('theme not remembered');
  const day = [...document.querySelectorAll('.settings .seg button')].find((b) => b.textContent.includes('Day'));
  await click(day);
  if (root.dataset.theme !== 'light') throw new Error('did not switch back');
  await closeSettings();
});

await step('card size from settings changes the board', async () => {
  const panel = await openSettings();
  const wasCompact = q('.board')[0].className.includes('compact');
  const target = [...panel.querySelectorAll('.seg button')]
    .find((b) => b.textContent === (wasCompact ? 'Roomy' : 'Compact'));
  await click(target);
  if (q('.board')[0].className.includes('compact') === wasCompact) {
    throw new Error('card size did not change');
  }
  const back = [...document.querySelectorAll('.settings .seg button')]
    .find((b) => b.textContent === (wasCompact ? 'Compact' : 'Roomy'));
  await click(back);
  await closeSettings();
});

await step('fold all from settings folds every row', async () => {
  const panel = await openSettings();
  const fold = [...panel.querySelectorAll('.btn')].find((b) => b.textContent === 'Fold all');
  if (!fold) throw new Error('no fold control in settings');
  await click(fold);
  await closeSettings();
  if (q('.row-collapsed').length !== q('.row-label').length) throw new Error('not every row folded');
  const panel2 = await openSettings();
  await click([...panel2.querySelectorAll('.btn')].find((b) => b.textContent === 'Open all'));
  await closeSettings();
  if (q('.row-collapsed').length) throw new Error('rows did not reopen');
});

await step('settings opens the archive and the keys', async () => {
  let panel = await openSettings();
  await click([...panel.querySelectorAll('.btn')].find((b) => b.textContent === 'Open archive'));
  if (!document.querySelector('.modal-wide')) throw new Error('archive did not open');
  if (document.querySelector('.settings')) throw new Error('settings should close behind it');
  await click([...document.querySelectorAll('.modal-wide .modal-actions .btn')].find((b) => b.textContent === 'Close'));

  panel = await openSettings();
  await click([...panel.querySelectorAll('.btn')].find((b) => b.textContent === 'Manage keys'));
  if (!document.querySelector('.token-list, .modal-wide')) throw new Error('keys did not open');
  await click([...document.querySelectorAll('.modal-wide .modal-actions .btn')].find((b) => b.textContent === 'Close'));
});

await step('settings shows the board key and can change it', async () => {
  let sent = null;
  const prev = g.fetch;
  const spy = (url, opts = {}) => {
    if (/\/boards\/1$/.test(String(url)) && opts.method === 'PATCH') sent = JSON.parse(opts.body);
    return prev(url, opts);
  };
  g.fetch = spy; dom.window.fetch = spy;

  const panel = await openSettings();
  if (!panel.textContent.includes('WRK')) throw new Error('settings should show the board key');
  await click([...panel.querySelectorAll('.btn')].find((b) => b.textContent === 'Change key'));
  const dlg = [...document.querySelectorAll('.modal-sm')].find((m) => m.textContent.includes('Board key'));
  if (!dlg) throw new Error('no key dialog');
  if (!dlg.textContent.includes('WRK-1')) throw new Error('the dialog should say what references look like');
  const input = dlg.querySelector('input');
  if (input.value !== 'WRK') throw new Error(`the dialog should start from the key, got "${input.value}"`);
  await act(async () => { setNativeValue(input, 'job'); });
  await click([...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Save'));

  g.fetch = prev; dom.window.fetch = prev;
  if (sent?.key !== 'job') throw new Error(`expected key "job" to be sent, got ${JSON.stringify(sent)}`);
  if (document.querySelector('.settings')) await closeSettings();
});

await step('the archive opens from the header and can bring a project back', async () => {
  const bar = container.querySelector('.topbar');
  await click([...bar.querySelectorAll('.btn')].find((b) => b.textContent.trim() === 'Archive'));
  const modal = document.querySelector('.modal-wide.archive');
  if (!modal) throw new Error('archive did not open from the header');
  await settle();
  if (!modal.textContent.includes('Old garden plan')) throw new Error('archived project not listed');
  if (!modal.textContent.includes('WRK-9')) throw new Error('an archived card should show its reference');
  const row = [...modal.querySelectorAll('.token-row')].find((r) => r.textContent.includes('Old garden plan'));
  await click([...row.querySelectorAll('.btn')].find((b) => b.textContent === 'Restore'));
  await settle();
  if (modal.textContent.includes('Old garden plan')) throw new Error('restored project still listed');
  await click([...modal.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Close'));
});

const viewTab = (name) => [...container.querySelectorAll('.view-switch button')].find((b) => b.textContent === name);

await step('the Notes view switches in, hides the card tools, and adds a note', async () => {
  if (!viewTab('Notes')) throw new Error('no Board / Notes switch in the header');
  await click(viewTab('Notes'));
  if (!container.querySelector('.noteboard')) throw new Error('note board did not show');
  if (container.querySelector('.board')) throw new Error('kanban should be hidden in the Notes view');
  if (container.querySelector('.search')) throw new Error('card search should hide in the Notes view');
  if (!container.textContent.includes('No notes yet')) throw new Error('empty note board should say so');

  await click([...container.querySelectorAll('.noteboard-bar .btn')].find((b) => b.textContent === '+ Note'));
  if (container.querySelectorAll('.note').length !== 1) throw new Error('note was not added');
  if (!container.textContent.includes('1 note')) throw new Error('note count missing');
  if (state.notes.length !== 1) throw new Error('note was not sent to the server');
});

await step('a note takes text, a colour, moves by drag, and can be deleted', async () => {
  const sent = [];
  const prev = g.fetch;
  const spy = (url, opts = {}) => {
    if (/\/notes\/\d+$/.test(String(url))) sent.push({ method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    return prev(url, opts);
  };
  g.fetch = spy; dom.window.fetch = spy;

  const note = container.querySelector('.note');
  const input = note.querySelector('.note-input');
  if (!input) throw new Error('a new, empty note should open in the editor');
  await act(async () => { setNativeValue(input, 'Call **Dana** — __Tuesday__\n- milk\n- ~~eggs~~'); });
  await act(async () => {
    input.dispatchEvent(new dom.window.Event('blur'));
    input.dispatchEvent(new dom.window.Event('focusout', { bubbles: true }));
  });
  await settle();
  const textSave = sent.find((s) => s.method === 'PATCH' && s.body?.text !== undefined);
  if (!textSave?.body.text.startsWith('Call **Dana**')) throw new Error(`text was not saved: ${JSON.stringify(sent)}`);

  // Leaving the editor shows the text formatted: marks become b/u/s, "- " lines a list.
  const view = note.querySelector('.note-view');
  if (!view) throw new Error('note should show its text once you leave the editor');
  if (note.querySelector('.note-input')) throw new Error('editor should close when you leave it');
  if (view.querySelector('b')?.textContent !== 'Dana') throw new Error('bold mark not shown');
  if (view.querySelector('u')?.textContent !== 'Tuesday') throw new Error('underline mark not shown');
  if (view.querySelector('s')?.textContent !== 'eggs') throw new Error('strike mark not shown');
  if (view.querySelectorAll('li').length !== 2) throw new Error('bullet lines not shown as a list');
  if (view.textContent.includes('**')) throw new Error('marks should not show as text');

  const titleField = note.querySelector('.note-title');
  if (!titleField) throw new Error('note has no title field');
  await act(async () => { setNativeValue(titleField, 'Dana'); });
  await act(async () => {
    titleField.dispatchEvent(new dom.window.Event('blur'));
    titleField.dispatchEvent(new dom.window.Event('focusout', { bubbles: true }));
  });
  await settle();
  const titleSave = sent.find((s) => s.method === 'PATCH' && s.body?.title !== undefined);
  if (titleSave?.body.title !== 'Dana') throw new Error('title was not saved');

  const swatch = note.querySelector('.note-swatch[aria-label="Blue"]');
  if (!swatch) throw new Error('colour dots missing');
  await click(swatch);
  const colorSave = sent.find((s) => s.method === 'PATCH' && s.body?.color === 'sky');
  if (!colorSave) throw new Error('colour was not saved');
  if (!container.querySelector('.note.sky')) throw new Error('note did not change colour');

  // Drag the paper 120px right and 50px down; the new spot is saved on release.
  if (dom.window.getComputedStyle(note).getPropertyValue('touch-action') !== 'none') {
    throw new Error('a finger on a note would scroll the board instead of dragging');
  }
  const before = { x: state.notes[0].x, y: state.notes[0].y };
  const pointer = (type, target, x, y) => act(async () => {
    target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
  });
  await pointer('pointerdown', note, 100, 100);
  await pointer('pointermove', dom.window, 160, 120);
  if (!note.classList.contains('dragging')) throw new Error('note should look lifted while dragging');
  await pointer('pointermove', dom.window, 220, 150);
  await pointer('pointerup', dom.window, 220, 150);
  await settle();
  const moveSave = sent.find((s) => s.method === 'PATCH' && s.body?.x !== undefined);
  if (!moveSave) throw new Error('position was not saved');
  if (moveSave.body.x !== before.x + 120 || moveSave.body.y !== before.y + 50) {
    throw new Error(`wrong spot saved: ${JSON.stringify(moveSave.body)} from ${JSON.stringify(before)}`);
  }
  if (note.style.left !== `${before.x + 120}px`) throw new Error('note did not stay where it was dropped');
  if (note.classList.contains('dragging')) throw new Error('note still looks lifted after drop');

  // A press on the shown text that barely moves (a finger's wobble) opens the
  // editor, and does not move the note.
  await pointer('pointerdown', note.querySelector('.note-view'), 10, 10);
  await pointer('pointermove', dom.window, 13, 11);
  if (note.classList.contains('dragging')) throw new Error('a 3px wobble should not start a drag');
  await pointer('pointerup', dom.window, 13, 11);
  await settle();
  if (!note.querySelector('.note-input')) throw new Error('clicking the text should open the editor');
  if (sent.filter((s) => s.method === 'PATCH' && s.body?.x !== undefined).length !== 1) {
    throw new Error('a click on the text should not move the note');
  }

  // The toolbar wraps the selection in marks; Ctrl+U does the same from the keyboard.
  const editor = note.querySelector('.note-input');
  const tools = [...note.querySelectorAll('.note-tool')].map((b) => b.textContent);
  for (const t of ['B', 'U', 'S', '• List']) {
    if (!tools.includes(t)) throw new Error(`toolbar is missing ${t}`);
  }
  await act(async () => { setNativeValue(editor, 'plain words\nsecond line'); });
  editor.setSelectionRange(0, 5);
  await click([...note.querySelectorAll('.note-tool')].find((b) => b.textContent === 'B'));
  if (editor.value !== '**plain** words\nsecond line') throw new Error(`bold did not wrap: ${JSON.stringify(editor.value)}`);
  if (editor.selectionStart !== 2 || editor.selectionEnd !== 7) throw new Error('selection should stay on the word');
  await click([...note.querySelectorAll('.note-tool')].find((b) => b.textContent === 'B'));
  if (editor.value !== 'plain words\nsecond line') throw new Error('bold again should unwrap');

  editor.setSelectionRange(6, 11);
  await act(async () => {
    editor.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'u', ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await settle();
  if (editor.value !== 'plain __words__\nsecond line') throw new Error(`Ctrl+U did not underline: ${JSON.stringify(editor.value)}`);

  editor.setSelectionRange(0, editor.value.length);
  await click([...note.querySelectorAll('.note-tool')].find((b) => b.textContent === '• List'));
  if (editor.value !== '- plain __words__\n- second line') throw new Error(`list did not bullet every line: ${JSON.stringify(editor.value)}`);
  await click([...note.querySelectorAll('.note-tool')].find((b) => b.textContent === '• List'));
  if (editor.value !== 'plain __words__\nsecond line') throw new Error('list again should remove the bullets');

  await act(async () => {
    note.querySelector('.note-input').dispatchEvent(new dom.window.Event('focusout', { bubbles: true }));
  });
  await settle();
  if (!note.querySelector('.note-view u')) throw new Error('underline from the toolbar should show formatted');

  await click(note.querySelector('.note-delete'));
  const confirm = document.querySelector('.modal-sm');
  if (!confirm) throw new Error('delete confirm did not open');
  if (!confirm.textContent.includes('"Dana"')) throw new Error('confirm should quote the note title');
  await click([...confirm.querySelectorAll('.btn')].find((b) => b.textContent === 'Delete'));
  if (!sent.some((s) => s.method === 'DELETE')) throw new Error('note was not deleted on the server');
  if (container.querySelector('.note')) throw new Error('note still on the board');
  if (state.notes.length !== 0) throw new Error('fake server still has the note');

  g.fetch = prev; dom.window.fetch = prev;
});

await step('the view is remembered, and Board brings the kanban back', async () => {
  await remount();
  if (!container.querySelector('.noteboard')) throw new Error('Notes view was not remembered');
  await click(viewTab('Board'));
  if (!container.querySelector('.board')) throw new Error('kanban did not come back');
  if (!container.querySelector('.search')) throw new Error('card search did not come back');
});

await step('labels can also be renamed from settings', async () => {
  let sent = null;
  const prev = g.fetch;
  const spy = (url, opts = {}) => {
    if (/\/labels\//.test(String(url))) sent = JSON.parse(opts.body);
    return prev(url, opts);
  };
  g.fetch = spy; dom.window.fetch = spy;

  const panel = await openSettings();
  if (!panel.textContent.includes('Labels')) throw new Error('no Labels section in settings');
  const rows = panel.querySelectorAll('.label-row');
  if (rows.length !== 6) throw new Error(`expected 6 colours, got ${rows.length}`);
  if (![...rows].some((r) => r.querySelector('.input').value === 'Blocked')) {
    throw new Error('existing label name not shown in settings');
  }

  const input = rows[1].querySelector('.input');
  await act(async () => { setNativeValue(input, 'Deep work'); });
  await act(async () => {
    input.dispatchEvent(new dom.window.Event('blur'));
    input.dispatchEvent(new dom.window.Event('focusout', { bubbles: true }));
  });
  await settle();

  g.fetch = prev; dom.window.fetch = prev;
  if (sent?.name !== 'Deep work') throw new Error(`name not saved: ${JSON.stringify(sent)}`);
  await closeSettings();
});

await step('a card an agent changed is marked', () => {
  const marks = q('.by-agent');
  if (marks.length !== 1) throw new Error(`expected 1 agent mark, got ${marks.length}`);
  if (!marks[0].getAttribute('title').includes('Claude on laptop')) {
    throw new Error('the mark should name the agent');
  }
  if (!marks[0].getAttribute('title').includes('an agent')) {
    throw new Error('the mark should say it was an agent, not just a name');
  }
  if (!marks[0].querySelector('svg')) throw new Error('the mark should be a drawn icon, not a symbol');
});

await step('the agent filter shows only what an agent touched', async () => {
  const btn = q('.topbar .btn').find((b) => b.textContent.includes('Agent changes'));
  if (!btn) throw new Error('no agent filter, or it is not clearly labelled');
  if (!btn.querySelector('svg')) throw new Error('the filter should carry the bot icon');
  await click(btn);

  const titles = q('.card-title').map((n) => n.textContent);
  if (!titles.includes('Written by an agent')) throw new Error('the agent card vanished');
  if (titles.includes('Buy milk')) throw new Error('a card you changed is still showing');
  const count = container.querySelector('.search-count');
  if (!count) throw new Error('no count while filtering');
  if (!count.textContent.includes('changed by an agent')) {
    throw new Error(`the count should say what it is showing, got "${count.textContent}"`);
  }

  await click(q('.topbar .btn').find((b) => b.textContent.includes('Agent changes')));
  if (q('.card-title').length < 3) throw new Error('turning the filter off did not restore the board');
});

await step('the card editor says who changed it', async () => {
  const agentCard = q('.card').find((c) => c.textContent.includes('Written by an agent'));
  await click(agentCard);
  const modal = document.querySelector('.modal');
  if (!modal.textContent.includes('Last changed by')) throw new Error('no provenance line');
  if (!modal.textContent.includes('an agent')) throw new Error('should say it was an agent');
  await click([...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Cancel'));
});

await step('the project column stays pinned, the headers scroll away', async () => {
  const head = q('.head-col')[0];
  if (dom.window.getComputedStyle(head).position === 'sticky') throw new Error('column headers should scroll with the board');
  const label = q('.row-label')[0];
  if (dom.window.getComputedStyle(label).position !== 'sticky') throw new Error('project column not sticky');
});

await step('on a phone, the column tabs pick the one column shown', async () => {
  const tabs = q('.col-tabs button');
  if (tabs.map((t) => t.textContent).join() !== 'To do,Next,Doing,Waiting,Review,Done') throw new Error('column tabs missing');
  const shown = () => [...new Set(q('.board .phone-col .list').map((l) => l.className.split(' ')[1]))];
  if (shown().join() !== 'doing') throw new Error(`Doing should be shown first, got ${shown()}`);
  await click(tabs.find((t) => t.textContent === 'Review'));
  if (shown().join() !== 'review') throw new Error(`Review tab showed ${shown()}`);
  if (q('.board .phone-off .list.review').length) throw new Error('Review cells still marked hidden');
  await click(tabs.find((t) => t.textContent === 'Waiting'));
  if (shown().join() !== 'waiting') throw new Error(`Waiting tab showed ${shown()}`);
});

await step('the Dashboard view shows its three blocks', async () => {
  const tab = q('.view-switch button').find((b) => b.textContent === 'Dashboard');
  if (!tab) throw new Error('no Dashboard tab');
  await click(tab);
  await settle();
  const heads = q('.dash h2').map((h) => h.textContent);
  if (heads.join() !== 'Stuck now,Getting done,Agents') throw new Error(`blocks: ${heads}`);
  const waiting = q('.tile').find((t) => t.textContent.includes('Waiting'));
  if (waiting?.querySelector('b').textContent !== '2') throw new Error('Waiting tile should count 2');
});

await step('each chart is a labelled group for a screen reader', () => {
  const charts = q('.dash svg[aria-label]');
  if (charts.length !== 4) throw new Error(`labelled charts: ${charts.length}`);
  const bare = charts.filter((svg) => svg.getAttribute('role') !== 'group').map((svg) => svg.getAttribute('aria-label'));
  if (bare.length) throw new Error(`no role="group" on: ${bare.join(', ')}`);
});

await step('legends stay in view when a chart scrolls sideways', () => {
  const legends = q('.dash .chart-legend');
  if (legends.length !== 3) throw new Error(`legends: ${legends.length}`);
  const scrolled = legends.filter((l) => l.closest('.chart-scroll'));
  if (scrolled.length) throw new Error(`${scrolled.length} legend(s) scroll with their chart`);
});

await step('tile labels line up at the start when they wrap', () => {
  // jsdom computes "center" for every button whatever the stylesheet says, so read the .tile rule itself.
  const rule = [...document.styleSheets].flatMap((s) => [...s.cssRules]).find((r) => r.selectorText === '.tile');
  if (!rule) throw new Error('no .tile rule');
  if (rule.style.textAlign !== 'start') throw new Error(`.tile text-align: "${rule.style.textAlign}"`);
});

await step('project names fit their columns and are cut at the reading end', () => {
  const labels = q('.dash svg[aria-label="Open work by project"] .chart-label');
  const byName = (name) => labels.find((l) => l.querySelector('title')?.textContent === name);
  const shown = (l) => l.childNodes[0].textContent;   // the text before its <title>
  const hebrew = byName('ניתוח מערכות מידע');
  const english = byName('House chores');
  if (!hebrew || !english) throw new Error('a project label is missing');
  if (hebrew.getAttribute('direction') !== 'rtl') throw new Error('a Hebrew name should read right to left');
  if (!shown(hebrew).endsWith('…')) throw new Error(`a long Hebrew name should end in "…", got "${shown(hebrew)}"`);
  if (english.getAttribute('direction')) throw new Error('an English name should keep the page direction');
  const xs = labels.map((l) => Number(l.getAttribute('x')));
  if (xs.some((x, i) => i > 0 && x - xs[i - 1] < 72)) throw new Error(`labels too close to fit their names: ${xs}`);
});

await step('the parts of a stacked column are drawn apart', () => {
  const parts = q('.dash svg[aria-label="Open work by project"] rect');
  if (!parts.length) throw new Error('no stacked parts');
  const plain = parts.filter((r) => !r.classList.contains('stack-part') || !r.classList.contains('pick'));
  if (plain.length) throw new Error(`${plain.length} part(s) without both "pick" and "stack-part"`);
});

await step('a tile lists its cards, untouched longest first', async () => {
  await click(q('.tile').find((t) => t.textContent.includes('Waiting')));
  const head = document.querySelector('.drill h3')?.textContent;
  if (head !== 'Waiting · 2') throw new Error(`drill header: ${head}`);
  const refs = q('.drill .card-no').map((n) => n.textContent);
  if (refs.join() !== 'WRK-2,WRK-3') throw new Error(`order: ${refs}`);
});

await step('the open list takes focus, and its header stays in view', () => {
  const drill = document.querySelector('.drill');
  if (document.activeElement !== drill) {
    throw new Error(`focus is on ${document.activeElement?.className || document.activeElement?.tagName}`);
  }
  const header = drill.querySelector('header');
  if (dom.window.getComputedStyle(header).position !== 'sticky') throw new Error('the header scrolls away in a long list');
});

await step('a row opens the card editor, and Esc there closes only the editor', async () => {
  await click(q('.drill-row')[0]);
  await settle();
  const editor = document.querySelector('.modal');
  if (!editor) throw new Error('card editor did not open');
  if (!editor.querySelector('h2').textContent.includes('WRK-2')) throw new Error('the editor opened another card');
  // The editor closes on Esc; the list under it must ignore that Esc.
  await act(async () => { dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })); });
  await settle();
  if (document.querySelector('.modal')) throw new Error('card editor did not close');
  if (!document.querySelector('.drill')) throw new Error('Esc in the editor closed the list too');
});

await step('Esc closes the list', async () => {
  if (!document.querySelector('.drill')) throw new Error('no list open to close');
  await act(async () => { dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })); });
  if (document.querySelector('.drill')) throw new Error('list still open');
});

await step("a project's column part lists just those cards", async () => {
  const part = q('.dash .pick').find((p) => p.getAttribute('aria-label') === 'Waiting · House chores · 1 card');
  if (!part) throw new Error('no Waiting part for House chores');
  await click(part);
  if (document.querySelector('.drill h3')?.textContent !== 'Waiting · House chores · 1') throw new Error('wrong list');
});

await step('estimated weeks are marked, and archived cards cannot be opened', async () => {
  const est = q('.dash rect[data-estimated]');
  if (est.length !== 1) throw new Error(`estimated bars: ${est.length}`);
  if (!document.querySelector('.est-note')) throw new Error('no estimate note');
  document.querySelector('.drill')?.blur();
  await click(est[0]);
  const row = q('.drill-row')[0];
  if (!row?.disabled || !row.textContent.includes('archived')) throw new Error('archived row should be shown and disabled');
  if (document.activeElement !== document.querySelector('.drill')) throw new Error('the list did not take focus for its new title');
});

await step('"Longest in" keeps the slowest first and says how long', async () => {
  const bar = q('.dash .pick').find((p) => p.getAttribute('aria-label') === 'Longest in Doing · 2 cards');
  if (!bar) throw new Error('no median bar for Doing');
  await click(bar);
  const rows = q('.drill-row').map((r) => [r.querySelector('.card-no').textContent, r.querySelector('.drill-age').textContent]);
  // The server says WRK-3 sat longest; sorting by last change would wrongly put WRK-2 (older change) first.
  if (JSON.stringify(rows) !== JSON.stringify([['WRK-3', '6.5d in Doing'], ['WRK-2', '1d in Doing']])) {
    throw new Error(`longest rows: ${JSON.stringify(rows)}`);
  }
});

await step('a median of 0 days still has a bar you can see and click', async () => {
  const bar = q('.dash .pick').find((p) => p.getAttribute('aria-label') === 'Longest in Review · 1 card');
  if (!bar) throw new Error('no median bar for Review');
  const height = Number(bar.getAttribute('height'));
  if (!(height >= 4)) throw new Error(`the bar is ${height}px tall`);
  await click(bar);
  if (document.querySelector('.drill h3')?.textContent !== 'Longest in Review · 1') throw new Error('its list did not open');
});

/** The server's ping that something changed, as the live stream sends it. */
const liveChange = async () => {
  const stream = streams.find((x) => !x.closed);
  await act(async () => { stream.emit('change', { revision: 3, source: 'PATCH /cards' }); });
  await settle();
};

await step('a change from elsewhere re-reads the dashboard', async () => {
  const count = () => q('.tile').find((t) => t.textContent.includes('Waiting'))?.querySelector('b').textContent;
  if (count() !== '2') throw new Error(`Waiting starts at ${count()}`);
  const kept = state.insights.stuck;
  state.insights.stuck = { ...kept, waiting: [12] };
  await liveChange();
  const after = count();
  state.insights.stuck = kept;
  await liveChange();
  if (after !== '1') throw new Error(`the Waiting tile reads ${after} after the change, expected 1`);
  if (count() !== '2') throw new Error('the Waiting tile did not go back');
});

await step('with nothing in the last 12 weeks, the week charts say so', async () => {
  const kept = { weeks: state.insights.weeks, agents: state.insights.agents };
  state.insights.weeks = kept.weeks.map((w) => ({ ...w, added: [], finished: [], estimated: false }));
  state.insights.agents = { ...kept.agents, weeks: kept.agents.weeks.map((w) => ({ ...w, agent: [], you: [] })) };
  await liveChange();
  const notes = q('.dash .dash-empty').map((p) => p.textContent);
  const charts = q('.dash svg[aria-label]').map((svg) => svg.getAttribute('aria-label'));
  Object.assign(state.insights, kept);
  await liveChange();
  for (const want of ['Nothing added or finished in the last 12 weeks.',
    'Collecting since 2026-11-05. Changes by agents and by you appear as cards move.']) {
    if (!notes.includes(want)) throw new Error(`missing "${want}", got: ${notes.join(' | ')}`);
  }
  if (charts.includes('Finished and added per week') || charts.includes('Agent against you per week')) {
    throw new Error(`empty charts were still drawn: ${charts.join(', ')}`);
  }
});

await step("a slow answer for another board never shows under this one", async () => {
  let release = () => {};
  const held = new Promise((r) => { release = r; });
  const prev = g.fetch;
  // Personal's numbers are held back until the test lets them through.
  const slow = (url, opts = {}) => (/\/insights\?board_id=2&/.test(String(url))
    ? held.then(() => prev(url, opts)) : prev(url, opts));
  g.fetch = slow; dom.window.fetch = slow;
  const select = container.querySelector('.board-select');
  const pickBoard = async (id) => {
    await act(async () => {
      select.value = String(id);
      select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    await settle();
  };
  try {
    await pickBoard(2);
    if (container.querySelector('.dash')) throw new Error("Work's numbers showed under Personal");
    await pickBoard(1);
    if (!container.querySelector('.dash')) throw new Error("Work's numbers did not come back");
    await act(async () => { release(); });
    await settle();
    if (!container.querySelector('.dash')) throw new Error("Personal's late answer replaced Work's numbers");
  } finally {
    release();
    g.fetch = prev; dom.window.fetch = prev;
  }
});

await step('closing the list gives focus back to what opened it', async () => {
  const tile = q('.tile').find((t) => t.textContent.includes('Waiting'));
  tile.focus();   // as a click or Tab would in a browser
  await click(tile);
  if (document.activeElement !== document.querySelector('.drill')) throw new Error('the list did not take focus');
  await click(document.querySelector('.drill header button'));
  if (document.querySelector('.drill')) throw new Error('✕ did not close the list');
  if (document.activeElement !== tile) {
    throw new Error(`focus went to ${document.activeElement?.className || document.activeElement?.tagName}`);
  }
});

await step('the dashboard is remembered as the view', () => {
  if (dom.window.localStorage.getItem('kanban.view') !== '"dashboard"') throw new Error('view not remembered');
});

console.log('');
if (problems.length) {
  console.log(`FAILED with ${problems.length} problem(s):\n`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('All checks passed.\n');
process.exit(0);
