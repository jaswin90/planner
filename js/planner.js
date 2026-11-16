// Planner: Day and Month calendar views, with a sidebar of sticky tasks grouped
// into Unplanned / Doing / Planned / Backlog / Done. Drag a sticky onto a
// day to plan it; drag it onto a section to change its state.

import { h, icon, clear, confirmDialog, longPress, toast, actionSheet, isPhone, setTitle, bottomSheet, keepScroll } from './ui.js';
import { SECTIONS, sectionOf, liveItems, monthGrid, isoDate, htmlToText } from './model.js';
import { createEditor, attachmentList } from './editor.js';
import { currentProject, projectSelect } from './projects.js';
import { taskRow } from './home.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const phone = isPhone();
const state = { y: new Date().getFullYear(), m: new Date().getMonth(), day: isoDate(new Date()), mode: phone ? 'day' : 'month', collapsed: new Set(phone ? ['done', 'backlog'] : ['done']) };

export function renderPlanner(root, vault) {
  keepScroll(root, ['.cal-wrap', '.side'], () => draw(root, vault));
}

function draw(root, vault) {
  clear(root);
  HOUR_PX = isPhone() ? 64 : 48; PXM = HOUR_PX / 60;
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
    withMenu(el, vault, t.id, rerender);
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
          if (!t) return;
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
    dropTarget(allDay, (id) => { const t = vault.get(id); if (!t) return; vault.update(id, { date: state.day, time: null, status: t.status === 'backlog' ? 'todo' : t.status }); rerender(); });
    body = h('div', { class: 'dayview' }, allDay, timeline(list),
      h('p', { class: 'muted small' }, 'Drag a sticky onto the timeline to plan it. Drag a block to move it, or its top or bottom edge to change when it starts or ends; drop it on a section on the left to change its status. Double-click to add a task.'));
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
      if (!t) return;
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
    if (state.day === isoDate(new Date())) {
      const now = h('div', { class: 'dv-now', role: 'img', dataset: { base: String(base), pxm: String(PXM), day: state.day } }, h('span', { class: 'dv-now-t' }));
      placeNow(now);
      grid.append(now);
      // The first time today's Day view opens, scroll so "now" sits a third of the way down.
      const key = state.day + state.mode;
      if (state.scrolledFor !== key) {
        state.scrolledFor = key;
        requestAnimationFrame(() => {
          const line = root.querySelector('.dv-now'); // the planner may have been redrawn since
          if (!line) return;
          const sc = scroller(line);
          const y = line.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
          sc.scrollTop = Math.max(0, y - sc.clientHeight / 3);
        });
      }
    }
    return grid;

    function block({ t, start, end, col, n }) {
      const p = t.projectId && vault.get(t.projectId);
      const label = h('span', { class: 'ev-time' }, rangeLabel(t));
      const name = t.title || 'Untitled';
      const el = h('div', {
        class: `dv-event st-${sectionOf(t)}${t.status === 'done' ? ' done' : ''}`, tabindex: '0', role: 'button',
        dataset: { id: t.id }, title: `${name} (${rangeLabel(t)})`,
        'aria-label': `${name}, ${rangeLabel(t)}. Alt+arrows move it, Shift+Alt+arrows change the end.`,
        vars: { '--top': (start - base) * PXM + 'px', '--h': Math.max(SNAP, end - start) * PXM + 'px', '--col': String(col), '--n': String(n), ...(p ? { '--pc': p.color } : {}) },
      }, h('span', { class: 'ev-title' }, name), label, p && h('span', { class: 'pdot' }, p.name));
      // Both edges can be dragged: the top changes the start (the end stays), the bottom changes the end.
      const topH = h('div', { class: 'ev-resize ev-top', title: 'Drag to change the start', 'aria-hidden': 'true' });
      const botH = h('div', { class: 'ev-resize ev-bottom', title: 'Drag to change the end', 'aria-hidden': 'true' });
      if (end - start >= 30) el.append(topH);
      el.append(botH);
      withMenu(el, vault, t.id, rerender, { press: false });

      let s = start, e = end, suppress = false;
      const draw = () => {
        el.style.setProperty('--top', (s - base) * PXM + 'px');
        el.style.setProperty('--h', Math.max(SNAP, e - s) * PXM + 'px');
        label.textContent = `${fromMin(s)}–${endLabel(e)}`;
      };
      const save = () => {
        if (s !== start || e !== end) vault.update(t.id, { time: fromMin(s), dur: e - s });
        rerender();
      };
      const quiet = () => { suppress = true; setTimeout(() => { suppress = false; }, 350); };
      el.addEventListener('click', (ev) => { ev.stopPropagation(); if (suppress) return; openTask(vault, t.id, rerender); });
      el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); taskMenu(vault, t.id, el, rerender); });
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') return openTask(vault, t.id, rerender);
        if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
        ev.preventDefault();
        const d = ev.key === 'ArrowUp' ? -SNAP : SNAP;
        if (ev.shiftKey) e = Math.max(s + SNAP, Math.min(24 * 60, e + d));
        else { const len = e - s; s = Math.max(0, Math.min(24 * 60 - len, s + d)); e = s + len; }
        save();
        root.querySelector(`.dv-event[data-id="${t.id}"]`)?.focus();
      });

      // Resize from either edge: works the same with a mouse, a pen or a finger.
      for (const [handle, edge] of [[topH, 'top'], [botH, 'bottom']]) {
        handle.addEventListener('pointerdown', (ev) => {
          if (ev.pointerType === 'mouse' && ev.button !== 0) return;
          ev.preventDefault(); ev.stopPropagation();
          handle.setPointerCapture(ev.pointerId);
          el.classList.add('resizing');
          follow(ev, (y) => {
            const m = snapAt(y);
            if (edge === 'top') s = Math.max(base, Math.min(e - SNAP, m));
            else e = Math.max(s + SNAP, Math.min(24 * 60, m));
            draw();
          }, (cancelled) => {
            el.classList.remove('resizing'); quiet();
            if (cancelled) { s = start; e = end; draw(); } else save();
          });
        });
      }

      // While a finger holds the block: no page scrolling, and no tap afterwards (it would land on
      // whatever is under the finger by then, e.g. the menu's backdrop).
      let held = false, heldTimer = 0;
      el.addEventListener('touchmove', (te) => { if (held) te.preventDefault(); }, { passive: false });
      el.addEventListener('touchend', (te) => { if (held) te.preventDefault(); }, { passive: false });
      // Move: a mouse drags straight away; a finger presses and holds first (so the page still scrolls),
      // then drags. Holding and letting go without moving opens the task menu.
      el.addEventListener('pointerdown', (ev) => {
        if ((ev.pointerType === 'mouse' && ev.button !== 0) || ev.target.closest('.ev-resize, .more-btn')) return;
        const touch = ev.pointerType !== 'mouse';
        clearTimeout(heldTimer); held = false;
        const x0 = ev.clientX, y0 = ev.clientY;
        const grab = rawMinute(y0) - start;
        let lifted = false, moved = false, over = null;
        const len = end - start;
        const lift = () => { lifted = true; held = true; el.classList.add('moving'); if (touch) navigator.vibrate?.(10); };
        const timer = touch ? setTimeout(lift, 350) : null;
        follow(ev, (y, x) => {
          if (!lifted) {
            if (Math.hypot(x - x0, y - y0) < (touch ? 8 : 4)) return;
            if (touch) return 'cancel'; // moved before the hold: it's a scroll
            lift();
          }
          moved = true;
          const target = dropAt(x, y, el);
          if (target !== over) { over?.classList.remove('over'); over = target; over?.classList.add('over'); }
          s = Math.max(base, Math.min(24 * 60 - len, snapAt(y - grab * PXM))); e = s + len;
          draw();
        }, (cancelled) => {
          clearTimeout(timer);
          heldTimer = setTimeout(() => { held = false; }, 400); // touchend comes after pointerup
          over?.classList.remove('over');
          el.classList.remove('moving');
          if (!lifted) return;
          if (cancelled) { s = start; e = end; draw(); return; }
          quiet();
          if (!moved) { if (touch) taskMenu(vault, t.id, el, rerender); return; }
          if (over?._drop) { over._drop(t.id); return; }
          save();
        }, { canScroll: () => !over }); // hovering a drop target (e.g. the pinned week strip): hold still
      });
      return el;
    }

    /** Minute under a screen y, snapped to 15 minutes. */
    function snapAt(y) { return base + Math.round((y - grid.getBoundingClientRect().top) / PXM / SNAP) * SNAP; }
    function rawMinute(y) { return base + (y - grid.getBoundingClientRect().top) / PXM; }

    /**
     * Track one pointer until it lifts: onMove(y, x) on every move (return 'cancel' to let go),
     * scrolling the page when the pointer nears the top or bottom edge. onEnd(cancelled).
     */
    function follow(down, onMove, onEnd, { canScroll = () => true } = {}) {
      const id = down.pointerId;
      let x = down.clientX, y = down.clientY, raf = 0, done = false, armed = false;
      const sc = scroller(grid);
      // Near the top or bottom of the scroll area the page scrolls, faster the closer to the edge;
      // only once the pointer has really moved, so grabbing something near the edge doesn't run away.
      const tick = () => {
        raf = 0;
        const r = sc.getBoundingClientRect(), edge = 56;
        const depth = y < r.top + edge ? y - (r.top + edge) : y > r.bottom - edge ? y - (r.bottom - edge) : 0;
        if (!armed || !depth || !canScroll()) return;
        const before = sc.scrollTop;
        sc.scrollTop += Math.sign(depth) * Math.min(8, Math.ceil(Math.abs(depth) / 7));
        if (sc.scrollTop !== before && onMove(y, x) === 'cancel') return end(true);
        raf = requestAnimationFrame(tick);
      };
      const move = (ev) => {
        if (ev.pointerId !== id) return;
        x = ev.clientX; y = ev.clientY;
        if (Math.abs(y - down.clientY) > 16) armed = true;
        if (onMove(y, x) === 'cancel') end(true); else if (!raf) raf = requestAnimationFrame(tick);
      };
      const up = (ev) => { if (ev.pointerId === id) end(ev.type === 'pointercancel'); };
      const key = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(true); } };
      function end(cancelled) {
        if (done) return; done = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up); window.removeEventListener('keydown', key, true);
        onEnd(cancelled);
      }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up); window.addEventListener('keydown', key, true);
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
    if (long) withMenu(el, vault, t.id, rerender); else longPress(el, () => taskMenu(vault, t.id, el, rerender));
    el.addEventListener('click', (e) => { e.stopPropagation(); openTask(vault, t.id, rerender); });
    return el;
  }

  function addOn(date, time = null) {
    const t = vault.put({ type: 'task', title: '', status: 'todo', date, time, projectId: project || null, attachments: [] });
    openTask(vault, t.id, rerender, { isNew: true });
  }

  if (isPhone()) { root.append(phoneView()); return; }
  root.append(h('div', { class: `planner${sideHidden ? ' side-hidden' : ''}` }, side, h('main', { class: 'cal-wrap' }, nav, body)));

  /** Phones: Day (week strip + agenda + timeline) or Month (dots + the chosen day's list). No drag and drop. */
  function phoneView() {
    const dayMode = state.mode === 'day';
    const fmt = (d, o) => new Date(d + 'T00:00').toLocaleDateString([], o);
    const long = { weekday: 'long', day: 'numeric', month: 'long' };
    if (dayMode) setTitle('Planner', fmt(state.day, long));
    else setTitle(new Date(state.y, state.m, 1).toLocaleDateString([], { month: 'long' }), String(state.y));
    const jump = (n) => {
      if (dayMode) setDay(addDays(state.day, 7 * n));
      else { shift(n); state.day = today.startsWith(`${state.y}-${String(state.m + 1).padStart(2, '0')}`) ? today : isoDate(new Date(state.y, state.m, 1)); }
      rerender();
    };
    const segBtn = (m, label) => h('button', { class: state.mode === m ? 'on' : '', 'aria-pressed': String(state.mode === m), onclick: () => { state.mode = m; rerender(); } }, label);
    const bar = h('div', { class: 'm-bar' },
      h('div', { class: 'm-seg', role: 'group', 'aria-label': 'View' }, segBtn('day', 'Day'), segBtn('month', 'Month')),
      h('button', { class: 'icon-btn', 'aria-label': dayMode ? 'Previous week' : 'Previous month', onclick: () => jump(-1) }, icon('left')),
      h('button', { class: 'btn small', onclick: () => { setDay(today); rerender(); } }, 'Today'),
      h('button', { class: 'icon-btn', 'aria-label': dayMode ? 'Next week' : 'Next month', onclick: () => jump(1) }, icon('right')));

    const groups = [['unplanned', 'Unplanned'], ['doing', 'Doing'], ['backlog', 'Backlog'], ['done', 'Done']];
    const chips = h('div', { class: 'm-chips' }, groups.map(([k, label]) => h('button', { class: `m-chip st-${k}`, onclick: () => groupSheet(k, label) },
      label, h('b', {}, String(tasks.filter((t) => sectionOf(t) === k).length)))));

    const open = (list) => list.filter((t) => t.status !== 'done').length;
    const rows = (list, emptyText) => list.length ? list.map((t) => taskRow(vault, t, rerender)) : h('p', { class: 'muted small hempty' }, emptyText);
    if (dayMode) {
      const x = new Date(state.day + 'T00:00');
      const monday = addDays(state.day, -((x.getDay() + 6) % 7));
      const week = h('div', { class: 'm-week' }, [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const d = addDays(monday, i);
        const b = h('button', { class: `m-wd${d === state.day ? ' on' : ''}${d === today ? ' today' : ''}`, 'aria-pressed': String(d === state.day), 'aria-label': fmt(d, long), onclick: () => { setDay(d); rerender(); } },
          h('span', {}, fmt(d, { weekday: 'short' })), h('b', {}, String(Number(d.slice(8)))), h('i', { class: `dot${open(byDate.get(d) || []) ? '' : ' none'}` }));
        // Drop a timeline block here to move it to that day (same time).
        b.classList.add('droppable');
        b._drop = (id) => { const x = vault.get(id); if (!x) return; vault.update(id, { date: d, status: x.status === 'backlog' ? 'todo' : x.status }); toast(`Moved to ${fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })}`, 'ok', 2000); rerender(); };
        return b;
      }));
      swipe(week, jump);
      const list = byDate.get(state.day) || [];
      const done = list.filter((t) => t.status === 'done').length;
      const any = h('section', { class: 'hcard m-card' },
        h('div', { class: 'hcard-h' }, h('h2', {}, 'Any time'), list.length > 0 && h('span', { class: 'muted small' }, `${done} of ${list.length} done`)),
        rows(list.filter((t) => !t.time), list.length ? 'Everything on this day has a time.' : 'Nothing planned. Tap + to add a task.'));
      // Drop a timeline block here to take its time off.
      dropTarget(any, (id) => { if (vault.get(id)) { vault.update(id, { time: null }); rerender(); } });
      return h('div', { class: 'mplanner' }, bar, week, chips, any, timeline(list),
        h('p', { class: 'muted small m-hint' }, 'Press and hold a block, then drag to move it (onto another day above, too). Drag its top or bottom edge to change the start or end.'));
    }
    const grid = h('div', { class: 'm-month' }, ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w) => h('div', { class: 'm-wh', 'aria-hidden': 'true' }, w)),
      monthGrid(state.y, state.m).map((d) => {
        const l = byDate.get(d.date) || [];
        return h('button', { class: `m-day${d.inMonth ? '' : ' out'}${d.date === today ? ' today' : ''}${d.date === state.day ? ' on' : ''}`,
          'aria-pressed': String(d.date === state.day), 'aria-label': `${fmt(d.date, long)}: ${l.length} task${l.length === 1 ? '' : 's'}`, onclick: () => { setDay(d.date); rerender(); } },
        String(d.day), h('i', { 'aria-hidden': 'true' }, Array.from({ length: Math.min(3, open(l)) }, () => h('s'))));
      }));
    swipe(grid, jump);
    const sel = byDate.get(state.day) || [];
    const dayCard = h('section', { class: 'hcard m-card' },
      h('div', { class: 'hcard-h' }, h('h2', {}, fmt(state.day, long)), h('button', { class: 'link small', onclick: () => { state.mode = 'day'; rerender(); } }, 'Open day ›')),
      rows(sel, 'Nothing planned. Tap + to add a task.'));
    return h('div', { class: 'mplanner' }, bar, chips, grid, dayCard);
  }

  /** The Unplanned / Doing / Backlog / Done lists, as a sheet. */
  function groupSheet(key, label) {
    const list = h('div', { class: 'm-list' });
    const dlg = bottomSheet(label, list);
    const draw = () => {
      const items = liveItems(vault.doc, 'task').filter((t) => (!project || t.projectId === project) && sectionOf(t) === key)
        .sort(key === 'done' ? (a, b) => b.updatedAt - a.updatedAt : sortTasks);
      dlg.querySelector('header h2').textContent = `${label} · ${items.length}`;
      clear(list).append(...(items.length ? items.slice(0, 300).map((t) => taskRow(vault, t, () => { draw(); rerender(); }, { showDate: true }))
        : [h('p', { class: 'muted small hempty' }, 'Nothing here.')]));
    };
    draw();
  }
}

