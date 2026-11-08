// App boot: site account (shared with the library), Drive connection, header, routing.

import { h, icon, clear, toast } from './ui.js';
import { getToken, userInfo, hasToken, signOutGoogle, DriveStore, siteAuth } from './google.js';
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
  const offline = knownAccounts().filter((a) => a.mode === 'google');

  let main;
  if (sess.configured && sess.user && sess.invited) {
    const known = offline.find((a) => a.email === sess.user.email);
    main = h('button', { class: 'btn primary big google' }, h('span', { class: 'g' }, 'G'), known ? `Continue as ${sess.user.email}` : 'Connect Google Drive');
    main.addEventListener('click', busy(main, async () => {
      await getToken({ interactive: true, hint: sess.user.email });
      const u = await userInfo();
      await start({ id: `g-${u.sub}`, email: u.email, name: u.name, mode: 'google' });
    }));
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
    sess.user && sess.invited && h('p', { class: 'muted small' }, `Signed in at the library as ${sess.user.email}. The first time, Google asks once to let the app use its private Drive folder.`),
    offline.length > 0 && h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'No internet? Open the copy saved on this device:'),
      offline.map((a) => {
        const b = h('button', { class: 'btn' }, `Open offline: ${a.email}`);
        b.addEventListener('click', busy(b, () => start(a)));
        return b;
      })),
    local,
    h('ul', { class: 'points' },
      h('li', {}, 'One account for the whole site: sign in at the library (invite-only), then connect Google Drive once.'),
      h('li', {}, 'Your notes and plans sync through a private, hidden app folder in your own Drive. The app cannot see any of your other files.'),
      h('li', {}, 'Files are stored encrypted. Turn on 2-Step Verification for your Google account: it is the key to your data.'),
      h('li', {}, 'No server, no tracking, no ads.')),
  );
}

async function start(account) {
  const remote = account.mode === 'google' ? new DriveStore() : null;
  vault = new Vault(account, remote);
  if (remote && !hasToken()) vault.remote = null; // offline open: connect later
  try { await vault.open(); } finally { if (remote) vault.remote = remote; }
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
    h('a', { href: '#/planner', dataset: { tab: 'planner' } }, icon('calendar'), h('span', {}, 'Planner')),
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
  if (!location.hash || location.hash === '#') location.hash = '#/planner';
  route();
  vault.sync();
  clearInterval(syncTimer);
  syncTimer = setInterval(() => { if (document.visibilityState === 'visible') vault?.sync(); }, 60_000);
}

function drawProjectDropdown() {
  if (ddSlot && vault?.dek) clear(ddSlot).append(projectDropdown(vault));
}

function route() {
  if (!vault?.dek || !view) return;
  drawProjectDropdown();
  const [, name = 'planner', arg] = location.hash.split('/');
  for (const a of app.querySelectorAll('[data-tab]')) a.classList.toggle('on', a.dataset.tab === name);
  pendingRefresh = false;
  if (name === 'notes') renderNotes(view, vault, { openId: arg || null });
  else if (name === 'settings') renderSettings(view, vault, { onSignOut: signOut });
  else renderPlanner(view, vault);
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
  if (vault.status.state === 'auth' || (vault.account.mode === 'google' && !hasToken())) {
    try { await getToken({ interactive: true, hint: vault.account.email }); const u = await userInfo();
      if (`g-${u.sub}` !== vault.account.id) { await signOutGoogle(); toast('That is a different Google account. Please pick ' + vault.account.email, 'error', 6000); return; }
    } catch (e) { toast(e.message, 'error'); return; }
  }
  if (vault.status.state === 'error') toast(vault.status.msg, 'error', 6000);
  vault.sync();
}

async function signOut() {
  if (vault?.dek) {
    currentNoteEditor()?.editor.flush();
    await vault.saveLocal().catch(() => {});
    if (vault.remote && hasToken()) await vault.sync();
    vault.lock();
  }
  await signOutGoogle().catch(() => {});
  location.hash = '';
  location.reload();
}

window.addEventListener('hashchange', () => { currentNoteEditor()?.editor.flush(); route(); });
window.addEventListener('online', () => vault?.sync());
window.addEventListener('projectchange', () => { currentNoteEditor()?.editor.flush(); route(); });
window.addEventListener('focus', () => vault?.dek && vault.sync());

window.addEventListener('pagehide', () => currentNoteEditor()?.editor.flush());

welcome();
