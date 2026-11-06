// Notes: searchable list + rich editor with photos and attached files.

import { h, icon, clear, confirmDialog, fmtWhen } from './ui.js';
import { liveItems, htmlToText } from './model.js';
import { createEditor, attachmentList } from './editor.js';

const state = { q: '', project: '', current: null };
let active = null; // { id, editor } of the open note

export function currentNoteEditor() { return active; }

export function renderNotes(root, vault, { openId } = {}) {
  if (openId !== undefined) state.current = openId;
  clear(root);
  const rerender = () => renderNotes(root, vault);
  const projects = liveItems(vault.doc, 'project').sort((a, b) => a.name.localeCompare(b.name));
  const matches = (n, q) => !q || (n.title || '').toLowerCase().includes(q) || htmlToText(n.html).toLowerCase().includes(q)
    || (n.attachments || []).some((a) => (vault.get(a)?.name || '').toLowerCase().includes(q));
  const allNotes = () => liveItems(vault.doc, 'note')
    .filter((n) => !state.project || n.projectId === state.project)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  if (state.current && !vault.get(state.current)) state.current = null;

  const search = h('input', { type: 'search', placeholder: 'Search notes and file names', value: state.q, 'aria-label': 'Search notes' });
  search.addEventListener('input', () => { state.q = search.value; drawList(); });

  const listEl = h('div', { class: 'note-list' });
  function drawList() {
    const all = allNotes();
    const shown = all.filter((n) => matches(n, state.q.toLowerCase()));
    clear(listEl).append(...(shown.length ? shown.map((n) => {
      const p = n.projectId && vault.get(n.projectId);
      const atts = (n.attachments || []).map((a) => vault.get(a)).filter(Boolean);
      const firstImg = atts.find((a) => /^image\//.test(a.mime));
      const thumb = firstImg ? h('div', { class: 'nl-thumb' }) : null;
      if (thumb) vault.attachmentUrl(firstImg.id).then((u) => thumb.append(h('img', { src: u, alt: '' }))).catch(() => {});
      return h('button', { class: `nl-item${n.id === state.current ? ' on' : ''}`, onclick: () => { location.hash = `#/notes/${n.id}`; } },
        h('div', { class: 'nl-text' },
          h('div', { class: 'nl-title' }, n.pinned && icon('pin'), n.title || 'Untitled'),
          h('div', { class: 'nl-prev' }, htmlToText(n.html).slice(0, 120) || (atts.length ? `${atts.length} attachment(s)` : 'Empty note')),
          h('div', { class: 'nl-meta' }, fmtWhen(n.updatedAt), p && h('span', { class: 'pdot', vars: { '--pc': p.color } }, p.name), atts.length > 0 && h('span', {}, icon('clip'), String(atts.length)))),
        thumb);
    }) : [h('p', { class: 'muted pad' }, all.length ? 'No matches.' : 'No notes yet. Create your first one.')]));
  }
  drawList();

  const list = h('aside', { class: `notes-side${state.current ? ' has-open' : ''}` },
    h('div', { class: 'row' }, search,
      h('button', { class: 'btn primary', onclick: () => {
        const n = vault.put({ type: 'note', title: '', html: '', projectId: state.project || null, attachments: [] });
        location.hash = `#/notes/${n.id}`;
      } }, icon('plus'), 'New')),
    h('select', { 'aria-label': 'Filter by project', onchange: (e) => { state.project = e.target.value; rerender(); } },
      h('option', { value: '' }, 'All notebooks'), projects.map((p) => h('option', { value: p.id, selected: state.project === p.id }, p.name))),
    listEl);

  const pane = h('main', { class: 'note-pane' });
  active = null;
  const n = state.current && vault.get(state.current);
  if (n) {
    const id = n.id;
    const save = (patch) => { vault.update(id, patch); };
    const attBox = h('div');
    const drawAtts = () => clear(attBox).append(attachmentList(vault, vault.get(id)?.attachments || [], { onRemove: (aid) => {
      vault.removeAttachment(aid);
      editor.body.querySelectorAll(`[data-att="${aid}"]`).forEach((x) => x.remove());
      save({ attachments: (vault.get(id).attachments || []).filter((x) => x !== aid), html: editor.getHtml() });
      drawAtts();
    } }));
    const editor = createEditor({
      vault, html: n.html || '', ownerId: id,
      onChange: (html) => { save({ html }); drawList(); },
      onAttachmentsChange: (aid) => { save({ attachments: [...(vault.get(id).attachments || []), aid] }); drawAtts(); },
    });
    drawAtts();
    active = { id, editor };
    const titleIn = h('input', { class: 'title-in', type: 'text', value: n.title || '', placeholder: 'Title', maxlength: 300 });
    titleIn.addEventListener('input', () => { save({ title: titleIn.value }); drawList(); });
    titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } });
    pane.append(
      h('div', { class: 'note-top' },
        h('button', { class: 'btn back', onclick: () => { location.hash = '#/notes'; } }, icon('left'), 'Notes'),
        h('select', { 'aria-label': 'Notebook', onchange: (e) => { save({ projectId: e.target.value || null }); drawList(); } },
          h('option', { value: '' }, 'No notebook'), projects.map((p) => h('option', { value: p.id, selected: n.projectId === p.id }, p.name))),
        h('button', { class: `icon-btn${n.pinned ? ' on' : ''}`, title: n.pinned ? 'Unpin' : 'Pin to top', 'aria-label': 'Pin', onclick: (e) => {
          const p = !vault.get(id).pinned; save({ pinned: p }); e.currentTarget.classList.toggle('on', p); drawList();
        } }, icon('pin')),
        h('button', { class: 'icon-btn', title: 'Delete note', 'aria-label': 'Delete note', onclick: async () => {
          if (await confirmDialog('Delete this note and all of its photos and files?', { ok: 'Delete', danger: true })) { vault.remove(id); location.hash = '#/notes'; }
        } }, icon('trash'))),
      titleIn,
      editor.el,
      h('h3', { class: 'small-h' }, 'Attachments'),
      attBox);
    if (!n.title && !n.html) setTimeout(() => titleIn.focus());
  } else {
    pane.append(h('div', { class: 'empty-pane' }, icon('note'), h('p', {}, 'Select a note, or create a new one.'),
      h('p', { class: 'muted small' }, 'Paste or drop photos and PDFs straight into a note. Everything is encrypted before it is saved.')));
  }
  root.append(h('div', { class: `notes${state.current ? ' open' : ''}` }, list, pane));
}