/** Horizontal swipe (touch or mouse): fn(1) for left, fn(-1) for right. */
function swipe(el, fn) {
  let x0 = null, y0 = 0;
  el.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; });
  el.addEventListener('pointerup', (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 40) { el.addEventListener('click', (c) => { c.stopPropagation(); c.preventDefault(); }, { capture: true, once: true }); fn(dx < 0 ? 1 : -1); }
  });
  el.addEventListener('pointercancel', () => { x0 = null; });
}

/** Position the current-time line and its label (called on render and every minute). */
function placeNow(el) {
  const d = new Date(), m = d.getHours() * 60 + d.getMinutes();
  const base = Number(el.dataset.base), pxm = Number(el.dataset.pxm);
  el.hidden = m < base;
  el.style.setProperty('--top', (m - base) * pxm + 'px');
  const label = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  el.firstChild.textContent = label;
  el.setAttribute('aria-label', `Now, ${label}`);
}
if (typeof window !== 'undefined') {
  setInterval(() => {
    for (const el of document.querySelectorAll('.dv-now')) {
      // Past midnight the line belongs to yesterday's view: redraw the planner instead.
      if (el.closest('.dv-grid') && el.dataset.day && el.dataset.day !== isoDate(new Date())) el.remove();
      else placeNow(el);
    }
  }, 30_000);
}

