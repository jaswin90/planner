// Rich text editor (Evernote-style fixed toolbar): text formatting, lists,
// checklists, tables, equations, callouts, inline photos, voice notes and
// file cards (PDF preview inline). Every attachment is encrypted by the
// vault before it is stored anywhere.

import { h, icon, clear, toast, pickFiles, fmtSize, modal, promptDialog, confirmDialog, debounce } from './ui.js';
import { sanitizeHtml, sanitizeToFragment } from './sanitize.js';
import { renderTex, loadKatex } from './math.js';
import { recordVoice } from './recorder.js';
import { CONFIG } from './config.js';
import { looksLikeMarkdown, markdownToHtml } from './markdown.js';

const IMG_TYPES = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;

export function createEditor({ vault, html = '', ownerId, onChange, onAttachmentsChange, placeholder = "Start writing. Type '/' for blocks, or use Markdown: # heading, * list, 1. numbered, [] to-do", compact = false, numbered = false, onNumbered }) {
  const body = h('div', { class: 'rte', contenteditable: 'true', spellcheck: 'true', 'data-placeholder': placeholder, role: 'textbox', 'aria-multiline': 'true' });
  body.append(sanitizeToFragment(html));
  const changed = debounce(() => onChange?.(getHtml()), 400);
  let savedRange = null;

  // ---------- toolbar ----------
  const btn = (cmd, label, title, cls = '') => {
    const b = h('button', { type: 'button', class: `tb ${cls}`, title, 'aria-label': title, dataset: { cmd } }, label);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the caret where it is
    b.addEventListener('click', () => run(cmd));
    return b;
  };
  const sep = () => h('span', { class: 'sep' });
  const bar = h('div', { class: `rte-bar${compact ? ' compact' : ''}`, role: 'toolbar' },
    h('div', { class: 'tb-group seg-blocks' },
      btn('p', 'Text', 'Normal text'), btn('h1', 'H1', 'Heading (# then space)'), btn('h2', 'H2', 'Subheading (## then space)'), btn('h3', 'H3', 'Small heading (### then space)')),
    btn('numheads', '1.1', 'Number the headings (1, 1.1, 1.2…)', 'numh'), sep(),
    btn('bold', h('b', {}, 'B'), 'Bold (Ctrl+B or **text**)'), btn('italic', h('i', {}, 'I'), 'Italic (Ctrl+I or *text*)'), btn('underline', h('u', {}, 'U'), 'Underline (Ctrl+U)'),
    btn('strikeThrough', h('s', {}, 'S'), 'Strikethrough (~~text~~)'), btn('mark', h('span', { class: 'hl-swatch' }, 'A'), 'Highlight (==text==)'), btn('code', '</>', 'Code block (``` then space)'), sep(),
    btn('ul', '•≡', 'Bulleted list (* or - then space)'), btn('ol', '1.≡', 'Numbered list (1. then space)'), btn('todo', '☑', 'To-do list ([] then space)'),
    btn('outdent', '⇤', 'Move list item out (Shift+Tab)'), btn('indent', '⇥', 'Indent list item: 1 → 1.1 (Tab)'), sep(),
    btn('quote', '❝', 'Quote (> then space)'), btn('link', icon('link'), 'Link'), sep(),
    btn('table', ['⊞', h('span', { class: 'tb-l' }, 'Table')], 'Insert table', 'hl'),
    btn('equation', ['∑', h('span', { class: 'tb-l' }, 'Equation')], 'Insert equation', 'hl'),
    btn('image', [icon('image'), h('span', { class: 'tb-l' }, 'Photo')], 'Insert photo (or paste a screenshot)', 'hl'),
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
      case 'p': case 'h1': case 'h2': case 'h3': case 'quote': case 'code': case 'ul': case 'ol': case 'todo': setBlock(cmd); break;
      case 'numheads': setNumbered(!body.classList.contains('num-heads')); onNumbered?.(body.classList.contains('num-heads')); break;
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
    for (const el of clone.querySelectorAll('[data-num]')) delete el.dataset.num;
    for (const el of clone.querySelectorAll('p')) if (!el.childNodes.length) el.remove();
    return sanitizeHtml(clone.innerHTML.replace(/\u200b/g, ''));
  }

  // ---------- events ----------
  body.addEventListener('input', () => changed());
  body.addEventListener('blur', () => changed.flush());
  for (const ev of ['keyup', 'mouseup', 'focus']) body.addEventListener(ev, updateTableBar);
  body.addEventListener('paste', async (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    // Screenshots and copied images arrive as files (or as file items on some systems).
    let files = Array.from(cd.files || []);
    if (!files.length) files = Array.from(cd.items || []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    e.preventDefault();
    if (files.length) {
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
      await insertFiles(files.map((f, i) => (!f.name || /^image\.\w+$/i.test(f.name)) && IMG_TYPES.test(f.type)
        ? new File([f], `Screenshot ${stamp}${files.length > 1 ? ' ' + (i + 1) : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }) : f));
      return;
    }
    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    if (caretEl()?.closest('pre, code')) document.execCommand('insertText', false, text);
    else if (text && looksLikeMarkdown(text) && (!html || !/<(h[1-6]|ul|ol|table|strong|b|em|pre|blockquote)[\s>]/i.test(html))) {
      document.execCommand('insertHTML', false, sanitizeHtml(markdownToHtml(text)));
    } else if (html) document.execCommand('insertHTML', false, sanitizeHtml(html).replace(/<img[^>]*>/g, '').replace(/<(div|span)[^>]*class="(eq-block|eq|voice|filecard)"[^>]*><\/\1>/g, ''));
    else document.execCommand('insertText', false, text);
    // Browsers leave empty shells behind when blocks are pasted into a line; remove them.
    const keep = caretBlock();
    for (const el of body.querySelectorAll('p, blockquote, h1, h2, h3, h4')) {
      if (el !== keep && !el.textContent.trim() && !el.querySelector('br, img, .eq, .eq-block, .voice, .filecard')) el.remove();
    }
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
      if (li && (!li.dataset.checked || !li.textContent.trim())) li.dataset.checked = 'false';
    });
  });

  // ---------- Notion-style typing: Markdown shortcuts and the "/" menu ----------
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* old browsers */ }

  /** The block the caret is in (a paragraph, heading, list item, cell…), or the editor itself. */
  function caretBlock() {
    const el = caretEl();
    const b = el?.closest('p, div, h1, h2, h3, h4, li, blockquote, pre, td, th');
    return b && body.contains(b) && b !== body ? b : body;
  }
  function rangeToCaret(block) {
    const s = window.getSelection();
    const r = document.createRange();
    r.setStart(block, 0); r.setEnd(s.anchorNode, s.anchorOffset);
    return r;
  }
  function rangeFromCaret(block) {
    const s = window.getSelection();
    const r = document.createRange();
    r.setStart(s.anchorNode, s.anchorOffset); r.setEnd(block, block.childNodes.length);
    return r;
  }
  function caretInto(node, atEnd = false) {
    const r = document.createRange();
    r.selectNodeContents(node); r.collapse(!atEnd);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function caretAt(node, offset) {
    const r = document.createRange(); r.setStart(node, offset); r.collapse(true);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  /** Replace a paragraph by a one-item list holding its content (no merging with lists around it). */
  function makeList(kind, b) {
    const li = h('li');
    while (b.firstChild) li.append(b.firstChild);
    if (!li.textContent && !li.querySelector('br')) li.append(h('br'));
    const todo = kind === 'todo' || kind === 'done';
    if (todo) li.dataset.checked = kind === 'done' ? 'true' : 'false';
    b.replaceWith(h(kind === 'ol' ? 'ol' : 'ul', todo ? { class: 'checklist' } : {}, li));
    caretInto(li);
  }
  const plainBlock = (b) => b === body || b.nodeName === 'P' || /^H[1-4]$/.test(b.nodeName) || (b.nodeName === 'DIV' && !b.className);

  /** Turn the caret's block into another kind (used by Markdown shortcuts and the "/" menu). */
  function placeAt(el, off) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (off <= n.data.length) return caretAt(n, off); off -= n.data.length; }
    caretInto(el, true);
  }
  /** Change a paragraph/heading/quote into another of those, keeping its content and the caret. */
  function retag(tag) {
    const b = caretBlock();
    if (b === body || !/^(P|H[1-4]|BLOCKQUOTE|PRE|DIV)$/.test(b.nodeName) || b.className) { document.execCommand('formatBlock', false, tag); return; }
    if (b.nodeName === tag) return;
    const off = rangeToCaret(b).toString().length;
    const n = document.createElement(tag);
    while (b.firstChild) n.append(b.firstChild);
    if (!n.firstChild) n.append(h('br'));
    b.replaceWith(n);
    placeAt(n, off);
  }
  function setBlock(kind) {
    switch (kind) {
      case 'p': retag('P'); break;
      case 'h1': case 'h2': case 'h3': retag(kind.toUpperCase()); break;
      case 'quote': retag('BLOCKQUOTE'); break;
      case 'code': {
        retag('PRE');
        const pre = caretEl()?.closest('pre');
        if (pre) { const txt = pre.textContent.replace(/\n$/, ''); pre.textContent = txt + '\n'; caretAt(pre.firstChild, txt.length); }
        break;
      }
      case 'ul': case 'ol': case 'todo': case 'done': {
        const b = caretBlock();
        if (b !== body && plainBlock(b)) { makeList(kind, b); break; }
        if (kind === 'ul' || kind === 'ol') { document.execCommand(kind === 'ul' ? 'insertUnorderedList' : 'insertOrderedList', false, null); break; }
        const li = caretEl()?.closest('li');
        if (li && li.parentElement.nodeName === 'UL') { li.parentElement.classList.add('checklist'); for (const x of li.parentElement.children) if (!x.dataset.checked) x.dataset.checked = 'false'; }
        else toggleChecklist();
        const cur = caretEl()?.closest('li');
        if (cur) cur.dataset.checked = kind === 'done' ? 'true' : 'false';
        break;
      }
      case 'hr': {
        const b = caretBlock();
        const after = h('p', {}, h('br'));
        if (b !== body && b.nodeName === 'P' && !b.textContent.trim()) b.replaceWith(h('hr'), after); else insertBlock(h('hr'));
        if (after.isConnected) caretInto(after);
        break;
      }
      default: run(kind); return; // table, equation, callout, image, attach, record
    }
    changed();
  }

  const BLOCK_MD = [[/^#$/, 'h1'], [/^##$/, 'h2'], [/^###$/, 'h3'], [/^[-*+]$/, 'ul'], [/^1[.)]$/, 'ol'],
    [/^\[ ?\]$/, 'todo'], [/^\[[xX]\]$/, 'done'], [/^>$/, 'quote'], [/^```$/, 'code']];
  const link = (m) => h('a', { href: m[3], target: '_blank', rel: 'noopener noreferrer nofollow' }, m[2]);
  const INLINE_MD = [
    [/()\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/, link],
    [/()\*\*([^*\n]+)\*\*$/, (m) => h('strong', {}, m[2])],
    [/()__([^_\n]+)__$/, (m) => h('strong', {}, m[2])],
    [/()~~([^~\n]+)~~$/, (m) => h('s', {}, m[2])],
    [/()==([^=\n]+)==$/, (m) => h('mark', {}, m[2])],
    [/()`([^`\n]+)`$/, (m) => h('code', {}, m[2])],
    [/(^|[^*\w])\*([^*\s](?:[^*\n]*[^*\s])?)\*$/, (m) => h('em', {}, m[2])],
    [/(^|[^_\w])_([^_\s](?:[^_\n]*[^_\s])?)_$/, (m) => h('em', {}, m[2])],
  ];
  /** **bold**, *italic*, `code`, ~~strike~~, ==highlight== and [text](https://…) turn into formatting as you type. */
  function inlineMarkdown(e) {
    if (e.inputType !== 'insertText' || !e.data || !'*_`~=)'.includes(e.data.slice(-1))) return;
    const s = window.getSelection();
    const node = s.anchorNode;
    if (!s.isCollapsed || !node || node.nodeType !== 3 || !body.contains(node) || node.parentElement.closest('pre, code')) return;
    const off = s.anchorOffset;
    const text = node.data.slice(0, off);
    for (const [re, make] of INLINE_MD) {
      const m = re.exec(text);
      if (!m) continue;
      const r = document.createRange();
      r.setStart(node, m.index + m[1].length); r.setEnd(node, off);
      r.deleteContents();
      const zw = document.createTextNode('​'); // so typing continues outside the new formatting
      r.insertNode(zw); r.insertNode(make(m));
      const c = document.createRange(); c.setStart(zw, 1); c.collapse(true);
      s.removeAllRanges(); s.addRange(c);
      return;
    }
  }
  /** "---" on its own line becomes a divider. */
  function dividerShortcut() {
    const b = caretBlock();
    if (!plainBlock(b) || b.textContent !== '---' || b.querySelector('img,.eq,.eq-block')) return;
    if (b === body) { document.execCommand('formatBlock', false, 'P'); return dividerShortcut(); }
    const after = h('p', {}, h('br'));
    b.replaceWith(h('hr'), after);
    caretInto(after);
  }

  // The "/" menu: type / at the start of a line or after a space, then filter by typing.
  const SLASH = [
    ['p', 'Text', 'Plain paragraph', 'T'], ['h1', 'Heading 1', 'Large section heading', 'H1'], ['h2', 'Heading 2', 'Medium heading', 'H2'],
    ['h3', 'Heading 3', 'Small heading', 'H3'], ['ul', 'Bulleted list', 'A simple list', '•'], ['ol', 'Numbered list', '1, 2, 3…', '1.'],
    ['todo', 'To-do list', 'Checkboxes  [] ', '☑'], ['quote', 'Quote', 'Quotation  > ', '❝'], ['code', 'Code block', 'Monospace  ``` ', '</>'],
    ['hr', 'Divider', 'Horizontal line  --- ', '—'], ['callout', 'Callout', 'Highlighted box', '💡'], ['table', 'Table', '3 × 3 grid', '⊞'],
    ['equation', 'Equation', 'LaTeX formula', '∑'], ['image', 'Photo', 'Upload an image (or paste a screenshot)', '🖼'],
    ['attach', 'File or PDF', 'Attach any file', '📎'], ['record', 'Voice note', 'Record audio', '🎤'],
  ];
  let slash = null; // { node, offset, menu, items, index }
  function closeSlash() { slash?.menu.remove(); slash = null; }
  function openSlash() {
    const s = window.getSelection();
    const node = s.anchorNode;
    if (!node || node.nodeType !== 3) return;
    const at = s.anchorOffset - 1;
    if (node.data[at] !== '/' || (at > 0 && !/\s/.test(node.data[at - 1]))) return;
    if (node.parentElement.closest('pre, code, td, th')) return;
    closeSlash();
    slash = { node, offset: at, menu: h('div', { class: 'slash-menu', role: 'listbox' }), items: [], index: 0 };
    document.body.append(slash.menu);
    drawSlash();
  }
  function slashQuery() {
    const s = window.getSelection();
    if (!slash || s.anchorNode !== slash.node || s.anchorOffset <= slash.offset || slash.node.data[slash.offset] !== '/') return null;
    return slash.node.data.slice(slash.offset + 1, s.anchorOffset);
  }
  function drawSlash() {
    const q = slashQuery();
    if (q === null || q.length > 24 || /^\s/.test(q)) return closeSlash();
    const words = q.toLowerCase();
    slash.items = SLASH.filter(([k, l, d]) => !words || l.toLowerCase().includes(words) || k.startsWith(words) || d.toLowerCase().includes(words));
    if (!slash.items.length) return closeSlash();
    slash.index = Math.min(slash.index, slash.items.length - 1);
    clear(slash.menu);
    slash.menu.append(h('div', { class: 'slash-h' }, q ? `Blocks matching “${q}”` : 'Basic blocks'),
      ...slash.items.map(([k, l, d, ic], i) => {
        const b = h('button', { type: 'button', class: `slash-item${i === slash.index ? ' on' : ''}`, role: 'option', 'aria-selected': String(i === slash.index) },
          h('span', { class: 'slash-ic' }, ic), h('span', { class: 'slash-t' }, h('b', {}, l), h('span', {}, d)));
        b.addEventListener('mousedown', (e) => { e.preventDefault(); chooseSlash(k); });
        return b;
      }));
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    const w = 290, hgt = Math.min(360, slash.menu.scrollHeight);
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const below = r.bottom + 6 + hgt < innerHeight;
    Object.assign(slash.menu.style, { left: left + 'px', top: (below ? r.bottom + 6 : Math.max(8, r.top - hgt - 6)) + 'px' });
    slash.menu.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }
  function chooseSlash(kind) {
    const s = window.getSelection();
    const { node, offset } = slash;
    const end = s.anchorNode === node ? s.anchorOffset : offset + 1;
    closeSlash();
    const r = document.createRange(); r.setStart(node, offset); r.setEnd(node, end); r.deleteContents();
    s.removeAllRanges(); s.addRange(r);
    const b = caretBlock();
    if (b !== body && !b.textContent && !b.querySelector('br,img')) b.append(h('br'));
    if (b !== body && !b.textContent) caretInto(b);
    setBlock(kind);
  }

  body.addEventListener('input', (e) => {
    inlineMarkdown(e);
    if (e.inputType === 'insertText' && e.data === '-') dividerShortcut();
    if (e.inputType === 'insertText' && e.data === '/') openSlash();
    else if (slash) drawSlash();
  });
  body.addEventListener('blur', () => setTimeout(closeSlash, 100));
  body.addEventListener('keydown', (e) => {
    if (slash) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        slash.index = (slash.index + (e.key === 'ArrowDown' ? 1 : -1) + slash.items.length) % slash.items.length;
        drawSlash(); return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); chooseSlash(slash.items[slash.index][0]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSlash(); return; }
    }
    const s = window.getSelection();
    if (!s.rangeCount || !s.isCollapsed || !body.contains(s.anchorNode) || e.ctrlKey || e.metaKey || e.altKey) return;
    const b = caretBlock();
    // "# ", "- ", "1. ", "[] ", "> ", "``` " at the start of a line.
    if (e.key === ' ') {
      const r = rangeToCaret(b);
      const pre = r.toString();
      if (pre.length > 3) return;
      const hit = BLOCK_MD.find(([re]) => re.test(pre));
      if (!hit) return;
      const kind = hit[1];
      const inList = b.nodeName === 'LI';
      if (!(plainBlock(b) || (inList && (kind === 'todo' || kind === 'done')))) return;
      e.preventDefault();
      r.deleteContents();
      if (b !== body && !b.textContent && !b.querySelector('br')) { b.append(h('br')); caretInto(b); }
      setBlock(kind);
      return;
    }
    // Backspace at the start of a heading, quote or code block turns it back into text.
    if (e.key === 'Backspace' && /^(H[1-4]|BLOCKQUOTE|PRE)$/.test(b.nodeName) && rangeToCaret(b).toString() === '' && !rangeToCaret(b).cloneContents().querySelector('img,br')) {
      e.preventDefault(); retag('P'); changed(); return;
    }
    // Code blocks: Enter adds a line; Enter on an empty last line leaves the block.
    if (e.key === 'Enter' && !e.shiftKey && b.nodeName === 'PRE') {
      e.preventDefault();
      for (const br of b.querySelectorAll('br')) br.replaceWith('\n');
      b.normalize();
      const before = rangeToCaret(b).toString();
      let full = b.textContent;
      if (!full.endsWith('\n')) full += '\n'; // keeps the last line visible
      const after = full.slice(before.length);
      if (after === '\n' && (before === '' || before.endsWith('\n'))) {
        b.textContent = before.replace(/\n$/, '') + '\n';
        const next = h('p', {}, h('br'));
        b.after(next); caretInto(next);
      } else {
        b.textContent = before + '\n' + after;
        caretAt(b.firstChild, before.length + 1);
      }
      changed(); return;
    }
    // Tab / Shift+Tab indents list items.
    if (e.key === 'Tab' && b.nodeName === 'LI') { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null); changed(); }
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

  // Numbered headings (per note): 1, 1.1, 1.1.1 from the top heading level used.
  function renumber() {
    const heads = body.querySelectorAll('h1, h2, h3, h4');
    if (!body.classList.contains('num-heads')) { for (const x of heads) delete x.dataset.num; return; }
    const base = Math.min(...Array.from(heads, (x) => +x.nodeName[1]));
    const c = [0, 0, 0, 0];
    for (const x of heads) {
      const l = +x.nodeName[1] - base;
      c[l]++; for (let k = l + 1; k < 4; k++) c[k] = 0;
      x.dataset.num = c.slice(0, l + 1).map((v) => v || 1).join('.');
    }
  }
  function setNumbered(on) { body.classList.toggle('num-heads', on); bar.querySelector('.numh')?.classList.toggle('on', on); renumber(); }
  // Show which block style the caret is in.
  function markActive() {
    const b = caretEl() ? caretBlock() : null;
    const tag = b && b !== body ? b.nodeName : '';
    const li = caretEl()?.closest('li');
    const kind = li ? (li.parentElement.classList.contains('checklist') ? 'todo' : li.parentElement.nodeName === 'OL' ? 'ol' : 'ul')
      : ({ P: 'p', H1: 'h1', H2: 'h2', H3: 'h3', BLOCKQUOTE: 'quote', PRE: 'code' })[tag] || (b ? 'p' : '');
    for (const x of bar.querySelectorAll('[data-cmd]')) if (['p', 'h1', 'h2', 'h3', 'quote', 'code', 'ul', 'ol', 'todo'].includes(x.dataset.cmd)) x.classList.toggle('on', x.dataset.cmd === kind);
  }
  for (const ev of ['keyup', 'mouseup', 'focus']) body.addEventListener(ev, markActive);
  body.addEventListener('input', renumber);
  setNumbered(numbered);

  // Always type into paragraphs (so Markdown shortcuts and "/" work on the first line too).
  const ensurePara = () => {
    if (!body.firstChild || (body.childNodes.length === 1 && body.firstChild.nodeName === 'BR')) { body.textContent = ''; body.append(h('p', {}, h('br'))); }
    else for (const n of Array.from(body.childNodes)) if (n.nodeType === 3 && n.data.trim()) { const p = h('p'); n.replaceWith(p); p.append(n); }
    body.classList.toggle('empty', !body.textContent.trim() && !body.querySelector('img,hr,table,ul,ol,pre,blockquote,.eq-block,span.eq,.voice,.filecard,.callout,h1,h2,h3,h4'));
  };
  ensurePara();
  body.addEventListener('input', ensurePara);
  body.addEventListener('focus', ensurePara);
  hydrate();
  const el = h('div', { class: 'rte-wrap' }, bar, tableBar, body);
  return {
    el, bar, body, getHtml, hydrate, flush: () => changed.flush(), focus: () => body.focus(),
    addFiles: insertFiles,
    setHtml(next) { body.textContent = ''; body.append(sanitizeToFragment(next)); ensurePara(); hydrate(); },
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
