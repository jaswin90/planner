// Projects: the global "Project: X ▾" dropdown and pickers used in notes
// and tasks. The chosen project filters both Planner and Notes.
import { h, icon, promptDialog, toast } from './ui.js';
import { liveItems } from './model.js';

export const COLORS = ['#e8a33d', '#e06fa8', '#5b9bd5', '#4caf7d', '#9b6fd1', '#d9534f', '#3fb5b0', '#8a8f98'];

export function currentProject(vault) {
  let id = '';
  try { id = localStorage.getItem('planner.project') || ''; } catch { /* ignore */ }
  return id && vault.get(id) ? id : '';
}

export function setCurrentProject(id) {
  try { localStorage.setItem('planner.project', id || ''); } catch { /* ignore */ }
  window.dispatchEvent(new Event('projectchange'));
}

export function projects(vault) {
  return liveItems(vault.doc, 'project').sort((a, b) => a.name.localeCompare(b.name));
}

export async function newProject(vault) {
  const name = (await promptDialog('New project', { label: 'Project name', placeholder: 'e.g. Work, Home, Trip' }))?.trim();
  if (!name) return null;
  if (projects(vault).some((p) => p.name.toLowerCase() === name.toLowerCase())) { toast('A project with that name already exists.', 'error'); return null; }
  return vault.put({ type: 'project', name: name.slice(0, 60), color: COLORS[projects(vault).length % COLORS.length] });
}

/** Header dropdown: "● Project: Work ▾" with the list, New project, Manage. */
export function projectDropdown(vault) {
  const cur = vault.get(currentProject(vault));
  const btn = h('button', { class: 'projdd', 'aria-haspopup': 'menu', 'aria-expanded': 'false', vars: cur ? { '--pc': cur.color } : {} },
    h('span', { class: `pdot-only${cur ? '' : ' all'}` }), h('span', { class: 'pd-label' }, 'Project: '), h('b', {}, cur ? cur.name : 'All'), ' ▾');
  const wrap = h('div', { class: 'projdd-wrap' }, btn);
  let menu = null;
  const close = () => { menu?.remove(); menu = null; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  const choose = (id) => { close(); setCurrentProject(id); };
  btn.addEventListener('click', () => {
    if (menu) return close();
    const curId = currentProject(vault);
    const item = (id, label, color) => h('button', { class: `dd-item${curId === id ? ' sel' : ''}`, role: 'menuitemradio', 'aria-checked': String(curId === id), onclick: () => choose(id) },
      color ? h('span', { class: 'pdot-only', vars: { '--pc': color } }) : icon('note'), h('span', { class: 'grow' }, label), curId === id && icon('check'));
    menu = h('div', { class: 'ddmenu', role: 'menu' },
      item('', 'All projects'),
      projects(vault).map((p) => item(p.id, p.name, p.color)),
      h('hr'),
      h('button', { class: 'dd-item accent', onclick: async () => { close(); const p = await newProject(vault); if (p) setCurrentProject(p.id); } }, icon('plus'), 'New project…'),
      h('button', { class: 'dd-item', onclick: () => { close(); location.hash = '#/settings'; } }, icon('gear'), 'Manage projects'));
    wrap.append(menu);
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
  });
  return wrap;
}

/** <select> of projects with a "＋ New project…" entry. */
export function projectSelect(vault, value, onChange, { noneLabel = 'No project' } = {}) {
  const sel = h('select', { 'aria-label': 'Project' });
  const fill = (v) => {
    sel.textContent = '';
    sel.append(h('option', { value: '' }, noneLabel), ...projects(vault).map((p) => h('option', { value: p.id, selected: p.id === v }, p.name)), h('option', { value: '__new' }, '＋ New project…'));
    sel.value = v || '';
  };
  fill(value);
  let last = value || '';
  sel.addEventListener('change', async () => {
    if (sel.value === '__new') {
      const p = await newProject(vault);
      fill(p ? p.id : last);
      if (!p) return;
    }
    last = sel.value;
    onChange(sel.value || null);
  });
  return sel;
}
