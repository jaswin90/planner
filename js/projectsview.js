// Projects: one page per project, with its tasks as a board (To do / Doing /
// Backlog / Done; drag cards between columns) and its notes.

import { h, icon, clear, promptDialog, confirmDialog, toast } from './ui.js';
import { liveItems, isoDate, htmlToText } from './model.js';
import { openTask } from './planner.js';
import { projects, newProject, COLORS } from './projects.js';
import { dayLabel, timeRange } from './home.js';

const COLS = [
  { key: 'todo', label: 'To do', patch: { status: 'todo' } },
  { key: 'doing', label: 'Doing', patch: { status: 'doing' } },
  { key: 'backlog', label: 'Backlog', patch: { status: 'backlog' } },
  { key: 'done', label: 'Done', patch: { status: 'done' } },
];
const NONE = 'none';

export function renderProjects(root, vault, { openId } = {}) {
  clear(root);
  const all = projects(vault);
  const tasks = liveItems(vault.doc, 'task');
  const notes = liveItems(vault.doc, 'note');
  let id = openId && (openId === NONE || vault.get(openId)) ? openId : all[0]?.id || NONE;
  const rerender = () => renderProjects(root, vault, { openId: id });
  const go = (pid) => { location.hash = `#/projects/${pid}`; };
  const inProj = (x) => (id === NONE ? !x.projectId || !vault.get(x.projectId) : x.projectId === id);

  const count = (pid) => tasks.filter((t) => t.status !== 'done' && (pid === NONE ? !t.projectId || !vault.get(t.projectId) : t.projectId === pid)).length;
  const navItem = (pid, label, color) => h('a', { class: `nav-it${pid === id ? ' on' : ''}`, href: `#/projects/${pid}` },
    color ? h('span', { class: 'pdot-only', vars: { '--pc': color } }) : h('span', { class: 'pdot-only all' }),
    h('span', { class: 'grow' }, label), h('span', { class: 'cnt' }, String(count(pid))));
  const nav = h('aside', { class: 'n-nav pj-nav' },
    h('a', { class: 'nav-it', href: '#/projects' }, icon('home'), h('span', { class: 'grow' }, 'Overview')),
    h('div', { class: 'nav-sec' }, 'Projects'),
    all.map((p) => navItem(p.id, p.name, p.color)),
    navItem(NONE, 'No project'),
    h('button', { class: 'nav-it accent', onclick: async () => { const p = await newProject(vault); if (p) go(p.id); } }, icon('plus'), 'New project'));

  const p = id === NONE ? null : vault.get(id);
  const pt = tasks.filter(inProj);
  const done = pt.filter((t) => t.status === 'done').length;
  const pct = pt.length ? Math.round((100 * done) / pt.length) : 0;
  const today = isoDate(new Date());

  const head = h('div', { class: 'pj-head', vars: p ? { '--pc': p.color } : {} },
    h('div', { class: 'pj-title' },
      h('span', { class: `pdot-only big${p ? '' : ' all'}` }),
      h('h1', {}, p ? p.name : 'Tasks without a project'),
      p && h('button', { class: 'icon-btn', title: 'Rename project', 'aria-label': 'Rename project', onclick: async () => {
        const name = (await promptDialog('Rename project', { label: 'Project name', value: p.name }))?.trim();
        if (!name) return;
        if (all.some((q) => q.id !== p.id && q.name.toLowerCase() === name.toLowerCase())) return toast('A project with that name already exists.', 'error');
        vault.update(p.id, { name: name.slice(0, 60) }); rerender();
      } }, '✎'),
      h('span', { class: 'grow' }),
      p && h('div', { class: 'pj-colors', role: 'group', 'aria-label': 'Project colour' }, COLORS.map((c) => h('button', {
        class: `swatch${p.color === c ? ' on' : ''}`, vars: { '--pc': c }, 'aria-label': 'Colour', onclick: () => { vault.update(p.id, { color: c }); rerender(); } }))),
      p && h('button', { class: 'icon-btn', title: 'Delete project', 'aria-label': 'Delete project', onclick: async () => {
        if (!(await confirmDialog(`Delete the project "${p.name}"? Its tasks and notes are kept, without a project.`, { ok: 'Delete', danger: true }))) return;
        for (const x of [...tasks, ...notes]) if (x.projectId === p.id) vault.update(x.id, { projectId: null });
        vault.remove(p.id); go(NONE);
      } }, icon('trash'))),
    h('div', { class: 'pj-progress' }, h('div', { class: 'pbar' }, h('span', { vars: { '--w': pct + '%' } })),
      h('span', { class: 'muted small' }, pt.length ? `${done} of ${pt.length} tasks done (${pct}%)` : 'No tasks yet')));

  const card = (t) => {
    const late = t.status !== 'done' && ((t.date && t.date < today) || (t.due && t.due < today));
    const el = h('div', { class: `bcard${t.status === 'done' ? ' done' : ''}`, draggable: 'true', tabindex: '0', role: 'button' },
      h('div', { class: 'bcard-t' }, t.title || 'Untitled'),
      h('div', { class: 'bcard-m' },
        t.date && h('span', { class: late ? 'overdue' : '' }, icon('calendar'), dayLabel(t.date, today) + (t.time ? ' ' + timeRange(t) : '')),
        t.due && h('span', { class: t.due < today && t.status !== 'done' ? 'overdue' : '' }, `due ${dayLabel(t.due, today)}`),
        (t.attachments || []).length > 0 && h('span', {}, icon('clip'), String(t.attachments.length)),
        htmlToText(t.html) && h('span', { title: 'Has notes' }, icon('note'))));
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-planner-task', t.id); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('click', () => openTask(vault, t.id, rerender));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTask(vault, t.id, rerender); });
    return el;
  };
  const sortCol = (a, b) => (a.date || '9').localeCompare(b.date || '9') || (a.time || '99').localeCompare(b.time || '99') || (a.createdAt || 0) - (b.createdAt || 0);
  const board = h('div', { class: 'board' }, COLS.map((c) => {
    const list = pt.filter((t) => (t.status || 'todo') === c.key).sort(c.key === 'done' ? (a, b) => b.updatedAt - a.updatedAt : sortCol);
    const add = h('input', { type: 'text', placeholder: '+ Add a task', 'aria-label': `Add a task to ${c.label}`, maxlength: 300 });
    add.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !add.value.trim()) return;
      vault.put({ type: 'task', title: add.value.trim(), status: c.key, projectId: p ? p.id : null, attachments: [] });
      rerender();
      root.querySelector(`.bcol-${c.key} input`)?.focus();
    });
    const col = h('section', { class: `bcol bcol-${c.key}` },
      h('div', { class: 'bcol-h' }, h('span', {}, c.label), h('span', { class: 'cnt' }, String(list.length))),
      c.key !== 'done' && add,
      h('div', { class: 'bcol-list' }, list.length ? list.map(card) : h('div', { class: 'empty-drop muted small' }, 'Drop here')));
    col.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-planner-task')) { e.preventDefault(); col.classList.add('over'); } });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
    col.addEventListener('drop', (e) => {
      col.classList.remove('over');
      const tid = e.dataTransfer.getData('text/x-planner-task');
      if (tid) { e.preventDefault(); vault.update(tid, c.patch); rerender(); }
    });
    return col;
  }));

  const pnotes = notes.filter(inProj).sort((a, b) => b.updatedAt - a.updatedAt);
  const newNote = () => {
    const n = vault.put({ type: 'note', title: '', html: '', projectId: p ? p.id : null, color: 'yellow', attachments: [] });
    openNote(n.id);
  };
  // Notes open in the Notes area, scoped to this project.
  const openNote = (nid) => { try { localStorage.setItem('planner.project', p ? p.id : ''); } catch { /* ignore */ } location.hash = `#/notes/${nid}`; };
  const notesSec = h('section', { class: 'pj-notes' },
    h('div', { class: 'hcard-h' }, h('h2', {}, `Notes · ${pnotes.length}`), h('button', { class: 'btn small', onclick: newNote }, icon('plus'), 'New note')),
    pnotes.length ? h('div', { class: 'pj-ncards' }, pnotes.map((n) => {
      const b = h('button', { class: 'pj-ncard', onclick: () => openNote(n.id) },
        h('b', {}, n.title || 'Untitled'), h('span', { class: 'muted small' }, (htmlToText(n.html) || 'Empty note').slice(0, 140)));
      return b;
    })) : h('p', { class: 'muted small' }, 'No notes in this project yet.'));

  root.append(h('div', { class: 'pj' }, nav, h('main', { class: 'pj-main' }, head, board, notesSec)));
}
