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
};

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
