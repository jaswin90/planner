// Settings (opened from the gear icon): notebooks/projects, account,
// backup, and deleting data.

import { h, icon, clear, toast, modal, confirmDialog, promptDialog, pickFiles } from './ui.js';
import { liveItems } from './model.js';
import { b64, unb64, encryptWithPassword, decryptWithPassword } from './crypto.js';

const COLORS = ['#e8a33d', '#d9534f', '#5b9bd5', '#4caf7d', '#9b6fd1', '#e06fa8', '#3fb5b0', '#8a8f98'];

export function renderSettings(root, vault, { onSignOut }) {
  clear(root);
  const rerender = () => renderSettings(root, vault, { onSignOut });
  const projects = liveItems(vault.doc, 'project').sort((a, b) => a.name.localeCompare(b.name));
  const acct = vault.account;

  const card = (title, ...kids) => h('section', { class: 'card' }, h('h2', {}, title), ...kids);

  root.append(h('div', { class: 'settings' },
    card('Projects & notebooks',
      h('p', { class: 'muted small' }, 'Used to group tasks in the planner and notes.'),
      h('div', { class: 'proj-list' }, projects.map((p) => h('div', { class: 'proj' },
        h('select', { class: 'swatch', 'aria-label': 'Colour', vars: { '--pc': p.color }, onchange: (e) => { vault.update(p.id, { color: e.target.value }); rerender(); } },
          COLORS.map((c) => h('option', { value: c, selected: c === p.color }, '●'))),
        h('input', { type: 'text', value: p.name, maxlength: 60, 'aria-label': 'Name', onchange: (e) => vault.update(p.id, { name: e.target.value.trim() || p.name }) }),
        h('button', { class: 'icon-btn', 'aria-label': 'Delete project', onclick: async () => {
          if (!await confirmDialog(`Delete "${p.name}"? Its tasks and notes are kept, just un-grouped.`, { ok: 'Delete', danger: true })) return;
          for (const it of liveItems(vault.doc)) if (it.projectId === p.id) vault.update(it.id, { projectId: null });
          vault.remove(p.id); rerender();
        } }, icon('trash'))))),
      h('button', { class: 'btn', onclick: async () => {
        const name = await promptDialog('New project', { label: 'Name' });
        if (name?.trim()) { vault.put({ type: 'project', name: name.trim().slice(0, 60), color: COLORS[projects.length % COLORS.length] }); rerender(); }
      } }, icon('plus'), 'Add project')),

    card('Account & sync',
      h('p', {}, acct.mode === 'google' ? `Signed in as ${acct.email}. Encrypted data syncs to a private, hidden app folder in your Google Drive.` : 'This device only. Nothing is synced. Clearing your browser data deletes it.'),
      h('p', { class: 'muted small' }, `Status: ${vault.status.msg || vault.status.state}`),
      h('div', { class: 'row wrap' },
        acct.mode === 'google' && h('button', { class: 'btn', onclick: () => vault.sync() }, icon('sync'), 'Sync now'),
        h('button', { class: 'btn', onclick: onSignOut }, 'Sign out'))),

    card('Backup',
      h('p', { class: 'muted small' }, 'Download a copy of everything (tasks, notes, photos and files), protected with a password you choose. Do this regularly if you use "this device only" mode.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => exportAll(vault) }, icon('download'), 'Export backup'),
        h('button', { class: 'btn', onclick: () => importAll(vault, rerender) }, 'Import backup'))),

    card('Danger zone',
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: async () => {
          if (!await confirmDialog('Remove the encrypted copy stored in this browser? Synced data on Google Drive stays.', { ok: 'Remove' })) return;
          await vault.forgetDevice(); location.reload();
        } }, 'Forget this device'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!await confirmDialog(acct.mode === 'google' ? 'Permanently delete ALL your planner data from Google Drive and this device?' : 'Permanently delete ALL your planner data from this device?', { ok: 'Delete everything', danger: true, typeToConfirm: 'DELETE' })) return;
          try { await vault.destroyAll(); location.reload(); } catch (e) { toast(e.message, 'error'); }
        } }, icon('trash'), 'Delete all my data'))),
  ));
}

