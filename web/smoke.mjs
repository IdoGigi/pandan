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
import { pathToFileURL } from 'node:url';

const problems = [];

/* ---- fake board data ---- */
const state = {
  projects: [
    { id: 1, name: 'House chores', color: '#c3d117', position: 1000, archived: 0 },
    { id: 2, name: 'Volunteering', color: '#4bb3d4', position: 2000, archived: 0 },
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

const g = globalThis;
g.window = dom.window;
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
const root = createRoot(container);

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };
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

await step('delete project asks first, in-app', async () => {
  const del = q('.row-label .row-actions .btn').find((b) => b.textContent === '×');
  if (!del) throw new Error('delete button missing');
  await click(del);
  const dlg = document.querySelector('.modal-sm');
  if (!dlg) throw new Error('confirm dialog did not open');
  if (!dlg.textContent.includes('Delete')) throw new Error('wrong confirm text');
  const cancel = [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Cancel');
  await click(cancel);
  if (document.querySelector('.modal-sm')) throw new Error('confirm did not close');
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

console.log('');
if (problems.length) {
  console.log(`FAILED with ${problems.length} problem(s):\n`);
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('All checks passed.\n');
process.exit(0);
