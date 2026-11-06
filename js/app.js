// App boot: sign-in, vault create/unlock, header, routing, auto-lock.

import { h, icon, clear, toast, modal } from './ui.js';
import { googleConfigured, getToken, userInfo, hasToken, signOutGoogle, DriveStore } from './google.js';
import { Vault } from './vault.js';
import { renderPlanner } from './planner.js';
import { renderNotes, currentNoteEditor } from './notes.js';
import { renderSettings } from './settings.js';
import { getPref } from './prefs.js';

// Refuse to run inside a frame (clickjacking). GitHub Pages cannot send
// frame-ancestors / X-Frame-Options headers, so we do it here.
if (window.top !== window.self) {
  document.documentElement.textContent = 'This app cannot be shown inside another page.';
  throw new Error('framed');
}

const app = document.getElementById('app');
let vault = null;
let idleTimer = null;
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

function welcome(error) {
  const busy = (btn, fn) => async () => {
    btn.disabled = true;
    try { await fn(); } catch (e) { toast(e.message, 'error', 6000); btn.disabled = false; }
  };
  const gbtn = h('button', { class: 'btn primary big google' }, h('span', { class: 'g' }, 'G'), 'Sign in with Google');
  gbtn.addEventListener('click', busy(gbtn, async () => {
    await getToken({ interactive: true });
    const u = await userInfo();
    await start({ id: `g-${u.sub}`, email: u.email, name: u.name, mode: 'google' });
  }));
  const local = h('button', { class: 'btn big' }, 'Use on this device only');
  local.addEventListener('click', busy(local, () => start({ id: 'local', email: '', name: 'This device', mode: 'local' })));
  const offline = knownAccounts().filter((a) => a.mode === 'google');

  screen(
    h('p', { class: 'lead' }, 'Notes and planner, end-to-end encrypted.'),
    error && h('p', { class: 'error' }, error),
    googleConfigured() ? gbtn : h('div', { class: 'notice' },
      h('strong', {}, 'Google sign-in is not set up yet. '),
      'Add your OAuth client ID to js/config.js (see README). You can still use the app on this device.'),
    offline.length > 0 && h('div', { class: 'stack' }, h('p', { class: 'muted small' }, 'No internet? Open the copy saved on this device:'),
      offline.map((a) => {
        const b = h('button', { class: 'btn' }, `Open offline: ${a.email}`);
        b.addEventListener('click', busy(b, () => start(a)));
        return b;
      })),
    local,
    h('ul', { class: 'points' },
      h('li', {}, 'Everything is encrypted in your browser with your passphrase before it is saved or synced.'),
      h('li', {}, 'With Google, the encrypted data is kept in a hidden app folder in your own Drive. The app cannot see any of your other files.'),
      h('li', {}, 'No server, no tracking, no ads.')),
  );
}

async function start(account) {
  const remote = account.mode === 'google' ? new DriveStore() : null;
  vault = new Vault(account, remote);
  if (remote && !hasToken()) vault.remote = null; // offline open: connect later
  let meta;
  try { meta = await vault.loadMeta(); } finally { if (remote) vault.remote = remote; }
  rememberAccount(account);
  if (!meta) {
    if (account.mode === 'google' && !hasToken()) throw new Error('This account has no copy on this device yet. Sign in while online first.');
    return createScreen();
  }
  unlockScreen();
}

function passField(label, autocomplete) {
  const input = h('input', { type: 'password', required: true, minlength: 10, autocomplete });
  const toggle = h('button', { type: 'button', class: 'icon-btn eye', 'aria-label': 'Show passphrase', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; } }, '👁');
  return { input, el: h('label', { class: 'field' }, h('span', {}, label), h('div', { class: 'pw' }, input, toggle)) };
}

function strength(p) {
  let s = 0;
  if (p.length >= 10) s++;
  if (p.length >= 14) s++;
  if (p.length >= 20) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(s, 4);
}

