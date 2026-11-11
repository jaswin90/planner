// Home: the landing page. Today's agenda, what is in progress, the next week,
// recent notes and every project at a glance. Everything links into Calendar,
// Projects or Notes.

import { h, icon, clear } from './ui.js';
import { liveItems, isoDate, htmlToText, sectionOf } from './model.js';
import { openTask, durOf } from './planner.js';
import { projects, newProject } from './projects.js';

export function renderHome(root, vault) {
  clear(root);
  const rerender = () => renderHome(root, vault);
  const today = isoDate(new Date());
  const tasks = liveItems(vault.doc, 'task');
  const notes = liveItems(vault.doc, 'note');
  const open = tasks.filter((t) => t.status !== 'done');
  const byTime = (a, b) => (a.date || '9').localeCompare(b.date || '9') || (a.time || '99').localeCompare(b.time || '99') || (a.createdAt || 0) - (b.createdAt || 0);

  const overdue = open.filter((t) => t.status !== 'backlog' && ((t.date && t.date < today) || (t.due && t.due < today))).sort(byTime);
  const todays = tasks.filter((t) => t.date === today && t.status !== 'backlog' && !overdue.includes(t)).sort(byTime);
  const doing = open.filter((t) => t.status === 'doing' && t.date !== today && !overdue.includes(t)).sort(byTime);
  const weekEnd = isoDate(new Date(Date.now() + 7 * 864e5));
  const upcoming = open.filter((t) => t.status !== 'backlog' && t.date && t.date > today && t.date <= weekEnd).sort(byTime);
  const inbox = open.filter((t) => sectionOf(t) === 'unplanned').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = vault.account.mode === 'cloud' ? (vault.account.name || '').split(/[\s@]/)[0] : '';

  const quick = h('input', { type: 'text', placeholder: 'Add a task for today and press Enter', 'aria-label': 'New task for today', maxlength: 300 });
  quick.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    vault.put({ type: 'task', title: quick.value.trim(), status: 'todo', date: today, projectId: null, attachments: [] });
    rerender();
    root.querySelector('.home-quick input')?.focus();
  });

  const row = (t, { showDate = false } = {}) => {
    const p = t.projectId && vault.get(t.projectId);
    const done = t.status === 'done';
    const box = h('button', { class: `tick${done ? ' on' : ''}`, 'aria-label': done ? 'Mark as not done' : 'Mark as done', title: done ? 'Mark as not done' : 'Mark as done' }, done && icon('check'));
    box.addEventListener('click', (e) => { e.stopPropagation(); vault.update(t.id, { status: done ? 'todo' : 'done' }); rerender(); });
    const late = !done && ((t.date && t.date < today) || (t.due && t.due < today));
    const el = h('div', { class: `trow${done ? ' done' : ''}`, tabindex: '0', role: 'button' },
      box,
      h('span', { class: 'trow-t' }, t.title || 'Untitled'),
      h('span', { class: 'trow-m' },
        t.status === 'doing' && h('span', { class: 'pill doing' }, 'Doing'),
        p && h('span', { class: 'ptag pdot', vars: { '--pc': p.color } }, p.name),
        (showDate || late) && t.date && h('span', { class: late ? 'overdue' : '' }, dayLabel(t.date, today)),
        t.time && h('span', {}, timeRange(t)),
        t.due && h('span', { class: t.due < today && !done ? 'overdue' : '' }, `due ${dayLabel(t.due, today)}`)));
    el.addEventListener('click', () => openTask(vault, t.id, rerender));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTask(vault, t.id, rerender); });
    return el;
  };
  const card = (title, action, ...content) => h('section', { class: 'hcard' }, h('div', { class: 'hcard-h' }, h('h2', {}, title), action), ...content);
  const empty = (text) => h('p', { class: 'muted small hempty' }, text);
  const link = (label, hash) => h('a', { class: 'hlink', href: hash }, label, icon('right'));

  // Projects at a glance
  const projs = projects(vault);
  const projCard = (p) => {
    const pt = tasks.filter((t) => t.projectId === p.id);
    const done = pt.filter((t) => t.status === 'done').length;
    const pct = pt.length ? Math.round((100 * done) / pt.length) : 0;
    const next = pt.filter((t) => t.status !== 'done' && t.status !== 'backlog').sort(byTime)[0];
    return h('a', { class: 'pcard', href: `#/projects/${p.id}`, vars: { '--pc': p.color } },
      h('div', { class: 'pcard-h' }, h('span', { class: 'pdot-only' }), h('b', {}, p.name), h('span', { class: 'grow' }), h('span', { class: 'pcard-n' }, String(pt.length - done))),
      h('div', { class: 'muted small' }, `open · ${done} done · ${notes.filter((n) => n.projectId === p.id).length} notes`),
      h('div', { class: 'pbar' }, h('span', { vars: { '--w': pct + '%' } })),
      h('div', { class: 'pcard-next small' }, next ? ['Next: ', next.title || 'Untitled'] : 'No open tasks'));
  };

  const recent = notes.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const newNote = () => { const n = vault.put({ type: 'note', title: '', html: '', projectId: null, color: 'yellow', attachments: [] }); location.hash = `#/notes/${n.id}`; };

  const addProject = async () => { const p = await newProject(vault); if (p) location.hash = `#/projects/${p.id}`; };
  const noProj = tasks.filter((t) => !t.projectId || !vault.get(t.projectId));
  root.append(h('div', { class: 'home' },
    h('div', { class: 'home-head' },
      h('div', {},
        h('h1', {}, first ? `${greet}, ${first}` : greet),
        h('p', { class: 'muted' }, new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
          ' · ', `${todays.filter((t) => t.status !== 'done').length + overdue.length} to do today`)),
      h('div', { class: 'home-quick' }, quick)),
    h('section', { class: 'home-projects' },
      h('div', { class: 'hsec-h' }, h('h2', {}, 'Projects'), h('span', { class: 'grow' }),
        noProj.length > 0 && h('a', { class: 'hlink', href: '#/projects/none' }, `Tasks without a project · ${noProj.filter((t) => t.status !== 'done').length}`, icon('right'))),
      h('div', { class: 'pcards' }, projs.map(projCard),
        h('button', { class: 'pcard pcard-new', onclick: addProject }, icon('plus'), projs.length ? 'New project' : 'Create your first project'))),
    h('div', { class: 'home-grid' },
      h('div', { class: 'hcol' },
        card('Today', link('Open planner', '#/planner'),
          overdue.length > 0 && h('div', { class: 'hgroup' }, h('div', { class: 'hgroup-h overdue' }, `Overdue · ${overdue.length}`), overdue.map((t) => row(t))),
          todays.length ? todays.map((t) => row(t)) : !overdue.length && empty('Nothing planned for today. Add a task above, or drag one onto today in the planner.')),
        card('In progress', null, doing.length ? doing.map((t) => row(t, { showDate: true })) : empty('Nothing in progress. Set a task to “Doing” to see it here.')),
        card('Next 7 days', null, upcoming.length ? upcoming.slice(0, 12).map((t) => row(t, { showDate: true })) : empty('Nothing planned for the coming week.'))),
      h('div', { class: 'hcol' },
        inbox.length > 0 && card(`Not planned yet · ${inbox.length}`, link('Plan', '#/planner'), inbox.slice(0, 6).map((t) => row(t))),
        card('Recent notes', h('button', { class: 'btn small', onclick: newNote }, icon('plus'), 'New note'),
          recent.length ? h('div', { class: 'nlist' }, recent.map((n) => h('a', { class: 'nrow', href: `#/notes/${n.id}` },
            h('b', {}, n.title || 'Untitled'),
            h('span', { class: 'muted small' }, (htmlToText(n.html) || 'Empty note').slice(0, 110)),
            h('span', { class: 'muted small' }, ago(n.updatedAt))))) : empty('No notes yet.'),
          recent.length > 0 && link('All notes', '#/notes'))))));
}

export function dayLabel(d, today = isoDate(new Date())) {
  if (d === today) return 'Today';
  const diff = Math.round((new Date(d + 'T00:00') - new Date(today + 'T00:00')) / 864e5);
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const x = new Date(d + 'T00:00');
  return diff > 0 && diff < 7 ? x.toLocaleDateString([], { weekday: 'short' }) : x.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function timeRange(t) {
  const [hh, mm] = t.time.split(':').map(Number);
  const end = Math.min(24 * 60, hh * 60 + mm + durOf(t));
  const f = (m) => m >= 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${t.time}–${f(end)}`;
}

function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
