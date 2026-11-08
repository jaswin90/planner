// Rich text editor (Evernote-style fixed toolbar): text formatting, lists,
// checklists, tables, equations, callouts, inline photos, voice notes and
// file cards (PDF preview inline). Every attachment is encrypted by the
// vault before it is stored anywhere.

import { h, icon, toast, pickFiles, fmtSize, modal, promptDialog, confirmDialog, debounce } from './ui.js';
import { sanitizeHtml, sanitizeToFragment } from './sanitize.js';
import { renderTex, loadKatex } from './math.js';
import { recordVoice } from './recorder.js';
import { CONFIG } from './config.js';

const IMG_TYPES = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;

export function createEditor({ vault, html = '', ownerId, onChange, onAttachmentsChange, placeholder = 'Start writing…', compact = false }) {
  const body = h('div', { class: 'rte', contenteditable: 'true', spellcheck: 'true', 'data-placeholder': placeholder, role: 'textbox', 'aria-multiline': 'true' });
  body.append(sanitizeToFragment(html));
  const changed = debounce(() => onChange?.(getHtml()), 400);
  let savedRange = null;

  // ---------- toolbar ----------
  const blockSel = h('select', { class: 'tb-select', 'aria-label': 'Text style' },
    [['p', 'Normal text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['blockquote', 'Quote'], ['pre', 'Code block']].map(([v, l]) => h('option', { value: v }, l)));
  blockSel.addEventListener('mousedown', () => { savedRange = saveSel(); });
  blockSel.addEventListener('change', () => { restoreSel(savedRange); document.execCommand('formatBlock', false, blockSel.value.toUpperCase()); changed(); });

  const btn = (cmd, label, title, cls = '') => {
    const b = h('button', { type: 'button', class: `tb ${cls}`, title, 'aria-label': title, dataset: { cmd } }, label);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the caret where it is
    b.addEventListener('click', () => run(cmd));
    return b;
  };
  const sep = () => h('span', { class: 'sep' });
  const bar = h('div', { class: `rte-bar${compact ? ' compact' : ''}`, role: 'toolbar' },
    blockSel, sep(),
    btn('bold', h('b', {}, 'B'), 'Bold (Ctrl+B)'), btn('italic', h('i', {}, 'I'), 'Italic (Ctrl+I)'), btn('underline', h('u', {}, 'U'), 'Underline (Ctrl+U)'),
    btn('strikeThrough', h('s', {}, 'S'), 'Strikethrough'), btn('mark', h('span', { class: 'hl-swatch' }, 'A'), 'Highlight'), sep(),
    btn('insertUnorderedList', '•≡', 'Bulleted list'), btn('insertOrderedList', '1.≡', 'Numbered list'), btn('checklist', '☑', 'Checklist'), btn('link', icon('link'), 'Link'), sep(),
    btn('table', ['⊞', h('span', { class: 'tb-l' }, 'Table')], 'Insert table', 'hl'),
    btn('equation', ['∑', h('span', { class: 'tb-l' }, 'Equation')], 'Insert equation', 'hl'),
    btn('image', [icon('image'), h('span', { class: 'tb-l' }, 'Photo')], 'Insert photo', 'hl'),
    btn('record', [icon('mic'), h('span', { class: 'tb-l' }, 'Record')], 'Record a voice note', 'hl'),
    btn('attach', [icon('clip'), h('span', { class: 'tb-l' }, 'Attach')], 'Attach PDF or any file', 'hl'),
    btn('callout', ['💡', h('span', { class: 'tb-l' }, 'Callout')], 'Insert callout box', 'hl'), sep(),
    btn('removeFormat', 'Tx', 'Clear formatting'));

  // Extra bar shown while the caret is inside a table.
  const tableBar = h('div', { class: 'table-bar hidden' }, h('span', { class: 'muted small' }, 'Table:'),
    ...[['row-below', '+ Row'], ['col-right', '+ Column'], ['row-del', '− Row'], ['col-del', '− Column'], ['table-del', 'Delete table']].map(([a, l]) => {
      const b = h('button', { type: 'button', class: `btn small${a === 'table-del' ? ' danger' : ''}` }, l);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => tableAction(a));
      return b;
    }));

  async function run(cmd) {
    body.focus();
    switch (cmd) {
      case 'checklist': toggleChecklist(); break;
      case 'mark': toggleMark(); break;
      case 'link': await addLink(); break;
      case 'table': insertTable(); break;
      case 'equation': await editEquation(null); break;
      case 'callout': insertBlock(h('div', { class: 'callout' }, '💡\u00a0')); break;
      case 'image': { const r = saveSel(); const files = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif' }); restoreSel(r); await insertFiles(files); break; }
      case 'attach': { const r = saveSel(); const files = await pickFiles({}); restoreSel(r); await insertFiles(files); break; }
      case 'record': { const r = saveSel(); const f = await recordVoice(); restoreSel(r); if (f) await insertFiles([f]); break; }
      default: document.execCommand(cmd, false, null);
    }
    changed();
  }

  // ---------- selection helpers ----------
  function saveSel() {
    const s = window.getSelection();
    return s.rangeCount && body.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null;
  }
  function restoreSel(r) {
    body.focus();
    const s = window.getSelection();
    s.removeAllRanges();
    if (r) s.addRange(r);
    else { const rr = document.createRange(); rr.selectNodeContents(body); rr.collapse(false); s.addRange(rr); }
  }
  function caretEl() {
    const s = window.getSelection();
    if (!s.rangeCount || !body.contains(s.anchorNode)) return null;
    return s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
  }
  function insertNode(node) {
    const s = window.getSelection();
    let r = s.rangeCount && body.contains(s.anchorNode) ? s.getRangeAt(0) : null;
    if (!r) { r = document.createRange(); r.selectNodeContents(body); r.collapse(false); }
    r.deleteContents();
    r.insertNode(node);
    r.setStartAfter(node); r.collapse(true);
    s.removeAllRanges(); s.addRange(r);
  }
  /** Insert a block element on its own line, with an empty paragraph after it to keep typing. */
  function insertBlock(el) {
    const cur = caretEl();
    let top = cur;
    while (top && top.parentElement !== body) top = top.parentElement;
    const after = h('p', {}, h('br'));
    if (top && top !== body) {
      const empty = !top.textContent.trim() && !top.querySelector('img,.voice,.filecard,.eq-block,table');
      if (empty && top.nodeName === 'P') top.replaceWith(el, after);
      else top.after(el, after);
    } else {
      body.append(el, after);
    }
    const r = document.createRange();
    if (el.classList.contains('callout')) { r.selectNodeContents(el); r.collapse(false); } else { r.setStart(after, 0); r.collapse(true); }
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    hydrate();
  }

  // ---------- formatting ----------
  function toggleChecklist() {
    document.execCommand('insertUnorderedList', false, null);
    const ul = caretEl()?.closest('ul');
    if (ul && body.contains(ul)) {
      ul.classList.add('checklist');
      for (const li of ul.children) if (!li.dataset.checked) li.dataset.checked = 'false';
    }
  }
  function toggleMark() {
    const s = window.getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    const r = s.getRangeAt(0);
    const anc = (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentNode).closest('mark');
    if (anc && body.contains(anc)) { anc.replaceWith(...anc.childNodes); return; }
    const m = document.createElement('mark');
    m.append(r.extractContents());
    r.insertNode(m);
    s.removeAllRanges();
    const nr = document.createRange(); nr.selectNodeContents(m); s.addRange(nr);
  }
  async function addLink() {
    const r = saveSel();
    const url = await promptDialog('Add link', { label: 'Web address', placeholder: 'https://…', type: 'url' });
    restoreSel(r);
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) { toast('Links must start with https://, http:// or mailto:', 'error'); return; }
    if (window.getSelection().isCollapsed) document.execCommand('insertText', false, url.trim());
    document.execCommand('createLink', false, url.trim());
  }

  // ---------- tables ----------
  function insertTable() {
    const cell = (tag) => h(tag, {}, h('br'));
    const t = h('table', {}, h('tbody', {},
      h('tr', {}, cell('th'), cell('th'), cell('th')),
      h('tr', {}, cell('td'), cell('td'), cell('td')),
      h('tr', {}, cell('td'), cell('td'), cell('td'))));
    insertBlock(t);
    const first = t.querySelector('th');
    const r = document.createRange(); r.setStart(first, 0); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    updateTableBar();
  }
  function tableAction(a) {
    const cellEl = caretEl()?.closest('td,th');
    const table = cellEl?.closest('table');
    if (!table || !body.contains(table)) return;
    const row = cellEl.parentElement;
    const idx = Array.from(row.children).indexOf(cellEl);
    const rows = Array.from(table.querySelectorAll('tr'));
    if (a === 'row-below') {
      const nr = h('tr', {}, Array.from(row.children).map(() => h('td', {}, h('br'))));
      row.after(nr);
    } else if (a === 'col-right') {
      for (const r of rows) { const c = r.children[idx]; const tag = c?.nodeName === 'TH' ? 'th' : 'td'; (c || r.lastElementChild).after(h(tag, {}, h('br'))); }
    } else if (a === 'row-del') {
      if (rows.length > 1) row.remove(); else table.remove();
    } else if (a === 'col-del') {
      if (row.children.length > 1) for (const r of rows) r.children[idx]?.remove(); else table.remove();
    } else if (a === 'table-del') {
      table.remove();
    }
    updateTableBar();
    changed();
  }
  function updateTableBar() {
    const inTable = !!caretEl()?.closest('table');
    tableBar.classList.toggle('hidden', !inTable);
  }

  // ---------- equations ----------
  async function editEquation(existing) {
    const r = saveSel();
    const tex = existing?.dataset.tex || '';
    const input = h('textarea', { class: 'tex-in', rows: 3, spellcheck: 'false', placeholder: 'e.g. \\frac{a}{b}, x^2 + y^2 = r^2, \\int_0^1 f(x)\\,dx' }, tex);
    input.value = tex;
    const preview = h('div', { class: 'eq-preview' });
    const block = h('input', { type: 'checkbox', checked: existing ? existing.classList.contains('eq-block') : true });
    const draw = debounce(() => input.value.trim() ? renderTex(preview, input.value, block.checked) : (preview.textContent = 'Preview appears here'), 150);
    input.addEventListener('input', draw); block.addEventListener('change', draw);
    loadKatex().catch(() => {});
    let done = false;
    const examples = [['Fraction', '\\frac{a}{b}'], ['Power', 'x^{2}'], ['Root', '\\sqrt{x}'], ['Sum', '\\sum_{i=1}^{n} x_i'], ['Integral', '\\int_{a}^{b} f(x)\\,dx'], ['Greek', '\\alpha \\beta \\pi'], ['Matrix', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}']];
    const m = modal(existing ? 'Edit equation' : 'Insert equation', h('div', { class: 'stack' },
      h('label', {}, 'Equation (LaTeX)', input),
      h('div', { class: 'row wrap' }, h('span', { class: 'muted small' }, 'Quick insert:'), examples.map(([l, t]) => h('button', { type: 'button', class: 'btn small', onclick: () => { input.setRangeText(t, input.selectionStart, input.selectionEnd, 'end'); input.focus(); draw(); } }, l))),
      preview,
      h('label', { class: 'check' }, block, 'Show on its own line'),
      h('div', { class: 'row' },
        existing && h('button', { class: 'btn danger', onclick: () => { existing.remove(); done = true; m.close(); changed(); } }, icon('trash'), 'Remove'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => {
          const t = input.value.trim();
          if (!t) return input.focus();
          if (t.length > 2000) return toast('That equation is too long.', 'error');
          done = true; m.close();
          const el = block.checked ? h('div', { class: 'eq-block', contenteditable: 'false', 'data-tex': t }) : h('span', { class: 'eq', contenteditable: 'false', 'data-tex': t });
          if (existing) { existing.replaceWith(el); hydrate(); } else { restoreSel(r); if (block.checked) insertBlock(el); else { insertNode(el); insertNode(document.createTextNode(' ')); hydrate(); } }
          changed();
        } }, existing ? 'Save' : 'Insert'))), { wide: true, onClose: () => { if (!done) restoreSel(r); } });
    draw();
    input.focus();
  }

  // ---------- attachments ----------
  async function insertFiles(files) {
    for (const f of files) {
      try {
        const id = await vault.addAttachment(f, ownerId, CONFIG.maxAttachmentMB);
        if (IMG_TYPES.test(f.type)) insertBlock(h('img', { 'data-att': id, alt: f.name }));
        else if (/^audio\//.test(f.type)) insertBlock(h('div', { class: 'voice', contenteditable: 'false', 'data-att': id }));
        else insertBlock(h('div', { class: 'filecard', contenteditable: 'false', 'data-att': id }));
        onAttachmentsChange?.(id);
      } catch (e) { toast(e.message, 'error'); }
    }
    hydrate();
    changed();
  }

  /** Draw everything that is not stored as text: photos, equations, players, cards. */
  function hydrate() {
    for (const img of body.querySelectorAll('img[data-att]')) {
      if (img.src) continue;
      vault.attachmentUrl(img.dataset.att).then((u) => { img.src = u; }).catch(() => { img.classList.add('broken'); img.alt = 'Photo not available yet'; });
    }
    for (const el of body.querySelectorAll('.eq-block[data-tex], span.eq[data-tex]')) {
      if (el.dataset.drawn === el.dataset.tex) continue;
      el.dataset.drawn = el.dataset.tex;
      renderTex(el, el.dataset.tex, el.classList.contains('eq-block'));
    }
    for (const el of body.querySelectorAll('.voice[data-att]')) {
      if (el.dataset.drawn) continue;
      el.dataset.drawn = '1';
      const meta = vault.get(el.dataset.att);
      const audio = h('audio', { controls: true, preload: 'metadata' });
      el.append(h('span', { class: 'voice-ic' }, icon('mic')), audio,
        h('span', { class: 'voice-name' }, meta ? meta.name.replace(/\.[a-z0-9]+$/i, '') : 'Voice note missing'));
      vault.attachmentUrl(el.dataset.att).then((u) => { audio.src = u; }).catch(() => el.classList.add('broken'));
    }
    for (const el of body.querySelectorAll('.filecard[data-att]')) {
      if (el.dataset.drawn) continue;
      el.dataset.drawn = '1';
      drawFileCard(el);
    }
    for (const c of body.querySelectorAll('span.att-chip[data-att]')) {
      const meta = vault.get(c.dataset.att);
      c.textContent = '';
      c.append(icon('clip'), meta ? `${meta.name} · ${fmtSize(meta.size)}` : 'missing file');
    }
  }

  function drawFileCard(el) {
    const id = el.dataset.att;
    const meta = vault.get(id);
    if (!meta) { el.append(h('div', { class: 'fc-main' }, h('span', { class: 'fc-ic' }, icon('file')), h('span', { class: 'muted' }, 'File was deleted'))); return; }
    const isPdf = meta.mime === 'application/pdf';
    const frameBox = h('div', { class: 'fc-preview hidden' });
    const act = (label, fn, ic) => { const b = h('button', { type: 'button', class: 'btn small' }, ic && icon(ic), label); b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); }); return b; };
    el.append(
      h('div', { class: 'fc-main' },
        h('span', { class: `fc-ic${isPdf ? ' pdf' : ''}` }, isPdf ? 'PDF' : (meta.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()),
        h('div', { class: 'fc-text' }, h('b', {}, meta.name), h('span', { class: 'muted small' }, `${isPdf ? 'PDF document' : meta.mime} · ${fmtSize(meta.size)}`)),
        h('div', { class: 'fc-actions' },
          isPdf && act('Preview', async (b) => {
            if (!frameBox.classList.contains('hidden')) { frameBox.classList.add('hidden'); frameBox.textContent = ''; b.lastChild.textContent = 'Preview'; return; }
            try { const u = await vault.attachmentUrl(id); frameBox.append(h('iframe', { src: u, title: meta.name })); frameBox.classList.remove('hidden'); b.lastChild.textContent = 'Hide preview'; } catch (e) { toast(e.message, 'error'); }
          }, 'open'),
          act('Open', () => openAttachment(vault, id)),
          act('Download', () => downloadAttachment(vault, id), 'download'))),
      frameBox);
  }

  function getHtml() {
    const clone = body.cloneNode(true);
    for (const img of clone.querySelectorAll('img')) img.removeAttribute('src');
    for (const el of clone.querySelectorAll('.eq-block, span.eq, .voice, .filecard')) { el.textContent = ''; delete el.dataset.drawn; }
    return sanitizeHtml(clone.innerHTML);
  }

  // ---------- events ----------
  body.addEventListener('input', () => changed());
  body.addEventListener('blur', () => changed.flush());
  for (const ev of ['keyup', 'mouseup', 'focus']) body.addEventListener(ev, updateTableBar);
  body.addEventListener('paste', async (e) => {
    const cd = e.clipboardData;
    const files = Array.from(cd?.files || []);
    e.preventDefault();
    if (files.length) { await insertFiles(files); return; }
    const html = cd.getData('text/html');
    if (html) document.execCommand('insertHTML', false, sanitizeHtml(html).replace(/<img[^>]*>/g, '').replace(/<(div|span)[^>]*class="(eq-block|eq|voice|filecard)"[^>]*><\/\1>/g, ''));
    else document.execCommand('insertText', false, cd.getData('text/plain'));
    hydrate();
    changed();
  });
  body.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); body.classList.add('drop'); } });
  body.addEventListener('dragleave', () => body.classList.remove('drop'));
  body.addEventListener('drop', async (e) => {
    body.classList.remove('drop');
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    e.preventDefault();
    const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (pos) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(pos); }
    await insertFiles(files);
  });
  body.addEventListener('click', (e) => {
    const li = e.target.closest('ul.checklist > li');
    if (li && body.contains(li)) {
      const rect = li.getBoundingClientRect();
      if (e.clientX - rect.left < 26) { li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true'; changed(); e.preventDefault(); }
    }
    const eq = e.target.closest('.eq-block, span.eq');
    if (eq && body.contains(eq)) { editEquation(eq); return; }
    const c = e.target.closest('span.att-chip[data-att]');
    if (c) openAttachment(vault, c.dataset.att);
    const img = e.target.closest('img[data-att]');
    if (img) imageMenu(img);
    const a = e.target.closest('a[href]');
    if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank', 'noopener,noreferrer');
  });
  body.addEventListener('keydown', (e) => {
    const cell = caretEl()?.closest('td,th');
    if (e.key === 'Tab' && cell) {
      e.preventDefault();
      const cells = Array.from(cell.closest('table').querySelectorAll('td,th'));
      let next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
      if (!next && !e.shiftKey) { tableAction('row-below'); next = cell.closest('tr').nextElementSibling?.firstElementChild; }
      if (next) { const r = document.createRange(); r.selectNodeContents(next); r.collapse(false); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      return;
    }
    if (e.key === 'Enter') setTimeout(() => {
      const li = caretEl()?.closest('ul.checklist > li');
      if (li && !li.dataset.checked) li.dataset.checked = 'false';
    });
  });

  function imageMenu(img) {
    const sizes = ['25', '50', '75', '100'];
    const m = modal('Photo', h('div', { class: 'stack' },
      h('img', { class: 'preview', src: img.src, alt: img.alt || '' }),
      h('div', { class: 'row wrap' },
        h('span', {}, 'Size:'),
        sizes.map((s) => h('button', { class: `btn${(img.dataset.w || '100') === s ? ' primary' : ''}`, onclick: () => { img.dataset.w = s; changed(); m.close(); } }, `${s}%`)),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: () => downloadAttachment(vault, img.dataset.att) }, icon('download'), 'Download'),
        h('button', { class: 'btn danger', onclick: () => { img.remove(); changed(); m.close(); } }, icon('trash'), 'Remove from note'),
      )), { wide: true });
  }

  hydrate();
  const el = h('div', { class: 'rte-wrap' }, bar, tableBar, body);
  return {
    el, bar, body, getHtml, hydrate, flush: () => changed.flush(), focus: () => body.focus(),
    addFiles: insertFiles,
    setHtml(next) { body.textContent = ''; body.append(sanitizeToFragment(next)); hydrate(); },
  };
}

