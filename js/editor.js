// Rich text editor: formatting, checklists, inline photos, file chips,
// paste/drop of images and files. Attachments are encrypted by the vault
// before they are stored anywhere.

import { h, icon, toast, pickFiles, fmtSize, modal, promptDialog, confirmDialog, debounce } from './ui.js';
import { sanitizeHtml, sanitizeToFragment } from './sanitize.js';
import { CONFIG } from './config.js';

const TOOLS = [
  ['bold', 'B', 'Bold (Ctrl+B)'],
  ['italic', 'I', 'Italic (Ctrl+I)'],
  ['underline', 'U', 'Underline (Ctrl+U)'],
  ['strikeThrough', 'S', 'Strikethrough'],
  ['mark', 'Hi', 'Highlight'],
  '|',
  ['h1', 'H1', 'Heading'],
  ['h2', 'H2', 'Subheading'],
  ['p', '¶', 'Normal text'],
  '|',
  ['insertUnorderedList', '•', 'Bulleted list'],
  ['insertOrderedList', '1.', 'Numbered list'],
  ['checklist', '☑', 'Checklist'],
  ['blockquote', '❝', 'Quote'],
  ['pre', '</>', 'Code block'],
  '|',
  ['link', '🔗', 'Link'],
  ['image', 'image', 'Insert photo'],
  ['attach', 'clip', 'Attach file (PDF, docs…)'],
  '|',
  ['removeFormat', 'Tx', 'Clear formatting'],
];

export function createEditor({ vault, html = '', ownerId, onChange, onAttachmentsChange, placeholder = 'Write something…' }) {
  const body = h('div', { class: 'rte', contenteditable: 'true', spellcheck: 'true', 'data-placeholder': placeholder, role: 'textbox', 'aria-multiline': 'true' });
  body.append(sanitizeToFragment(html));
  const changed = debounce(() => onChange?.(getHtml()), 400);

  const bar = h('div', { class: 'rte-bar', role: 'toolbar' });
  for (const t of TOOLS) {
    if (t === '|') { bar.append(h('span', { class: 'sep' })); continue; }
    const [cmd, label, title] = t;
    const btn = h('button', { type: 'button', class: 'tb', title, 'aria-label': title, dataset: { cmd } },
      ['image', 'clip'].includes(label) ? icon(label) : label);
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep selection
    btn.addEventListener('click', () => run(cmd));
    bar.append(btn);
  }

  async function run(cmd) {
    body.focus();
    switch (cmd) {
      case 'h1': case 'h2': case 'p': case 'blockquote': case 'pre':
        document.execCommand('formatBlock', false, cmd.toUpperCase()); break;
      case 'checklist': toggleChecklist(); break;
      case 'mark': toggleMark(); break;
      case 'link': {
        const sel = saveSel();
        const url = await promptDialog('Add link', { label: 'Web address', placeholder: 'https://…', type: 'url' });
        restoreSel(sel);
        if (!url) break;
        if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) { toast('Links must start with https://, http:// or mailto:', 'error'); break; }
        if (window.getSelection().isCollapsed) document.execCommand('insertText', false, url.trim());
        document.execCommand('createLink', false, url.trim());
        break;
      }
      case 'image': {
        const sel = saveSel();
        const files = await pickFiles({ accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif' });
        restoreSel(sel);
        await insertFiles(files);
        break;
      }
      case 'attach': {
        const sel = saveSel();
        const files = await pickFiles({});
        restoreSel(sel);
        await insertFiles(files);
        break;
      }
      default: document.execCommand(cmd, false, null);
    }
    changed();
  }

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

  function toggleChecklist() {
    document.execCommand('insertUnorderedList', false, null);
    const s = window.getSelection();
    let n = s.anchorNode;
    while (n && n !== body && n.nodeName !== 'UL') n = n.parentNode;
    if (n && n.nodeName === 'UL') {
      n.classList.add('checklist');
      for (const li of n.children) if (!li.dataset.checked) li.dataset.checked = 'false';
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

  async function insertFiles(files) {
    for (const f of files) {
      try {
        const id = await vault.addAttachment(f, ownerId, CONFIG.maxAttachmentMB);
        if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(f.type)) {
          const img = h('img', { 'data-att': id, alt: f.name });
          insertNode(img);
          insertNode(h('br'));
          hydrate();
        } else {
          insertNode(chip(id));
          insertNode(document.createTextNode(' '));
        }
        onAttachmentsChange?.(id);
      } catch (e) { toast(e.message, 'error'); }
    }
    changed();
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

  function chip(id) {
    const meta = vault.get(id);
    const c = h('span', { class: 'att-chip', 'data-att': id, contenteditable: 'false' });
    fillChip(c, meta);
    return c;
  }
  function fillChip(c, meta) {
    c.textContent = '';
    c.append(icon('clip'), meta ? `${meta.name} · ${fmtSize(meta.size)}` : 'missing file');
  }

  /** Point every <img data-att> at its decrypted object URL. */
  function hydrate() {
    for (const img of body.querySelectorAll('img[data-att]')) {
      if (img.src) continue;
      vault.attachmentUrl(img.dataset.att).then((u) => { img.src = u; }).catch(() => { img.classList.add('broken'); img.alt = 'Photo not available yet'; });
    }
    for (const c of body.querySelectorAll('span.att-chip[data-att]')) fillChip(c, vault.get(c.dataset.att));
  }

  function getHtml() {
    const clone = body.cloneNode(true);
    for (const img of clone.querySelectorAll('img')) img.removeAttribute('src');
    return sanitizeHtml(clone.innerHTML);
  }

  // --- events ---
  body.addEventListener('input', () => changed());
  body.addEventListener('blur', () => changed.flush());
  body.addEventListener('paste', async (e) => {
    const cd = e.clipboardData;
    const files = Array.from(cd?.files || []);
    e.preventDefault();
    if (files.length) { await insertFiles(files); return; }
    const html = cd.getData('text/html');
    if (html) document.execCommand('insertHTML', false, sanitizeHtml(html).replace(/<img[^>]*>/g, ''));
    else document.execCommand('insertText', false, cd.getData('text/plain'));
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
    const c = e.target.closest('span.att-chip[data-att]');
    if (c) openAttachment(vault, c.dataset.att);
    const img = e.target.closest('img[data-att]');
    if (img) imageMenu(img);
    const a = e.target.closest('a[href]');
    if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank', 'noopener,noreferrer');
  });
  body.addEventListener('keydown', (e) => {
    // Enter on an empty checklist item leaves the list (like other editors).
    if (e.key === 'Enter') setTimeout(() => {
      const s = window.getSelection();
      const li = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode).closest?.('ul.checklist > li');
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
        h('button', { class: 'btn', onclick: () => { downloadAttachment(vault, img.dataset.att); } }, icon('download'), 'Download'),
        h('button', { class: 'btn danger', onclick: () => { img.remove(); changed(); m.close(); } }, icon('trash'), 'Remove from note'),
      )), { wide: true });
  }

  hydrate();
  const el = h('div', { class: 'rte-wrap' }, bar, body);
  return {
    el, body, getHtml, hydrate, flush: () => changed.flush(), focus: () => body.focus(),
    addFiles: insertFiles,
    setHtml(next) { body.textContent = ''; body.append(sanitizeToFragment(next)); hydrate(); },
  };
}

export async function openAttachment(vault, id) {
  const meta = vault.get(id);
  if (!meta) return toast('That file was deleted.', 'error');
  try {
    const url = await vault.attachmentUrl(id);
    if (meta.mime === 'application/pdf') {
      modal(meta.name, h('div', { class: 'stack' },
        h('iframe', { class: 'pdf', src: url, title: meta.name }),
        h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => downloadAttachment(vault, id) }, icon('download'), 'Download'))), { wide: true });
    } else if (/^image\//.test(meta.mime)) {
      modal(meta.name, h('div', { class: 'stack' }, h('img', { class: 'preview', src: url, alt: meta.name }),
        h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => downloadAttachment(vault, id) }, icon('download'), 'Download'))), { wide: true });
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

