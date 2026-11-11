// Planner: Day and Month calendar views, with a sidebar of sticky tasks grouped
// into Unplanned / Doing / Planned / Backlog / Done. Drag a sticky onto a
// day to plan it; drag it onto a section to change its state.

import { h, icon, clear, confirmDialog } from './ui.js';
import { SECTIONS, sectionOf, liveItems, monthGrid, isoDate, htmlToText } from './model.js';
import { createEditor, attachmentList } from './editor.js';
import { currentProject, projectSelect } from './projects.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches;
const state = { y: new Date().getFullYear(), m: new Date().getMonth(), day: isoDate(new Date()), mode: phone ? 'day' : 'month', collapsed: new Set(phone ? ['done', 'backlog'] : ['done']) };

export function renderPlanner(root, vault) {
  clear(root);
  const project = currentProject(vault);
  const tasks = liveItems(vault.doc, 'task').filter((t) => !project || t.projectId === project);
  const rerender = () => renderPlanner(root, vault);

  // ---- sidebar ----
  const quick = h('input', { type: 'text', placeholder: 'Add a task and press Enter', 'aria-label': 'New task', maxlength: 300 });
  quick.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    vault.put({ type: 'task', title: quick.value.trim(), status: 'todo', projectId: project || null, attachments: [] });
    quick.value = '';
    rerender();
    root.querySelector('.quick input')?.focus();
  });

  const sideHidden = pref('side');
  const toggleSide = (v) => { pref('side', v); rerender(); };
  const side = sideHidden
    ? h('aside', { class: 'side rail' },
      h('button', { class: 'icon-btn', title: 'Show tasks', 'aria-label': 'Show tasks', onclick: () => toggleSide(false) }, icon('expand')),
      SECTIONS.filter((s) => s.key !== 'done').map((s) => {
        const n = tasks.filter((t) => sectionOf(t) === s.key).length;
        const b = h('button', { class: `rail-sec st-${s.key}`, title: `${s.label}: ${n}`, 'aria-label': `${s.label}: ${n}`, onclick: () => { state.collapsed.delete(s.key); toggleSide(false); } }, String(n));
        dropTarget(b, (id) => { vault.update(id, { unplanned: { status: 'todo', date: null }, doing: { status: 'doing' }, planned: { status: 'todo' }, backlog: { status: 'backlog' } }[s.key]); rerender(); });
        return b;
      }))
    : h('aside', { class: 'side' },
    h('div', { class: 'quick' }, quick,
      h('button', { class: 'icon-btn side-hide', title: 'Hide tasks (more room for the calendar)', 'aria-label': 'Hide tasks', onclick: () => toggleSide(true) }, icon('collapse'))),
    SECTIONS.map((s) => {
      const list = tasks.filter((t) => sectionOf(t) === s.key).sort(sortTasks);
      const open = !state.collapsed.has(s.key);
      const sec = h('section', { class: `sec sec-${s.key}`, dataset: { section: s.key } },
        h('button', { class: 'sec-head', 'aria-expanded': String(open), onclick: () => { open ? state.collapsed.add(s.key) : state.collapsed.delete(s.key); rerender(); } },
          h('span', {}, s.label), h('span', { class: 'count' }, String(list.length))),
        open && h('div', { class: 'stickies' }, list.length ? list.map((t) => sticky(t)) : h('div', { class: 'muted small empty-drop' }, 'Drop here')));
      dropTarget(sec, (id) => {
        const t = vault.get(id);
        if (!t) return;
        const patch = { unplanned: { status: 'todo', date: null }, doing: { status: 'doing' }, planned: { status: 'todo' }, backlog: { status: 'backlog' }, done: { status: 'done' } }[s.key];
        if (s.key === 'planned' && !t.date) patch.date = isoDate(new Date());
        vault.update(id, patch);
        rerender();
      });
      return sec;
    }));

  function sticky(t) {
    const p = t.projectId && vault.get(t.projectId);
    const el = h('div', { class: `sticky st-${sectionOf(t)} tilt${tiltOf(t.id)}`, draggable: 'true', tabindex: '0', role: 'button', dataset: { id: t.id }, vars: p ? { '--pc': p.color } : {} },
      h('span', { class: 'tape', 'aria-hidden': 'true' }),
      h('div', { class: 'st-title' }, t.title || 'Untitled'),
      h('div', { class: 'st-meta' },
        p && h('span', { class: 'ptag pdot' }, p.name),
        t.date && h('span', {}, icon('calendar'), shortDate(t.date) + (t.time ? ` ${rangeLabel(t)}` : '')),
        t.due && h('span', { class: isOverdue(t) ? 'overdue' : '' }, `due ${shortDate(t.due)}`),
        (t.attachments || []).length > 0 && h('span', {}, icon('clip'), String(t.attachments.length))));
    dragSource(el, t.id);
    el.addEventListener('click', () => openTask(vault, t.id, rerender));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTask(vault, t.id, rerender); });
    return el;
  }

  // ---- calendar ----
  const isDay = state.mode === 'day';
  const title = isDay
    ? new Date(state.day + 'T00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : new Date(state.y, state.m, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const step = (n) => { if (isDay) setDay(addDays(state.day, n)); else shift(n); rerender(); };
  const nav = h('div', { class: 'cal-nav' },
    h('button', { class: 'icon-btn', 'aria-label': isDay ? 'Previous day' : 'Previous month', onclick: () => step(-1) }, icon('left')),
    h('button', { class: 'btn', onclick: () => { setDay(isoDate(new Date())); rerender(); } }, 'Today'),
    h('button', { class: 'icon-btn', 'aria-label': isDay ? 'Next day' : 'Next month', onclick: () => step(1) }, icon('right')),
    h('h2', {}, title),
    h('span', { class: 'grow' }),
    h('div', { class: 'seg' },
      h('button', { class: isDay ? 'on' : '', 'aria-pressed': String(isDay), onclick: () => { state.mode = 'day'; rerender(); } }, 'Day'),
      h('button', { class: !isDay ? 'on' : '', 'aria-pressed': String(!isDay), onclick: () => { state.mode = 'month'; rerender(); } }, 'Month')));

  const today = isoDate(new Date());
  const byDate = new Map();
  for (const t of tasks) if (t.date && t.status !== 'backlog') { if (!byDate.has(t.date)) byDate.set(t.date, []); byDate.get(t.date).push(t); }
  for (const l of byDate.values()) l.sort(sortTasks);

  let body;
  if (state.mode === 'month') {
    body = h('div', { class: 'cal' },
      WEEKDAYS.map((w) => h('div', { class: 'wd' }, w)),
      monthGrid(state.y, state.m).map((d) => {
        const list = byDate.get(d.date) || [];
        const cell = h('div', { class: `day${d.inMonth ? '' : ' out'}${d.date === today ? ' today' : ''}`, dataset: { date: d.date } },
          h('div', { class: 'day-head' },
            h('button', { class: 'dnum', 'aria-label': `Open day ${d.date}`, onclick: (e) => { e.stopPropagation(); openDay(d.date); } }, String(d.day)),
            h('button', { class: 'add', 'aria-label': `Add task on ${d.date}`, onclick: (e) => { e.stopPropagation(); addOn(d.date); } }, icon('plus'))),
          list.slice(0, 4).map((t) => chip(t)),
          list.length > 4 && h('button', { class: 'more', onclick: (e) => { e.stopPropagation(); openDay(d.date); } }, `+${list.length - 4} more`));
        cell.addEventListener('click', (e) => { if (e.target === cell || e.target.classList.contains('day-head')) openDay(d.date); });
        dropTarget(cell, (id) => {
          const t = vault.get(id);
          vault.update(id, { date: d.date, status: t.status === 'backlog' ? 'todo' : t.status });
          rerender();
        });
        return cell;
      }));
  } else {
    // Day view: untimed tasks on top, then an hour-by-hour timeline.
    const list = byDate.get(state.day) || [];
    const untimed = list.filter((t) => !t.time);
    const allDay = h('div', { class: 'dv-allday' },
      h('div', { class: 'dv-label' }, 'Any time'),
      h('div', { class: 'dv-slot' }, untimed.map((t) => chip(t, true)),
        h('button', { class: 'add-inline', onclick: () => addOn(state.day) }, icon('plus'), 'Add')));
    dropTarget(allDay, (id) => { const t = vault.get(id); vault.update(id, { date: state.day, time: null, status: t.status === 'backlog' ? 'todo' : t.status }); rerender(); });
    body = h('div', { class: 'dayview' }, allDay, timeline(list),
      h('p', { class: 'muted small' }, 'Drag a sticky onto the timeline to plan it; drag a block to move it, or its bottom edge to change how long it takes. Double-click to add a task.'));
  }

  /** Day timeline: each timed task is a block from its start to its end, positioned by minute. */
  function timeline(list) {
    const timed = list.filter((t) => t.time).sort(sortTasks);
    const firstH = Math.min(6, ...timed.map((t) => Math.floor(toMin(t.time) / 60)));
    const base = firstH * 60;
    const grid = h('div', { class: 'dv-grid', vars: { '--rows': String(24 - firstH), '--hour': HOUR_PX + 'px' } });
    for (let hr = firstH; hr < 24; hr++) {
      const hh = String(hr).padStart(2, '0');
      grid.append(h('div', { class: 'dv-hour', dataset: { hour: hh } }, h('div', { class: 'dv-label' }, `${hh}:00`)));
    }
    const minuteAt = (clientY) => {
      const r = grid.getBoundingClientRect();
      return base + Math.round((clientY - r.top) / PXM / SNAP) * SNAP;
    };
    grid.addEventListener('dblclick', (e) => { if (!e.target.closest('.dv-event')) addOn(state.day, fromMin(Math.floor(minuteAt(e.clientY) / 60) * 60)); });
    // Dropping a sticky or a block anywhere on the timeline plans it at that quarter hour.
    grid.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-planner-task')) { e.preventDefault(); grid.classList.add('over'); } });
    grid.addEventListener('dragleave', (e) => { if (!grid.contains(e.relatedTarget)) grid.classList.remove('over'); });
    grid.addEventListener('drop', (e) => {
      grid.classList.remove('over');
      const id = e.dataTransfer.getData('text/x-planner-task');
      if (!id) return;
      e.preventDefault(); e.stopPropagation();
      const t = vault.get(id);
      const offset = Number(e.dataTransfer.getData('text/x-planner-offset') || 0);
      const m = Math.max(0, Math.min(24 * 60 - SNAP, minuteAt(e.clientY - offset)));
      vault.update(id, { date: state.day, time: fromMin(m), status: t.status === 'backlog' ? 'todo' : t.status });
      rerender();
    });

    // Lay out overlapping blocks side by side: a column for each block within a cluster.
    const cols = []; let cluster = []; let clusterEnd = -1;
    const flush = () => { const n = Math.max(1, ...cluster.map((c) => c.col + 1)); for (const c of cluster) c.n = n; cluster = []; };
    for (const t of timed) {
      const s0 = toMin(t.time), e0 = endOf(t);
      if (s0 >= clusterEnd) { flush(); clusterEnd = -1; }
      const used = new Set(cluster.filter((c) => c.end > s0).map((c) => c.col));
      let col = 0; while (used.has(col)) col++;
      const c = { t, start: s0, end: e0, col, n: 1 };
      cluster.push(c); cols.push(c); clusterEnd = Math.max(clusterEnd, e0);
    }
    flush();
    const layer = h('div', { class: 'dv-events' }, cols.map((c) => block(c)));
    grid.append(layer);
    return grid;

    function block({ t, start, end, col, n }) {
      const p = t.projectId && vault.get(t.projectId);
      const label = h('span', { class: 'ev-time' }, rangeLabel(t));
      const el = h('div', {
        class: `dv-event st-${sectionOf(t)}${t.status === 'done' ? ' done' : ''}`, draggable: 'true', tabindex: '0', role: 'button',
        dataset: { id: t.id }, title: `${t.title || 'Untitled'} (${rangeLabel(t)})`,
        vars: { '--top': (start - base) * PXM + 'px', '--h': Math.max(SNAP, end - start) * PXM + 'px', '--col': String(col), '--n': String(n), ...(p ? { '--pc': p.color } : {}) },
      }, h('span', { class: 'ev-title' }, t.title || 'Untitled'), label, p && h('span', { class: 'pdot' }, p.name));
      const handle = h('div', { class: 'ev-resize', title: 'Drag to change how long it takes', 'aria-hidden': 'true' });
      el.append(handle);
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-planner-task', t.id);
        e.dataTransfer.setData('text/x-planner-offset', String(e.clientY - el.getBoundingClientRect().top));
        e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      let resized = false;
      el.addEventListener('click', (e) => { e.stopPropagation(); if (resized) { resized = false; return; } openTask(vault, t.id, rerender); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTask(vault, t.id, rerender); });
      // Resize: drag the bottom edge; snaps to 15 minutes; never shorter than 15 or past midnight.
      handle.addEventListener('mousedown', (e) => e.stopPropagation());
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        el.draggable = false; handle.setPointerCapture(e.pointerId); el.classList.add('resizing');
        const top = el.getBoundingClientRect().top;
        let dur = end - start;
        const move = (ev) => {
          dur = Math.max(SNAP, Math.min(24 * 60 - start, Math.round((ev.clientY - top) / PXM / SNAP) * SNAP));
          el.style.setProperty('--h', dur * PXM + 'px');
          label.textContent = `${t.time}–${endLabel(start + dur)}`;
        };
        const up = () => {
          handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
          el.classList.remove('resizing'); el.draggable = true; resized = true;
          setTimeout(() => { resized = false; }, 300);
          if (dur !== end - start) { vault.update(t.id, { dur }); rerender(); }
        };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
      });
      return el;
    }
  }

  function openDay(date) {
    state.day = date; state.mode = 'day';
    const d = new Date(date + 'T00:00'); state.y = d.getFullYear(); state.m = d.getMonth();
    rerender();
  }

  function chip(t, long = false) {
    const p = t.projectId && vault.get(t.projectId);
    const el = h('button', { class: `chip st-${sectionOf(t)}${t.status === 'done' ? ' done' : ''}`, draggable: 'true', dataset: { id: t.id }, vars: p ? { '--pc': p.color } : {}, title: t.title },
      t.time && h('span', { class: 'time' }, rangeLabel(t)), h('span', { class: 'ct' }, t.title || 'Untitled'),
      long && p && h('span', { class: 'pdot' }, p.name));
    dragSource(el, t.id);
    el.addEventListener('click', (e) => { e.stopPropagation(); openTask(vault, t.id, rerender); });
    return el;
  }

  function addOn(date, time = null) {
    const t = vault.put({ type: 'task', title: '', status: 'todo', date, time, projectId: project || null, attachments: [] });
    openTask(vault, t.id, rerender, { isNew: true });
  }

  root.append(h('div', { class: `planner${sideHidden ? ' side-hidden' : ''}` }, side, h('main', { class: 'cal-wrap' }, nav, body)));
}