function backupPassword() {
  return new Promise((resolve) => {
    let done = false;
    const a = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Backup password' });
    const b = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Type it again' });
    const err = h('p', { class: 'error' });
    const finish = (v) => { done = true; resolve(v); m.close(); };
    const m = modal('Export backup', h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      if (a.value.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
      if (a.value !== b.value) { err.textContent = 'The two passwords are different.'; return; }
      finish(a.value);
    } },
      h('p', {}, 'Protect the backup with a password, so it is safe on a USB stick or a shared drive. You will need this password to import it.'),
      a, b, err,
      h('div', { class: 'row wrap end' },
        h('button', { type: 'button', class: 'btn', onclick: async () => {
          if (await confirmDialog('Without a password, anyone who gets the file can read all your notes. Export anyway?', { ok: 'Export unprotected', danger: true })) finish('');
        } }, 'No password'),
        h('button', { class: 'btn primary' }, 'Export protected'))), { onClose: () => { if (!done) resolve(null); } });
    a.focus();
  });
}

async function exportAll(vault) {
  const password = await backupPassword();
  if (password === null) return;
  toast('Preparing backup…');
  const files = {};
  for (const a of liveItems(vault.doc, 'att')) {
    try {
      const url = await vault.attachmentUrl(a.id);
      files[a.id] = b64(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    } catch { /* not available on this device yet */ }
  }
  let out = JSON.stringify({ app: 'planner', exportedAt: new Date().toISOString(), doc: vault.doc, files });
  if (password) out = JSON.stringify({ app: 'planner', protected: true, exportedAt: new Date().toISOString(), box: await encryptWithPassword(out, password) });
  const url = URL.createObjectURL(new Blob([out], { type: 'application/json' }));
  const a = h('a', { href: url, download: `planner-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importAll(vault, after) {
  const [file] = await pickFiles({ accept: 'application/json,.json', multiple: false });
  if (!file) return;
  try {
    let data = JSON.parse(await file.text());
    if (data.app === 'planner' && data.protected) {
      const box = data.box || {};
      if (!(box.iterations >= 100000 && box.iterations <= 5000000)) throw new Error('Not a planner backup file.');
      const pw = await promptDialog('Import backup', { label: 'Backup password', type: 'password' });
      if (!pw) return;
      data = JSON.parse(await decryptWithPassword(box, pw));
    }
    if (data.app !== 'planner' || !data.doc?.items) throw new Error('Not a planner backup file.');
    let n = 0;
    for (const it of Object.values(data.doc.items).sort((a, b) => (a?.type === 'att' ? 0 : 1) - (b?.type === 'att' ? 0 : 1))) {
      if (!it || typeof it.id !== 'string' || !/^[0-9a-f]{24}$/.test(it.id) || it.deleted) continue;
      if (!['task', 'note', 'project', 'att'].includes(it.type)) continue;
      if (vault.get(it.id)) continue; // keep what is already here
      if (it.type === 'att') {
        const bytes = data.files?.[it.id];
        if (!bytes) continue;
        const f = new File([unb64(bytes)], it.name || 'file', { type: it.mime || 'application/octet-stream' });
        const newId = await vault.addAttachment(f, it.owner);
        remap(data.doc.items, it.id, newId);
        continue;
      }
      vault.put(it); n++;
    }
    toast(`Imported ${n} items.`, 'ok');
    after();
  } catch (e) { toast(e.message, 'error'); }
}

// Attachments get fresh ids on import (their encryption is bound to the id).
function remap(items, oldId, newId) {
  for (const it of Object.values(items)) {
    if (Array.isArray(it.attachments)) it.attachments = it.attachments.map((x) => (x === oldId ? newId : x));
    if (typeof it.html === 'string') it.html = it.html.split(`data-att="${oldId}"`).join(`data-att="${newId}"`);
  }
}
