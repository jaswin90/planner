// Notes, Evernote-style: [projects pane] [note list] [note], where the two
// left panes can be collapsed to give the note the whole width.
// Each note in the list is drawn as a small sticky in the note's colour.

import { h, icon, clear, confirmDialog, fmtWhen } from './ui.js';
import { liveItems, htmlToText } from './model.js';
import { createEditor, attachmentList } from './editor.js';
import { currentProject, setCurrentProject, projects, newProject, projectSelect } from './projects.js';

export const NOTE_COLORS = { yellow: '#fff3a8', pink: '#ffd1dc', blue: '#cfe6ff', green: '#d4f5d0', orange: '#ffe0b8', purple: '#e6dcff', white: '#ffffff' };

const state = { q: '', filter: 'all', current: null, sort: 'edited' };
let active = null; // { id, editor } of the open note

export function currentNoteEditor() { return active; }

function pref(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(`planner.notes.${k}`) === '1';
    localStorage.setItem(`planner.notes.${k}`, v ? '1' : '0');
  } catch { return false; }
  return v;
}

export function renderNotes(root, vault, { openId } = {}) {
  if (openId !== undefined) state.current = openId;
  if (state.current && !vault.get(state.current)) state.current = null;
  clear(root);
  const rerender = () => renderNotes(root, vault);
  const proj = currentProject(vault);
  const navCollapsed = pref('nav');
  const listCollapsed = pref('list') && !!state.current;

  const inScope = (n) => !proj || n.projectId === proj;
  const allNotes = liveItems(vault.doc, 'note');
  const scopedNow = () => liveItems(vault.doc, 'note').filter(inScope); // always fresh (titles change while typing)
  const matches = (n, q) => !q || (n.title || '').toLowerCase().includes(q) || htmlToText(n.html).toLowerCase().includes(q)
    || (n.attachments || []).some((a) => (vault.get(a)?.name || '').toLowerCase().includes(q));
  const listed = () => scopedNow()
    .filter((n) => state.filter !== 'pinned' || n.pinned)
    .filter((n) => matches(n, state.q.toLowerCase()))
    .sort((a, b) => state.sort === 'title' ? (a.title || '').localeCompare(b.title || '')
      : state.sort === 'created' ? (b.createdAt || 0) - (a.createdAt || 0)
        : (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);

  const createNote = () => {
    const n = vault.put({ type: 'note', title: '', html: '', projectId: proj || null, color: 'yellow', attachments: [] });
    location.hash = `#/notes/${n.id}`;
  };

  // ---------------- pane 1: projects ----------------
  const navItem = (label, count, on, onclick, color) => h('button', { class: `nav-it${on ? ' on' : ''}`, onclick },
    color ? h('span', { class: 'pdot-only', vars: { '--pc': color } }) : null, h('span', { class: 'grow' }, label), h('span', { class: 'cnt' }, String(count)));
  const nav = navCollapsed
    ? h('aside', { class: 'n-nav rail' },
      h('button', { class: 'icon-btn', title: 'Show projects', 'aria-label': 'Show projects', onclick: () => { pref('nav', false); rerender(); } }, icon('expand')),
      h('button', { class: 'icon-btn accent', title: 'New note', 'aria-label': 'New note', onclick: createNote }, icon('plus')))
    : h('aside', { class: 'n-nav' },
      h('div', { class: 'pane-head' }, h('button', { class: 'btn primary grow', onclick: createNote }, icon('plus'), 'New note'),
        h('button', { class: 'icon-btn', title: 'Hide this pane', 'aria-label': 'Hide projects pane', onclick: () => { pref('nav', true); rerender(); } }, icon('collapse'))),
      navItem('All notes', allNotes.length, !proj && state.filter === 'all', () => { state.filter = 'all'; setCurrentProject(''); }),
      navItem('Pinned', allNotes.filter((n) => n.pinned && inScope(n)).length, state.filter === 'pinned', () => { state.filter = state.filter === 'pinned' ? 'all' : 'pinned'; rerender(); }),
      h('div', { class: 'nav-sec' }, 'Projects'),
      projects(vault).map((p) => navItem(p.name, allNotes.filter((n) => n.projectId === p.id).length, proj === p.id, () => { setCurrentProject(p.id); }, p.color)),
      h('button', { class: 'nav-it accent', onclick: async () => { const p = await newProject(vault); if (p) setCurrentProject(p.id); } }, icon('plus'), 'New project'));

  // ---------------- pane 2: note list ----------------
  const search = h('input', { type: 'search', placeholder: 'Search notes, files, voice notes', value: state.q, 'aria-label': 'Search notes' });
  search.addEventListener('input', () => { state.q = search.value; drawList(); });
  const listEl = h('div', { class: 'note-list' });
  const countEl = h('b');
  function drawList() {
    const items = listed();
    countEl.textContent = `${proj ? vault.get(proj)?.name : state.filter === 'pinned' ? 'Pinned' : 'All notes'} · ${items.length}`;
    clear(listEl).append(...(items.length ? items.map(noteCard) : [h('div', { class: 'muted pad' }, scopedNow().length ? 'No notes match.' : 'No notes here yet. Click "New note" to start.')]));
  }
  function noteCard(n) {
    const p = n.projectId && vault.get(n.projectId);
    const atts = (n.attachments || []).map((a) => vault.get(a)).filter(Boolean);
    const firstImg = atts.find((a) => /^image\//.test(a.mime));
    const thumb = firstImg ? h('div', { class: 'nl-thumb' }) : null;
    if (thumb) vault.attachmentUrl(firstImg.id).then((u) => thumb.append(h('img', { src: u, alt: '' }))).catch(() => {});
    const voice = atts.filter((a) => /^audio\//.test(a.mime)).length;
    const pdfs = atts.filter((a) => a.mime === 'application/pdf').length;
    return h('button', { class: `nl-card${n.id === state.current ? ' on' : ''}`, vars: { '--nc': NOTE_COLORS[n.color] || NOTE_COLORS.yellow }, onclick: () => { location.hash = `#/notes/${n.id}`; } },
      h('div', { class: 'nl-text' },
        h('div', { class: 'nl-title' }, n.pinned && icon('pin'), n.title || 'Untitled'),
        h('div', { class: 'nl-prev' }, htmlToText(n.html).slice(0, 140) || 'No text'),
        h('div', { class: 'nl-meta' }, fmtWhen(n.updatedAt), p && h('span', { class: 'pdot', vars: { '--pc': p.color } }, p.name),
          pdfs > 0 && h('span', {}, icon('file'), String(pdfs)), voice > 0 && h('span', {}, icon('mic'), String(voice)),
          atts.length - pdfs - voice > 0 && h('span', {}, icon('clip'), String(atts.length - pdfs - voice)))),
      thumb);
  }
  const list = listCollapsed ? null : h('section', { class: 'n-list' },
    h('div', { class: 'pane-head' }, countEl, h('span', { class: 'grow' }),
      h('select', { class: 'small-sel', 'aria-label': 'Sort notes', onchange: (e) => { state.sort = e.target.value; drawList(); } },
        [['edited', 'Last edited'], ['created', 'Created'], ['title', 'Title']].map(([v, l]) => h('option', { value: v, selected: state.sort === v }, l))),
      state.current && h('button', { class: 'icon-btn', title: 'Hide note list', 'aria-label': 'Hide note list', onclick: () => { pref('list', true); rerender(); } }, icon('collapse'))),
    h('div', { class: 'pad-x' }, search),
    listEl);
  if (list) drawList();

  // ---------------- pane 3: the note ----------------
  const pane = h('main', { class: 'n-note' });
  active = null;
  const n = state.current && vault.get(state.current);
  if (n) {
    const id = n.id;
    const save = (patch) => vault.update(id, patch);
    const attBox = h('div');
    const drawAtts = () => clear(attBox).append(attachmentList(vault, vault.get(id)?.attachments || [], { onRemove: (aid) => {
      vault.removeAttachment(aid);
      editor.body.querySelectorAll(`[data-att="${aid}"]`).forEach((x) => x.remove());
      save({ attachments: (vault.get(id).attachments || []).filter((x) => x !== aid), html: editor.getHtml() });
      drawAtts();
      if (list) drawList();
    } }));
    const editor = createEditor({
      vault, html: n.html || '', ownerId: id,
      numbered: !!n.numHeads, onNumbered: (v) => save({ numHeads: v }),
      onChange: (html) => { save({ html }); if (list) drawList(); edited.textContent = 'Saved'; },
      onAttachmentsChange: (aid) => { save({ attachments: [...(vault.get(id).attachments || []), aid] }); drawAtts(); if (list) drawList(); },
    });
    drawAtts();
    active = { id, editor };
    const titleIn = h('input', { class: 'title-in', type: 'text', value: n.title || '', placeholder: 'Title', maxlength: 300, 'aria-label': 'Title' });
    titleIn.addEventListener('input', () => { save({ title: titleIn.value }); if (list) drawList(); });
    titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } });
    const edited = h('span', { class: 'muted small' }, `Edited ${fmtWhen(n.updatedAt)}`);
    const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Note colour' }, Object.entries(NOTE_COLORS).map(([k, c]) =>
      h('button', { class: `sw${(n.color || 'yellow') === k ? ' on' : ''}`, title: k, 'aria-label': `${k} note`, vars: { '--sw': c }, onclick: (e) => {
        save({ color: k }); swatches.querySelectorAll('.sw').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); if (list) drawList();
      } })));
    const showPanes = (navCollapsed || listCollapsed) && h('button', { class: 'btn small', title: 'Show projects and note list', onclick: () => { pref('nav', false); pref('list', false); rerender(); } }, icon('expand'), 'Show list');
    pane.append(
      editor.bar,
      h('div', { class: 'n-scroll' },
        h('div', { class: 'n-doc' },
          h('div', { class: 'note-meta' },
            h('button', { class: 'btn small back', onclick: () => { location.hash = '#/notes'; } }, icon('left'), 'Notes'),
            showPanes,
            projectSelect(vault, n.projectId, (v) => { save({ projectId: v }); if (list) drawList(); }),
            swatches,
            h('span', { class: 'grow' }),
            edited,
            h('button', { class: `icon-btn${n.pinned ? ' on' : ''}`, title: n.pinned ? 'Unpin' : 'Pin to top', 'aria-label': 'Pin', onclick: (e) => {
              const pnd = !vault.get(id).pinned; save({ pinned: pnd }); e.currentTarget.classList.toggle('on', pnd); if (list) drawList();
            } }, icon('pin')),
            h('button', { class: 'icon-btn', title: 'Delete note', 'aria-label': 'Delete note', onclick: async () => {
              if (await confirmDialog('Delete this note with all its photos, voice notes and files?', { ok: 'Delete', danger: true })) { vault.remove(id); location.hash = '#/notes'; }
            } }, icon('trash'))),
          titleIn,
          editor.el,
          h('h3', { class: 'small-h' }, 'All attachments in this note'),
          attBox)));
    // (editor.bar was moved to the top of the pane above, so it stays visible while scrolling.)
    if (!n.title && !n.html) setTimeout(() => titleIn.focus());
  } else {
    pane.append(h('div', { class: 'empty-pane' }, icon('note'), h('p', {}, 'Select a note, or create a new one.'),
      h('button', { class: 'btn primary', onclick: createNote }, icon('plus'), 'New note'),
      h('p', { class: 'muted small' }, 'Notes can hold tables, equations, photos, voice notes and PDFs. Everything is stored encrypted.')));
  }
  root.append(h('div', { class: `notes3${state.current ? ' open' : ''}${navCollapsed ? ' nav-off' : ''}${listCollapsed ? ' list-off' : ''}` }, nav, list, pane));
}
