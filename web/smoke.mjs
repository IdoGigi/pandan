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
  projects: [
    { id: 1, name: 'House chores', color: '#c3d117', position: 1000, archived: 0 },
    { id: 2, name: 'Volunteering', color: '#4bb3d4', position: 2000, archived: 0 },
    { id: 3, name: 'smart-city-dashboard', color: '#e2725b', position: 3000, archived: 0 },
  ],
  cards: [
    { id: 10, project_id: 1, column_key: 'todo', title: 'Buy milk', notes: '', color: 'lime',
      flagged: 0, position: 1000, checks_total: 2, checks_done: 1 },
    { id: 11, project_id: 1, column_key: 'doing', title: 'Fix the sink', notes: 'call plumber',
      color: 'plain', flagged: 1, position: 1000, checks_total: 0, checks_done: 0 },
    { id: 12, project_id: 2, column_key: 'done', title: 'Sort donations', notes: '', color: 'sky',
      flagged: 0, position: 1000, checks_total: 0, checks_done: 0 },
  ],
};

function fakeFetch(url, opts = {}) {
  const path = String(url).replace('/api', '');
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : {};
  const json = (data, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) });

  if (path === '/me') return json({ ok: true });
  if (path === '/login') return json({ ok: true });
  if (path === '/logout') return json({ ok: true });
  if (path === '/board') return json({ columns: ['todo', 'next', 'doing', 'done'], ...state });
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
    const by_column = { todo: 0, next: 0, doing: 0, done: 0 };
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
const click = async (el) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); await settle(); };

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

await step('all four columns present', () => {
  const heads = q('.head-col').map((n) => n.textContent);
  for (const label of ['To do', 'Next', 'Doing', 'Done']) {
    if (!heads.includes(label)) throw new Error(`missing column ${label}`);
  }
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

await step('deleting a card asks first, and keeps the card modal open on cancel', async () => {
  await click(q('.card')[0]);
  if (!document.querySelector('.modal')) throw new Error('card modal did not open');
  const del = [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Delete');
  if (!del) throw new Error('card delete button missing');
  await click(del);
  if (!document.querySelector('.modal-sm')) throw new Error('card delete confirm did not open');
  const cancel = [...document.querySelectorAll('.modal-sm .btn')].find((b) => b.textContent === 'Cancel');
  await click(cancel);
  if (document.querySelector('.modal-sm')) throw new Error('confirm did not close');
  if (!document.querySelector('.modal')) throw new Error('card modal closed too — click leaked through');
  const cardCancel = [...document.querySelectorAll('.modal-actions .btn')].find((b) => b.textContent === 'Cancel');
  await click(cardCancel);
});

await step('filter to one project', async () => {
  const sel = q('.filter-select')[0];
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
  const sel = q('.filter-select')[0];
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
  if (panel.querySelectorAll('.stat').length < 6) throw new Error('stats missing');
  if (!panel.querySelector('.progress-bar span')) throw new Error('progress bar missing');
  if (!panel.querySelector('.mini-card')) throw new Error('card list missing');
});

await step('project panel shows the right counts', async () => {
  const panel = document.querySelector('.modal-wide');
  const stats = [...panel.querySelectorAll('.stat')].map((n) => n.textContent);
  if (!stats.some((t) => t.startsWith('2cards'))) throw new Error(`card count wrong: ${stats.join(' | ')}`);
  if (!panel.textContent.includes('% done')) throw new Error('percent missing');
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

await step('Fold all folds every project, then opens them', async () => {
  const btn = q('.topbar .btn').find((b) => b.textContent === 'Fold all');
  if (!btn) throw new Error('Fold all button missing');
  await click(btn);
  if (q('.row-collapsed').length !== q('.row-label').length) throw new Error('not every row folded');
  const open = q('.topbar .btn').find((b) => b.textContent === 'Open all');
  if (!open) throw new Error('button did not switch to Open all');
  await click(open);
  if (q('.row-collapsed').length) throw new Error('rows did not reopen');
});

await step('compact toggle switches and is remembered', async () => {
  const btn = q('.topbar .btn').find((b) => ['Compact', 'Roomy'].includes(b.textContent));
  if (!btn) throw new Error('density button missing');
  const wasCompact = q('.board')[0].className.includes('compact');
  await click(btn);
  const nowCompact = q('.board')[0].className.includes('compact');
  if (wasCompact === nowCompact) throw new Error('density did not change');
  let saved = null;
  try { saved = JSON.parse(dom.window.localStorage.getItem('kanban.compact')); } catch { /* ignore */ }
  if (saved !== nowCompact) throw new Error('density was not remembered');
  await click(q('.topbar .btn').find((b) => ['Compact', 'Roomy'].includes(b.textContent)));
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

await step('headers and the project column stay pinned', async () => {
  const head = q('.head-col')[0];
  if (dom.window.getComputedStyle(head).position !== 'sticky') throw new Error('column headers not sticky');
  const label = q('.row-label')[0];
  if (dom.window.getComputedStyle(label).position !== 'sticky') throw new Error('project column not sticky');
});

console.log('');
if (problems.length) {
  console.log(`FAILED with ${problems.length} problem(s):\n`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('All checks passed.\n');
process.exit(0);
