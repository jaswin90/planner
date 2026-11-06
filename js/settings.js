// Settings (opened from the gear icon): notebooks/projects, security,
// backup, and deleting data.

import { h, icon, clear, toast, confirmDialog, promptDialog, pickFiles } from './ui.js';
import { liveItems } from './model.js';
import { replaceRecoveryCode, b64, unb64 } from './crypto.js';
import { getPref, setPref } from './prefs.js';

const COLORS = ['#e8a33d', '#d9534f', '#5b9bd5', '#4caf7d', '#9b6fd1', '#e06fa8', '#3fb5b0', '#8a8f98'];

export function renderSettings(root, vault, { onSignOut, showRecovery }) {
  clear(root);
  const rerender = () => renderSettings(root, vault, { onSignOut, showRecovery });
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

    card('Security',
      h('p', { class: 'muted small' }, 'Your passphrase never leaves this device. Without it (or the recovery code) nobody, including Google and the app author, can read your data.'),
      h('label', { class: 'field inline' }, h('span', {}, 'Lock automatically after'),
        h('select', { onchange: (e) => { setPref('autoLockMinutes', Number(e.target.value)); toast('Saved'); } },
          [5, 15, 30, 60, 240].map((m) => h('option', { value: m, selected: getPref('autoLockMinutes') === m }, `${m} minutes idle`)))),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => changePass(vault) }, 'Change passphrase'),
        h('button', { class: 'btn', onclick: async () => {
          const pass = await promptDialog('New recovery code', { label: 'Enter your passphrase', type: 'password' });
          if (!pass) return;
          try {
            const { meta, recoveryCode } = await replaceRecoveryCode(vault.meta, pass);
            await vault.saveMeta(meta);
            showRecovery(recoveryCode);
          } catch (e) { toast(e.message, 'error'); }
        } }, 'Make a new recovery code'))),

    card('Backup',
      h('p', { class: 'muted small' }, 'Download a copy of everything (tasks, notes and files). The backup file is NOT encrypted, so keep it somewhere safe.'),
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

async function changePass(vault) {
  const old = await promptDialog('Change passphrase', { label: 'Current passphrase', type: 'password' });
  if (!old) return;
  const next = await promptDialog('Change passphrase', { label: 'New passphrase (at least 10 characters)', type: 'password' });
  if (!next) return;
  const again = await promptDialog('Change passphrase', { label: 'Type the new passphrase again', type: 'password' });
  if (next !== again) return toast('The passphrases do not match.', 'error');
  try { await vault.changePassphrase(old, next); toast('Passphrase changed on all devices.', 'ok'); } catch (e) { toast(e.message, 'error'); }
}

async function exportAll(vault) {
  if (!await confirmDialog('The backup file will be readable by anyone who gets it. Continue?', { ok: 'Export' })) return;
  const files = {};
  for (const a of liveItems(vault.doc, 'att')) {
    try {
      const url = await vault.attachmentUrl(a.id);
      files[a.id] = b64(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    } catch { /* not available on this device yet */ }
  }
  const out = JSON.stringify({ app: 'planner', exportedAt: new Date().toISOString(), doc: vault.doc, files });
  const url = URL.createObjectURL(new Blob([out], { type: 'application/json' }));
  const a = h('a', { href: url, download: `planner-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importAll(vault, after) {
  const [file] = await pickFiles({ accept: 'application/json,.json', multiple: false });
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
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