/** The day the planner is showing (new tasks from the + button go there). */
export function plannerDay() { return state.day; }

// ---- time ranges: a task with a time runs for `dur` minutes (default 60) ----
// Phones get taller hours so 15-minute steps are easy to hit with a finger.
let HOUR_PX = 48, PXM = HOUR_PX / 60;
const SNAP = 15;
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
/** The drop target (sidebar section, "Any time", a day in the week strip…) under a point, ignoring `self`. */
function dropAt(x, y, self) {
  for (const n of document.elementsFromPoint(x, y)) {
    if (self.contains(n)) continue;
    const d = n.closest?.('.droppable');
    if (d) return d;
    if (n.closest?.('.dv-grid')) return null; // over the timeline itself: just move in time
  }
  return null;
}
function scroller(el) {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement;
}
function dropTarget(el, onDrop) {
  el.classList.add('droppable');
  el._drop = onDrop;
  el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-planner-task')) { e.preventDefault(); el.classList.add('over'); } });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('over'); });
  el.addEventListener('drop', (e) => {
    el.classList.remove('over');
    const id = e.dataTransfer.getData('text/x-planner-task');
    if (id) { e.preventDefault(); e.stopPropagation(); onDrop(id); }
  });
}

/** Adds a ⋯ button (always visible on touch screens) plus long-press / right-click, opening taskMenu. */
export function withMenu(el, vault, id, after, { press = true } = {}) {
  const b = h('span', { class: 'more-btn', role: 'button', tabindex: '0', title: 'More actions', 'aria-label': 'More actions', 'aria-haspopup': 'menu' }, icon('more'));
  const open = (e) => { e.stopPropagation(); e.preventDefault(); taskMenu(vault, id, b, after); };
  b.addEventListener('click', open);
  b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.append(b);
  if (press) longPress(el, () => taskMenu(vault, id, el, after));
  return el;
}