export async function openAttachment(vault, id) {
  const meta = vault.get(id);
  if (!meta) return toast('That file was deleted.', 'error');
  try {
    const url = await vault.attachmentUrl(id);
    const dl = h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => downloadAttachment(vault, id) }, icon('download'), 'Download'));
    if (meta.mime === 'application/pdf') {
      modal(meta.name, h('div', { class: 'stack' }, h('iframe', { class: 'pdf', src: url, title: meta.name }), dl), { wide: true });
    } else if (/^image\//.test(meta.mime)) {
      modal(meta.name, h('div', { class: 'stack' }, h('img', { class: 'preview', src: url, alt: meta.name }), dl), { wide: true });
    } else if (/^audio\//.test(meta.mime)) {
      modal(meta.name, h('div', { class: 'stack' }, h('audio', { controls: true, src: url, autoplay: true }), dl));
    } else {
      downloadAttachment(vault, id);
    }
  } catch (e) { toast(e.message, 'error'); }
}

export async function downloadAttachment(vault, id) {
  const meta = vault.get(id);
  try {
    const url = await vault.attachmentUrl(id);
    const a = h('a', { href: url, download: meta?.name || 'file' });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { toast(e.message, 'error'); }
}

/** List of a note's attachments with open/download/remove. */
export function attachmentList(vault, ids, { onRemove } = {}) {
  const live = ids.map((id) => vault.get(id)).filter(Boolean);
  if (!live.length) return h('div', { class: 'att-list empty' }, 'No attachments yet. Use Photo, Record or Attach in the toolbar, or drop files into the note.');
  return h('div', { class: 'att-list' }, live.map((m) => {
    const kind = m.mime === 'application/pdf' ? 'file' : /^image\//.test(m.mime) ? 'image' : /^audio\//.test(m.mime) ? 'mic' : 'clip';
    const thumb = h('div', { class: `att-thumb k-${kind}` }, icon(kind));
    if (kind === 'image') vault.attachmentUrl(m.id).then((u) => { thumb.textContent = ''; thumb.append(h('img', { src: u, alt: '' })); }).catch(() => {});
    const label = kind === 'file' ? 'PDF' : kind === 'mic' ? 'Voice note' : (m.mime.split('/')[1] || 'file').toUpperCase();
    return h('div', { class: 'att-item' },
      h('button', { class: 'att-open', onclick: () => openAttachment(vault, m.id), title: 'Open' }, thumb,
        h('span', { class: 'att-name' }, m.name), h('span', { class: 'muted small' }, `${label} · ${fmtSize(m.size)}`)),
      h('div', { class: 'row' },
        h('button', { class: 'icon-btn', title: 'Download', 'aria-label': 'Download', onclick: () => downloadAttachment(vault, m.id) }, icon('download')),
        onRemove && h('button', { class: 'icon-btn', title: 'Delete file', 'aria-label': 'Delete file', onclick: async () => {
          if (await confirmDialog(`Delete "${m.name}"? It will be removed from every device.`, { ok: 'Delete', danger: true })) onRemove(m.id);
        } }, icon('trash'))));
  }));
}