// ---- time ranges: a task with a time runs for `dur` minutes (default 60) ----
const HOUR_PX = 48, PXM = HOUR_PX / 60, SNAP = 15;
function toMin(hhmm) { return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)); }
function fromMin(m) { m = Math.max(0, Math.min(24 * 60 - 1, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function endLabel(m) { return m >= 24 * 60 ? '24:00' : fromMin(m); }
export function durOf(t) { return Math.max(SNAP, Number(t.dur) || 60); }
function endOf(t) { return Math.min(24 * 60, toMin(t.time) + durOf(t)); }
function rangeLabel(t) { return t.time ? `${t.time}–${endLabel(endOf(t))}` : ''; }
function fmtDur(m) { return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`; }

function pref(k, v) {
  const key = 'planner.pane.' + k;
  try { if (v === undefined) return localStorage.getItem(key) === '1'; localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ }
  return false;
}

function tiltOf(id) {
  return parseInt(id.slice(-2), 16) % 4;
}

function shift(n) {
  const d = new Date(state.y, state.m + n, 1);
  state.y = d.getFullYear(); state.m = d.getMonth();
}

function setDay(d) {
  state.day = d;
  const x = new Date(d + 'T00:00'); state.y = x.getFullYear(); state.m = x.getMonth();
}
function addDays(d, n) {
  const x = new Date(d + 'T00:00'); x.setDate(x.getDate() + n); return isoDate(x);
}

function sortTasks(a, b) {
  return (a.date || '9').localeCompare(b.date || '9') || (a.time || '99').localeCompare(b.time || '99') || (a.createdAt || 0) - (b.createdAt || 0);
}
function shortDate(d) { return new Date(d + 'T00:00').toLocaleDateString([], { day: 'numeric', month: 'short' }); }
function isOverdue(t) { return t.due && t.status !== 'done' && t.due < isoDate(new Date()); }

function dragSource(el, id) {
  el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-planner-task', id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
}
function dropTarget(el, onDrop) {
  el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-planner-task')) { e.preventDefault(); el.classList.add('over'); } });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
  el.addEventListener('drop', (e) => {
    el.classList.remove('over');
    const id = e.dataTransfer.getData('text/x-planner-task');
    if (id) { e.preventDefault(); e.stopPropagation(); onDrop(id); }
  });
}

/** Task editor dialog. Edits autosave. */
/**
 * To-do details: opens as a full-height panel styled exactly like a note
 * (same toolbar, title, editor and attachments). Edits autosave.
 */
export function openTask(vault, id, after, { isNew = false } = {}) {
  const t = vault.get(id);
  if (!t) return;
  const save = (patch) => vault.update(id, patch);
  const titleIn = h('input', { type: 'text', class: 'title-in', value: t.title, placeholder: 'To-do title', maxlength: 300, 'aria-label': 'Title', oninput: (e) => save({ title: e.target.value }) });
  const attBox = h('div');
  const drawAtts = () => { clear(attBox).append(attachmentList(vault, vault.get(id)?.attachments || [], { onRemove: (aid) => {
    vault.removeAttachment(aid);
    editor.body.querySelectorAll(`[data-att="${aid}"]`).forEach((n) => n.remove());
    save({ attachments: (vault.get(id).attachments || []).filter((x) => x !== aid), html: editor.getHtml() });
    drawAtts();
  } })); };
  const editor = createEditor({
    vault, html: t.html || '', ownerId: id, placeholder: "Notes for this to-do. Type '/' for blocks, or use Markdown; paste screenshots straight in.",
    numbered: !!t.numHeads, onNumbered: (v) => save({ numHeads: v }),
    onChange: (html) => save({ html }),
    onAttachmentsChange: (aid) => { save({ attachments: [...(vault.get(id).attachments || []), aid] }); drawAtts(); },
  });
  drawAtts();

  const band = h('div', { class: `sheet-band st-${sectionOf(t)}` });
  const recolor = () => { const cur = vault.get(id); if (cur) band.className = `sheet-band st-${sectionOf(cur)}`; };
  const field = (label, input) => h('label', { class: 'mfield' }, h('span', {}, label), input);
  // Start and end time: the end sets how long the task takes (shown as a block of that length in Day view).
  const durNote = h('span', {});
  const startIn = h('input', { type: 'time', step: 900, value: t.time || '' });
  const endIn = h('input', { type: 'time', step: 900, value: t.time ? endLabel(endOf(t)).replace('24:00', '23:59') : '', disabled: !t.time });
  const showDur = () => { const cur = vault.get(id); durNote.textContent = cur && cur.time ? 'Takes ' + fmtDur(durOf(cur)) : 'Set a start time to give it a length'; };
  startIn.addEventListener('change', () => {
    const v = startIn.value || null;
    save({ time: v });
    endIn.disabled = !v;
    const cur = vault.get(id);
    endIn.value = v ? endLabel(endOf(cur)).replace('24:00', '23:59') : '';
    showDur();
  });
  endIn.addEventListener('change', () => {
    const cur = vault.get(id); if (!cur || !cur.time || !endIn.value) return;
    let d = toMin(endIn.value) - toMin(cur.time);
    if (endIn.value === '23:59') d += 1;
    if (d < SNAP) { d = SNAP; endIn.value = endLabel(toMin(cur.time) + d); }
    save({ dur: d });
    showDur();
  });
  showDur();
  const statusSel = h('select', { 'aria-label': 'Status', onchange: (e) => { save({ status: e.target.value }); recolor(); } },
    [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done'], ['backlog', 'Backlog']].map(([v, l]) => h('option', { value: v, selected: t.status === v }, l)));
  const dlg = h('dialog', { class: 'sheet', 'aria-label': 'To-do' },
    band,
    h('div', { class: 'sheet-top' },
      h('span', { class: 'sheet-kind' }, icon('check'), isNew ? 'New to-do' : 'To-do'),
      h('span', { class: 'grow' }),
      h('span', { class: 'muted small' }, 'Saves automatically'),
      h('button', { class: 'icon-btn', title: 'Delete to-do', 'aria-label': 'Delete to-do', onclick: async () => {
        if (await confirmDialog('Delete this to-do with its notes and attachments?', { ok: 'Delete', danger: true })) { vault.remove(id); dlg.close(); }
      } }, icon('trash')),
      h('button', { class: 'btn primary small', onclick: () => dlg.close() }, 'Done'),
      h('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))),
    editor.bar,
    h('div', { class: 'n-scroll' },
      h('div', { class: 'n-doc' },
        titleIn,
        h('div', { class: 'task-meta' },
          field('Status', statusSel),
          field('Project', projectSelect(vault, t.projectId, (v) => save({ projectId: v }))),
          field('Planned for', h('input', { type: 'date', value: t.date || '', onchange: (e) => { save({ date: e.target.value || null }); recolor(); } })),
          field('Starts', startIn),
          field('Ends', endIn),
          h('span', { class: 'mfield dur-note muted small' }, durNote),
          field('Due', h('input', { type: 'date', value: t.due || '', onchange: (e) => save({ due: e.target.value || null }) }))),
        editor.el,
        h('h3', { class: 'small-h' }, 'All attachments in this to-do'),
        attBox)));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    editor.flush();
    dlg.remove();
    const cur = vault.get(id);
    if (cur && !(cur.title || '').trim() && !htmlToText(cur.html) && !(cur.attachments || []).length) vault.remove(id);
    after?.();
  });
  document.body.append(dlg);
  dlg.showModal();
  (isNew ? titleIn : editor.body).focus();
}
