// App boot: site account (shared with the library), cloud sync, header, routing.

import { h, icon, clear, toast } from './ui.js';
import { CloudStore, siteAuth } from './cloud.js';
import { renderHome } from './home.js';
import { renderProjects } from './projectsview.js';
import { idb } from './idb.js';
import { Vault } from './vault.js';
import { renderPlanner } from './planner.js';
import { renderNotes, currentNoteEditor } from './notes.js';
import { renderSettings } from './settings.js';
import { projectDropdown } from './projects.js';

// Refuse to run inside a frame (clickjacking). GitHub Pages cannot send
// frame-ancestors / X-Frame-Options headers, so we do it here.
if (window.top !== window.self) {
  document.documentElement.textContent = 'This app cannot be shown inside another page.';
  throw new Error('framed');
}

const app = document.getElementById('app');
let vault = null;
let syncTimer = null;
let pendingRefresh = false;

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---------- known accounts (for opening offline) ----------
function knownAccounts() {
  try { return JSON.parse(localStorage.getItem('planner.accounts') || '[]'); } catch { return []; }
}
function rememberAccount(a) {
  try {
    const list = knownAccounts().filter((x) => x.id !== a.id);
    list.unshift({ id: a.id, email: a.email, name: a.name, mode: a.mode });
    localStorage.setItem('planner.accounts', JSON.stringify(list.slice(0, 5)));
  } catch { /* ignore */ }
}

// ---------- screens ----------
function screen(...kids) {
  clear(app);
  app.className = 'gate';
  app.append(h('div', { class: 'gate-card' }, h('div', { class: 'brand' }, h('span', { class: 'logo' }, icon('calendar')), 'My Planner'), ...kids));
}

/** Who is signed in to the site (shared with the library), or null when offline/not configured. */
async function siteSession() {
  try {
    const S = await siteAuth();
    if (!S.configured()) return { configured: false };
    return await new Promise((resolve) => {
      let off = null;
      S.onSession((sess) => { resolve({ configured: true, S, ...sess }); if (off) off(); })
        .then((u) => { off = u; }, () => resolve({ configured: false, offline: true }));
      setTimeout(() => resolve({ configured: true, S, user: null, timeout: true }), 8000);
    });
  } catch { return { configured: false, offline: true }; }
}

async function welcome(error) {
  const busy = (btn, fn) => async () => {
    btn.disabled = true;
    try { await fn(); } catch (e) { toast(e.message, 'error', 6000); btn.disabled = false; }
  };
  screen(h('p', { class: 'lead' }, 'Your notes and planner, on every device.'), h('p', { class: 'muted small' }, 'Checking your account…'));
  const sess = await siteSession();
  const local = h('button', { class: 'btn big' }, 'Use on this device only');
  local.addEventListener('click', busy(local, () => start({ id: 'local', email: '', name: 'This device', mode: 'local' })));
  const offline = knownAccounts().filter((a) => a.mode === 'cloud');

  let main;
  if (sess.configured && sess.user && sess.invited) {
    main = h('button', { class: 'btn primary big' }, `Open my planner (${sess.user.email})`);
    const u = sess.user;
    const go = () => start({ id: `f-${u.uid}`, uid: u.uid, email: u.email, name: u.displayName || u.email, mode: 'cloud' });
    main.addEventListener('click', busy(main, go));
    // Signed in and invited: open straight away (the button stays as a fallback if something fails).
    if (!error && !sessionStorage.getItem('planner.noauto')) setTimeout(() => main.click(), 0);
  } else if (sess.configured && sess.user) {
    main = h('div', { class: 'notice' }, h('strong', {}, 'Invite-only. '),
      `${sess.user.email} is not on the invite list yet. Ask Jaswin for an invite. You can still use the app on this device.`);
  } else if (sess.configured) {
    main = h('a', { class: 'btn primary big', href: sess.S.signInUrl() }, 'Sign in at the Library');
  } else {
    main = h('div', { class: 'notice' }, h('strong', {}, sess.offline ? 'Offline. ' : 'Accounts are not available here. '),
      'You can open a copy saved on this device, or use the app on this device only.');
  }

  screen(
    h('p', { class: 'lead' }, 'Your notes and planner, on every device.'),
    error && h('p', { class: 'error' }, error),
    main,
    sess.user && sess.invited && h('p', { class: 'muted small' }, `Signed in at the library as ${sess.user.email}.`),
    offline.length > 0 && h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'No internet? Open the copy saved on this device:'),
      offline.map((a) => {
        const b = h('button', { class: 'btn' }, `Open offline: ${a.email}`);
        b.addEventListener('click', busy(b, () => start(a)));
        return b;
      })),
    local,
    h('ul', { class: 'points' },
      h('li', {}, 'One account for the whole site: sign in at the library (invite-only). No Google Drive needed.'),
      h('li', {}, 'Your notes, plans and files are encrypted in this browser before they are saved, and sync through the site\'s database, readable only by your account.'),
      h('li', {}, 'Turn on 2-Step Verification for your Google account: it is the key to your data.'),
      h('li', {}, 'No server, no tracking, no ads.')),
  );
}

/**
 * First time on cloud sync: bring along this browser's copy from the earlier Google Drive setup
 * (same email), so nothing typed before is lost. The copy is re-encrypted nowhere: the same key
 * and ciphertext move to the new account's slot, and the first sync uploads them.
 */
async function adoptEarlierCopy(account) {
  const to = `acct:${account.id}:`;
  if (await idb.get(to + 'planner-key.json')) return;
  const prev = knownAccounts().find((a) => a.mode === 'google' && a.email === account.email);
  if (!prev) return;
  const from = `acct:${prev.id}:`;
  for (const k of await idb.keys(from)) {
    const v = await idb.get(k);
    if (v !== undefined) await idb.set(to + k.slice(from.length), v);
    if (k.slice(from.length).startsWith('blob:')) await idb.set(to + 'up:' + k.slice(from.length + 5), 1);
  }
}