function createScreen() {
  const a = passField('Choose a passphrase (10+ characters)', 'new-password');
  const b = passField('Type it again', 'new-password');
  const meter = h('div', { class: 'meter' }, h('span'));
  const hint = h('p', { class: 'muted small' }, 'Tip: four or five random words, like "cactus-violin-harbor-ninety".');
  a.input.addEventListener('input', () => { meter.dataset.s = String(a.input.value ? strength(a.input.value) : 0); });
  const err = h('p', { class: 'error' });
  const btn = h('button', { class: 'btn primary big' }, 'Create my encrypted vault');
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (a.input.value.length < 10) { err.textContent = 'Use at least 10 characters.'; return; }
    if (a.input.value !== b.input.value) { err.textContent = 'The two passphrases are different.'; return; }
    if (strength(a.input.value) < 2) { err.textContent = 'That passphrase is too easy to guess. Make it longer.'; return; }
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const code = await vault.create(a.input.value);
      a.input.value = b.input.value = '';
      showRecoveryScreen(code);
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Create my encrypted vault'; }
  } }, a.el, meter, hint, b.el, err, btn);
  screen(
    h('h1', {}, 'Create your vault'),
    h('p', {}, vault.account.mode === 'google' ? `Signed in as ${vault.account.email}.` : 'Data stays on this device only.'),
    h('p', { class: 'notice' }, 'Your passphrase encrypts everything. It is never sent anywhere, so it cannot be reset by email. You will get a recovery code next. Keep both safe.'),
    form);
  a.input.focus();
}

function recoveryBlock(code) {
  return h('div', { class: 'stack' },
    h('code', { class: 'recovery' }, code),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Copied'); } catch { toast('Copy failed. Write it down instead.', 'error'); } } }, 'Copy'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        const url = URL.createObjectURL(new Blob([`My Planner recovery code\n${vault.account.email || 'this device'}\n\n${code}\n\nKeep this private. It can unlock all your data.\n`], { type: 'text/plain' }));
        const a = h('a', { href: url, download: 'planner-recovery-code.txt' }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } }, icon('download'), 'Download'),
      h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Print')));
}

function showRecoveryScreen(code) {
  const ok = h('input', { type: 'checkbox' });
  const go = h('button', { class: 'btn primary big', disabled: true, onclick: () => enterApp() }, 'Open my planner');
  ok.addEventListener('change', () => { go.disabled = !ok.checked; });
  screen(
    h('h1', {}, 'Save your recovery code'),
    h('p', {}, 'If you forget your passphrase, this code is the ONLY way back in. Store it offline (paper, password manager).'),
    recoveryBlock(code),
    h('label', { class: 'check' }, ok, 'I have saved my recovery code'),
    go);
}

function unlockScreen(msg) {
  let useRecovery = false;
  const p = passField('Passphrase', 'current-password');
  const err = h('p', { class: 'error' }, msg || '');
  const btn = h('button', { class: 'btn primary big' }, 'Unlock');
  const switcher = h('button', { type: 'button', class: 'link', onclick: () => {
    useRecovery = !useRecovery;
    p.el.querySelector('span').textContent = useRecovery ? 'Recovery code' : 'Passphrase';
    p.input.autocomplete = useRecovery ? 'off' : 'current-password';
    p.input.removeAttribute('minlength');
    switcher.textContent = useRecovery ? 'Use passphrase instead' : 'Forgot passphrase? Use recovery code';
    p.input.value = ''; p.input.focus();
  } }, 'Forgot passphrase? Use recovery code');
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Unlocking…'; err.textContent = '';
    try {
      await vault.unlock(p.input.value, { recovery: useRecovery });
      const secret = p.input.value; p.input.value = '';
      if (useRecovery) return resetAfterRecovery(secret);
      enterApp();
    } catch (ex) {
      err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Unlock'; p.input.select();
    }
  } }, p.el, err, btn, switcher);
  screen(
    h('h1', {}, 'Unlock'),
    h('p', { class: 'muted' }, vault.account.mode === 'google' ? vault.account.email : 'This device'),
    form,
    h('button', { class: 'link', onclick: () => signOut() }, 'Use a different account'));
  p.input.focus();
}

