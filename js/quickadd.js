// Quick add (the + button on phones): a title, then plain chip buttons for the
// day, an optional start time and length, and the project. No text parsing.

import { h, icon, clear, toast, bottomSheet } from './ui.js';
import { isoDate } from './model.js';
import { projectSelect } from './projects.js';

const addDays = (d, n) => { const x = new Date(d + 'T00:00'); x.setDate(x.getDate() + n); return isoDate(x); };
/** Replace an element's children; skips empty values and flattens arrays (unlike Element.append). */
const fill = (el, ...kids) => { clear(el); for (const k of kids.flat()) if (k != null && k !== false) el.append(k); return el; };
const DURS = [[15, '15 min'], [30, '30 min'], [60, '1 h'], [120, '2 h']];

export function quickAdd(vault, { date = isoDate(new Date()), projectId = null, after } = {}) {
  const today = isoDate(new Date());
  const tomorrow = addDays(today, 1);
  let day = date, time = null, dur = 60, pid = projectId;

  const title = h('input', { type: 'text', class: 'qa-title', placeholder: 'What needs doing?', maxlength: 300, 'aria-label': 'Task', enterkeyhint: 'done', autocomplete: 'off' });
  const dateIn = h('input', { type: 'date', class: 'qa-date', 'aria-label': 'Pick a day' });
  const timeIn = h('input', { type: 'time', step: 900, 'aria-label': 'Start time' });
  const dayRow = h('div', { class: 'qa-row', role: 'group', 'aria-label': 'Day' });
  const timeRow = h('div', { class: 'qa-row', role: 'group', 'aria-label': 'Time' });
  const where = h('span', { class: 'muted small' });

  const chip = (label, on, fn) => h('button', { type: 'button', class: `qchip${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: fn }, label);
  const draw = () => {
    dateIn.value = day || '';
    dateIn.classList.toggle('on', !!day && day !== today && day !== tomorrow);
    fill(dayRow,
      chip('Today', day === today, () => { day = today; draw(); }),
      chip('Tomorrow', day === tomorrow, () => { day = tomorrow; draw(); }),
      dateIn,
      chip('No date', !day, () => { day = null; time = null; draw(); }));
    timeIn.value = time || '';
    timeIn.disabled = !day;
    fill(timeRow, timeIn,
      time ? DURS.map(([m, label]) => chip(label, dur === m, () => { dur = m; draw(); }))
        : h('span', { class: 'muted small' }, day ? 'Optional' : 'Pick a day to set a time'),
      time && h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Clear time', onclick: () => { time = null; draw(); } }, icon('close')));
    where.textContent = day
      ? `Planned for ${new Date(day + 'T00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}${time ? ' at ' + time : ''}`
      : 'Goes to Unplanned';
  };
  dateIn.addEventListener('change', () => { day = dateIn.value || null; if (!day) time = null; draw(); });
  timeIn.addEventListener('change', () => { time = timeIn.value || null; draw(); });

  const add = () => {
    const name = title.value.trim();
    if (!name) { title.focus(); title.classList.add('shake'); setTimeout(() => title.classList.remove('shake'), 400); return; }
    vault.put({ type: 'task', title: name, status: 'todo', date: day, time: day ? time : null, ...(day && time ? { dur } : {}), projectId: pid || null, attachments: [] });
    toast(day ? `Added · ${where.textContent.replace('Planned for ', '')}` : 'Added to Unplanned', 'ok', 2200);
    dlg.close();
    after?.();
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });

  const body = h('div', { class: 'qa' },
    title,
    h('div', { class: 'qa-lab' }, 'Day'), dayRow,
    h('div', { class: 'qa-lab' }, 'Time'), timeRow,
    h('div', { class: 'qa-lab' }, 'Project'), h('div', { class: 'qa-row' }, projectSelect(vault, pid, (v) => { pid = v; })),
    h('div', { class: 'qa-foot' }, where, h('button', { type: 'button', class: 'btn primary', onclick: add }, 'Add')));
  draw();
  const dlg = bottomSheet('New task', body);
  title.focus();
  return dlg;
}