async function start(account) {
  const remote = account.mode === 'cloud' && navigator.onLine ? new CloudStore(account.uid) : null;
  if (account.mode === 'cloud') await adoptEarlierCopy(account).catch(() => {});
  vault = new Vault(account, remote);
  await vault.open();
  if (!remote && account.mode === 'cloud') vault.remote = null; // offline: changes stay on this device
  rememberAccount(account);
  enterApp();
}

// ---------- main app ----------
let view, statusPill, ddSlot;

function enterApp() {
  clear(app);
  app.className = 'shell';
  statusPill = h('button', { class: 'status', onclick: onStatusClick }, icon('sync'), h('span', {}, ''));
  const nav = h('nav', { class: 'tabs' },
    h('a', { href: '#/home', dataset: { tab: 'home' } }, icon('home'), h('span', {}, 'Home')),
    h('a', { href: '#/planner', dataset: { tab: 'planner' } }, icon('calendar'), h('span', {}, 'Calendar')),
    h('a', { href: '#/projects', dataset: { tab: 'projects' } }, icon('folder'), h('span', {}, 'Projects')),
    h('a', { href: '#/notes', dataset: { tab: 'notes' } }, icon('note'), h('span', {}, 'Notes')));
  view = h('div', { class: 'view' });
  ddSlot = h('div', { class: 'dd-slot' });
  app.append(
    h('header', { class: 'top' },
      h('div', { class: 'brand small' }, h('span', { class: 'logo' }, icon('calendar')), h('span', { class: 'bname' }, 'My Planner')),
      nav, ddSlot, h('span', { class: 'grow' }), statusPill,
      h('a', { class: 'icon-btn', href: '#/settings', title: 'Settings', 'aria-label': 'Settings', dataset: { tab: 'settings' } }, icon('gear')),
      h('button', { class: 'icon-btn', title: 'Sign out', 'aria-label': 'Sign out', onclick: signOut }, icon('logout'))),
    view);

  vault.addEventListener('status', drawStatus);
  vault.addEventListener('change', refresh);
  drawStatus();
  if (!location.hash || location.hash === '#') location.hash = '#/home';
  route();
  vault.sync();
  clearInterval(syncTimer);
  syncTimer = setInterval(() => { if (document.visibilityState === 'visible') vault?.sync(); }, 60_000);
}

function drawProjectDropdown(name) {
  if (!ddSlot || !vault?.dek) return;
  clear(ddSlot);
  // The project filter applies to Calendar and Notes; Home and Projects show everything.
  if (name === 'planner' || name === 'notes') ddSlot.append(projectDropdown(vault));
}

function route() {
  if (!vault?.dek || !view) return;
  const [, name = 'home', arg] = location.hash.split('/');
  drawProjectDropdown(name);
  for (const a of app.querySelectorAll('[data-tab]')) a.classList.toggle('on', a.dataset.tab === name);
  pendingRefresh = false;
  view.dataset.view = name;
  if (name === 'notes') renderNotes(view, vault, { openId: arg || null });
  else if (name === 'settings') renderSettings(view, vault, { onSignOut: signOut });
  else if (name === 'planner') renderPlanner(view, vault);
  else if (name === 'projects') renderProjects(view, vault, { openId: arg || null });
  else renderHome(view, vault);
}

/** Re-render after a sync brought in changes, without disturbing typing. */
function refresh() {
  const busy = document.querySelector('dialog[open]') || document.activeElement?.closest?.('.rte, input, textarea, select');
  if (busy) { pendingRefresh = true; return; }
  route();
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRefresh && !document.querySelector('dialog[open]')) refresh(); }, 50));
document.addEventListener('close', () => setTimeout(() => { if (pendingRefresh) refresh(); }, 50), true);

const LABEL = { synced: 'Synced', syncing: 'Syncing…', offline: 'Offline', auth: 'Reconnect', error: 'Sync error', local: 'This device', idle: '' };
function drawStatus() {
  if (!statusPill || !vault) return;
  const s = vault.status;
  statusPill.className = `status st-${s.state}`;
  statusPill.title = s.msg || '';
  statusPill.lastChild.textContent = LABEL[s.state] ?? s.state;
}

async function onStatusClick() {
  if (vault.status.state === 'auth') {
    const S = await siteAuth().catch(() => null);
    if (S) { location.href = S.signInUrl(); return; }
  }
  if (vault.account.mode === 'cloud' && !vault.remote && navigator.onLine) vault.remote = new CloudStore(vault.account.uid);
  if (vault.status.state === 'error') toast(vault.status.msg, 'error', 6000);
  vault.sync();
}

async function signOut() {
  if (vault?.dek) {
    currentNoteEditor()?.editor.flush();
    await vault.saveLocal().catch(() => {});
    if (vault.remote) await vault.sync();
    vault.lock();
  }
  try { sessionStorage.setItem('planner.noauto', '1'); } catch { /* ignore */ }
  location.hash = '';
  location.reload();
}

window.addEventListener('hashchange', () => { currentNoteEditor()?.editor.flush(); route(); });
window.addEventListener('online', () => {
  if (vault?.account.mode === 'cloud' && !vault.remote) vault.remote = new CloudStore(vault.account.uid);
  vault?.sync();
});
window.addEventListener('projectchange', () => { currentNoteEditor()?.editor.flush(); route(); });
window.addEventListener('focus', () => vault?.dek && vault.sync());

window.addEventListener('pagehide', () => currentNoteEditor()?.editor.flush());

welcome();