function resetAfterRecovery(code) {
  const a = passField('New passphrase (10+ characters)', 'new-password');
  const b = passField('Type it again', 'new-password');
  const err = h('p', { class: 'error' });
  screen(h('h1', {}, 'Set a new passphrase'), h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    if (a.input.value !== b.input.value) { err.textContent = 'The two passphrases are different.'; return; }
    try { await vault.changePassphrase(code, a.input.value, { recovery: true }); toast('Passphrase changed.', 'ok'); enterApp(); } catch (ex) { err.textContent = ex.message; }
  } }, a.el, b.el, err, h('button', { class: 'btn primary big' }, 'Save')));
  a.input.focus();
}

// ---------- main app ----------
let view, statusPill;

function enterApp() {
  clear(app);
  app.className = 'shell';
  statusPill = h('button', { class: 'status', onclick: onStatusClick }, icon('sync'), h('span', {}, ''));
  const nav = h('nav', { class: 'tabs' },
    h('a', { href: '#/planner', dataset: { tab: 'planner' } }, icon('calendar'), h('span', {}, 'Planner')),
    h('a', { href: '#/notes', dataset: { tab: 'notes' } }, icon('note'), h('span', {}, 'Notes')));
  view = h('div', { class: 'view' });
  app.append(
    h('header', { class: 'top' },
      h('div', { class: 'brand small' }, h('span', { class: 'logo' }, icon('calendar')), h('span', { class: 'bname' }, 'My Planner')),
      nav, h('span', { class: 'grow' }), statusPill,
      h('a', { class: 'icon-btn', href: '#/settings', title: 'Settings', 'aria-label': 'Settings', dataset: { tab: 'settings' } }, icon('gear')),
      h('button', { class: 'icon-btn', title: 'Lock now', 'aria-label': 'Lock', onclick: lock }, icon('lock'))),
    view);

  vault.addEventListener('status', drawStatus);
  vault.addEventListener('change', refresh);
  drawStatus();
  if (!location.hash || location.hash === '#') location.hash = '#/planner';
  route();
  vault.sync();
  clearInterval(syncTimer);
  syncTimer = setInterval(() => { if (document.visibilityState === 'visible') vault?.sync(); }, 60_000);
  resetIdle();
}

function route() {
  if (!vault?.dek || !view) return;
  const [, name = 'planner', arg] = location.hash.split('/');
  for (const a of app.querySelectorAll('[data-tab]')) a.classList.toggle('on', a.dataset.tab === name);
  pendingRefresh = false;
  if (name === 'notes') renderNotes(view, vault, { openId: arg || null });
  else if (name === 'settings') renderSettings(view, vault, { onSignOut: signOut, showRecovery: (c) => modal('New recovery code', h('div', { class: 'stack' }, h('p', {}, 'Your old recovery code no longer works. Save this one.'), recoveryBlock(c))) });
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

function lock() {
  if (!vault) return;
  currentNoteEditor()?.editor.flush();
  for (const d of document.querySelectorAll('dialog')) d.close();
  vault.saveLocal().finally(() => {
    vault.removeEventListener('status', drawStatus);
    vault.removeEventListener('change', refresh);
    vault.lock();
    clearInterval(syncTimer);
    view = null;
    unlockScreen('Locked.');
  });
}

async function signOut() {
  if (vault?.dek) { currentNoteEditor()?.editor.flush(); await vault.saveLocal().catch(() => {}); vault.lock(); }
  await signOutGoogle().catch(() => {});
  location.hash = '';
  location.reload();
}

function resetIdle() {
  clearTimeout(idleTimer);
  if (!vault?.dek) return;
  idleTimer = setTimeout(lock, getPref('autoLockMinutes') * 60_000);
}
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, resetIdle, { passive: true });

window.addEventListener('hashchange', () => { currentNoteEditor()?.editor.flush(); route(); });
window.addEventListener('online', () => vault?.sync());
window.addEventListener('focus', () => vault?.dek && vault.sync());
window.addEventListener('pagehide', () => currentNoteEditor()?.editor.flush());

welcome();
