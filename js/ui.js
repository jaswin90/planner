// DOM helpers. Text always goes in through textContent; the only HTML we
// ever insert is the output of sanitizeHtml().

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'vars') for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/**
 * Redraw `root` without losing where the person had scrolled to: the page itself and any inner
 * scrolling panes named in `panes` (CSS selectors), which are found again after the redraw.
 */
export function keepScroll(root, panes, draw) {
  const before = [root.scrollTop, ...panes.map((q) => root.querySelector(q)?.scrollTop || 0)];
  draw();
  root.scrollTop = before[0];
  panes.forEach((q, i) => { const el = root.querySelector(q); if (el) el.scrollTop = before[i + 1]; });
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

export function icon(name) {
  // Icons are tiny inline SVG built with DOM APIs (no innerHTML).
  const paths = ICONS[name] || ICONS.dot;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

const ICONS = {
  dot: ['M12 12h.01'],
  home: ['M4 11l8-7 8 7', 'M6 10v10h12V10', 'M10 20v-6h4v6'],
  folder: ['M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'],
  calendar: ['M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
  note: ['M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M14 3v5h5M8 13h8M8 17h5'],
  gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  logout: ['M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4', 'M10 17l-5-5 5-5', 'M5 12h11'],
  plus: ['M12 5v14M5 12h14'],
  left: ['M15 18l-6-6 6-6'],
  right: ['M9 18l6-6-6-6'],
  trash: ['M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'],
  clip: ['M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15 9h.01'],
  pin: ['M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v7'],
  sync: ['M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4'],
  close: ['M6 6l12 12M18 6L6 18'],
  download: ['M12 4v11M7 10l5 5 5-5M5 20h14'],
  open: ['M14 4h6v6M20 4l-9 9M18 14v5H5V6h5'],
  check: ['M5 12l5 5 9-10'],
  file: ['M6 3h9l4 4v13H6z', 'M14 3v5h5'],
  mic: ['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M5 11a7 7 0 0 0 14 0M12 18v3'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  collapse: ['M11 17l-5-5 5-5M18 17l-5-5 5-5'],
  expand: ['M13 17l5-5-5-5M6 17l5-5-5-5'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  play: ['M8 5v14l11-7z'],
  box: ['M4 7h16v4H4zM5 11v9h14v-9M10 15h4'],
  undo: ['M9 14L4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0'],
};

/** Phones: a small screen, so the app uses its phone layout (bottom tabs, agenda planner). */
export const isPhone = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 760px)').matches;

/** Phone header title (desktop ignores it). */
export function setTitle(title, sub = '') {
  const t = document.querySelector('.ph-title h1'), s = document.querySelector('.ph-title .ph-sub');
  if (t) t.textContent = title;
  if (s) s.textContent = sub;
}

/**
 * A menu of actions: next to `anchor` on desktop, a sheet from the bottom on phones.
 * items: { icon, label, onClick, cls } | 'sep' | falsy (skipped). Returns close().
 */
export function actionSheet(title, items, anchor) {
  document.querySelector('.tmenu-wrap')?.remove();
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); anchor?.focus?.(); };
  const menu = h('div', { class: 'tmenu', role: 'menu', 'aria-label': title },
    title && h('div', { class: 'tm-title' }, title),
    items.filter(Boolean).map((it) => it === 'sep' ? h('div', { class: 'tm-sep' })
      : h('button', { class: `tm-it${it.cls ? ' ' + it.cls : ''}`, role: 'menuitem', onclick: () => { close(); it.onClick(); } }, icon(it.icon), h('span', {}, it.label))));
  const wrap = h('div', { class: 'tmenu-wrap' }, h('div', { class: 'tmenu-back', onclick: close }), menu);
  const onKey = (e) => {
    const list = [...menu.querySelectorAll('.tm-it')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Tab') e.preventDefault();
  };
  document.addEventListener('keydown', onKey, true);
  (document.querySelector('dialog[open]') || document.body).append(wrap);
  if (anchor && !isPhone()) {
    const r = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
    menu.style.setProperty('--x', Math.max(8, Math.min(innerWidth - m.width - 8, r.right - m.width)) + 'px');
    menu.style.setProperty('--y', (r.bottom + 4 + m.height > innerHeight - 8 ? Math.max(8, r.top - m.height - 4) : r.bottom + 4) + 'px');
    menu.classList.add('at');
  }
  menu.querySelector('.tm-it')?.focus();
  return close;
}

/** A bottom sheet on phones (a centred dialog on desktop). Returns the <dialog>. */
export function bottomSheet(title, body, { onClose } = {}) {
  const dlg = h('dialog', { class: 'bsheet', 'aria-label': title },
    h('div', { class: 'grab', 'aria-hidden': 'true' }),
    h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))),
    h('div', { class: 'bsheet-body' }, body));
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/**
 * Long-press (touch) or right-click (mouse) opens a menu. A click that ends a
 * long-press is swallowed so it doesn't also open the item.
 */
export function longPress(el, fn) {
  let timer, x = 0, y = 0, fired = false;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', (e) => {
    fired = false;
    if (e.pointerType === 'mouse') return;
    x = e.clientX; y = e.clientY; cancel();
    timer = setTimeout(() => { fired = true; navigator.vibrate?.(10); fn(); }, 500);
  });
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - x, e.clientY - y) > 8) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); if (!fired) { fired = true; fn(); } });
  el.addEventListener('click', (e) => { if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}

let toastBox;
export function toast(msg, kind = 'info', ms = 3500) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastBox.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Modal dialog. Returns { dialog, close }. */
export function modal(title, body, { wide = false, onClose } = {}) {
  const dlg = h('dialog', { class: `modal${wide ? ' wide' : ''}` },
    h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))),
    h('div', { class: 'modal-body' }, body));
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { dialog: dlg, close: () => dlg.close() };
}

export function confirmDialog(message, { ok = 'OK', danger = false, typeToConfirm } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = typeToConfirm ? h('input', { type: 'text', autocomplete: 'off', placeholder: typeToConfirm }) : null;
    const okBtn = h('button', { class: danger ? 'btn danger' : 'btn primary', onclick: () => {
      if (input && input.value !== typeToConfirm) { input.focus(); return; }
      done = true; resolve(true); m.close();
    } }, ok);
    const m = modal('Please confirm', [
      h('p', {}, message),
      input && h('label', {}, `Type ${typeToConfirm} to continue`, input),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'), okBtn),
    ], { onClose: () => { if (!done) resolve(false); } });
  });
}

export function promptDialog(title, { label = '', value = '', type = 'text', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { type, value, placeholder, autocomplete: 'off' });
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); done = true; resolve(input.value); m.close(); } },
      h('label', {}, label, input),
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn', onclick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary' }, 'OK')));
    const m = modal(title, form, { onClose: () => { if (!done) resolve(null); } });
    input.focus();
  });
}

export function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtWhen(ms) {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function debounce(fn, ms) {
  let t, last = null;
  const d = (...a) => { last = a; clearTimeout(t); t = setTimeout(() => { const x = last; last = null; fn(...x); }, ms); };
  d.flush = () => { clearTimeout(t); if (last) { const x = last; last = null; fn(...x); } };
  return d;
}

export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, class: 'hidden' });
    inp.addEventListener('change', () => { resolve(Array.from(inp.files || [])); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