/**
 * Quick actions for a task without drag and drop (phones): plan today / tomorrow,
 * pick a date, change status, mark done, delete.
 */
export function taskMenu(vault, id, anchor, after) {
  const t = vault.get(id);
  if (!t) return;
  const today = isoDate(new Date());
  const active = t.status === 'backlog' || t.status === 'done' ? 'todo' : t.status;
  const set = (patch, msg) => { vault.update(id, patch); if (msg) toast(msg, 'ok', 2000); after?.(); };
  const isDone = t.status === 'done';
  actionSheet(t.title || 'Untitled', [
    { icon: 'check', label: isDone ? 'Mark not done' : 'Mark done', cls: 'tm-done', onClick: () => set({ status: isDone ? 'todo' : 'done' }, isDone ? '' : 'Done ✓') },
    'sep',
    t.date !== today && { icon: 'calendar', label: 'Today', onClick: () => set({ date: today, status: active }, 'Planned for today') },
    { icon: 'right', label: 'Tomorrow', onClick: () => set({ date: addDays(today, 1), status: active }, 'Planned for tomorrow') },
    { icon: 'clock', label: 'Pick date & time…', onClick: () => openTask(vault, id, after) },
    t.date && { icon: 'undo', label: 'Unschedule', onClick: () => set({ date: null, time: null }) },
    'sep',
    t.status !== 'doing' && { icon: 'play', label: 'Doing', onClick: () => set({ status: 'doing' }) },
    t.status !== 'todo' && { icon: 'note', label: 'To do', onClick: () => set({ status: 'todo' }) },
    t.status !== 'backlog' && { icon: 'box', label: 'Backlog', onClick: () => set({ status: 'backlog' }) },
    'sep',
    { icon: 'trash', label: 'Delete', cls: 'danger', onClick: async () => {
      if (await confirmDialog(`Delete "${t.title || 'Untitled'}"?`, { ok: 'Delete', danger: true })) { vault.remove(id); after?.(); }
    } },
  ], anchor);
}

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
  const doneBtn = h('button', { class: 'btn small mark-done' });
  const drawDone = () => {
    const d = vault.get(id)?.status === 'done';
    clear(doneBtn).append(icon(d ? 'undo' : 'check'), d ? 'Undo done' : 'Mark done');
    doneBtn.classList.toggle('is-done', d);
    doneBtn.title = d ? 'Set back to To do' : 'Mark this to-do done and close';
  };
  doneBtn.addEventListener('click', () => {
    const d = vault.get(id)?.status === 'done';
    save({ status: d ? 'todo' : 'done' });
    statusSel.value = d ? 'todo' : 'done';
    recolor(); drawDone();
    if (!d) { toast('Done ✓', 'ok', 2000); dlg.close(); }
  });
  const statusSel = h('select', { 'aria-label': 'Status', onchange: (e) => { save({ status: e.target.value }); recolor(); drawDone(); } },
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
      doneBtn,
      h('button', { class: 'icon-btn', title: 'Save and close', 'aria-label': 'Save and close', onclick: () => dlg.close() }, icon('close'))),
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
  dlg.addEventListener('flush', () => editor.flush());
  dlg.addEventListener('close', () => {
    editor.flush();
    dlg.remove();
    const cur = vault.get(id);
    if (cur && !(cur.title || '').trim() && !htmlToText(cur.html) && !(cur.attachments || []).length) vault.remove(id);
    after?.();
  });
  drawDone();
  document.body.append(dlg);
  dlg.showModal();
  (isNew ? titleIn : editor.body).focus();
}