/** List of attachments for a note/task with open/download/remove. */
export function attachmentList(vault, ids, { onRemove } = {}) {
  const live = ids.map((id) => vault.get(id)).filter(Boolean);
  if (!live.length) return h('div', { class: 'att-list empty' }, 'No attachments. Drop files or photos into the note, or use the 📎 button.');
  return h('div', { class: 'att-list' }, live.map((m) => {
    const thumb = h('div', { class: 'att-thumb' }, icon(m.mime === 'application/pdf' ? 'file' : /^image\//.test(m.mime) ? 'image' : 'clip'));
    if (/^image\//.test(m.mime)) vault.attachmentUrl(m.id).then((u) => { thumb.textContent = ''; thumb.append(h('img', { src: u, alt: '' })); }).catch(() => {});
    return h('div', { class: 'att-item' },
      h('button', { class: 'att-open', onclick: () => openAttachment(vault, m.id), title: 'Open' }, thumb,
        h('span', { class: 'att-name' }, m.name), h('span', { class: 'muted small' }, `${m.mime === 'application/pdf' ? 'PDF' : (m.mime.split('/')[1] || 'file').toUpperCase()} · ${fmtSize(m.size)}`)),
      h('div', { class: 'row' },
        h('button', { class: 'icon-btn', title: 'Download', 'aria-label': 'Download', onclick: () => downloadAttachment(vault, m.id) }, icon('download')),
        onRemove && h('button', { class: 'icon-btn', title: 'Delete file', 'aria-label': 'Delete file', onclick: async () => {
          if (await confirmDialog(`Delete "${m.name}"? It will be removed from every device.`, { ok: 'Delete', danger: true })) onRemove(m.id);
        } }, icon('trash'))));
  }));
}
