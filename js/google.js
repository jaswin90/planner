// Google Drive access through the site-wide account (jaswin90.github.io).
//
// The Planner no longer has its own Google sign-in. People sign in once at /library/
// (invite-only, shared with the books); the Planner then asks Google, through that same
// account, for a short-lived token for one scope: drive.appdata. That scope lets the app see
// nothing in your Drive except its own hidden app folder. The token lives in memory only.

const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

let token = null; // { access_token, expiresAt }
let pending = null;
let site = null;

/** The site's shared account module (served by jaswin90.github.io, not by this repo). */
export async function siteAuth() {
  if (!site) site = import('/assets/js/site-auth.js').catch((e) => { site = null; throw e; });
  return site;
}

export async function googleConfigured() {
  try { return (await siteAuth()).configured(); } catch { return false; }
}

/** Get a Drive token for the signed-in site account. Needs a click (it may open Google's popup). */
export async function getToken({ interactive = true, hint, chooseAccount = false } = {}) {
  if (token && token.expiresAt - Date.now() > 60_000) return token.access_token;
  if (!interactive) throw Object.assign(new Error('Google session expired. Click "Reconnect".'), { code: 'auth' });
  if (pending) return pending;
  pending = (async () => {
    const S = await siteAuth();
    const { A, auth } = await S.firebase();
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in at the library first.');
    const provider = new A.GoogleAuthProvider();
    provider.addScope(SCOPE_DRIVE);
    provider.setCustomParameters(chooseAccount ? { prompt: 'select_account' } : { login_hint: hint || user.email || '' });
    const hasGoogle = (user.providerData || []).some((p) => p.providerId === 'google.com');
    let result;
    try {
      result = hasGoogle ? await A.reauthenticateWithPopup(user, provider) : await A.linkWithPopup(user, provider);
    } catch (e) {
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') throw new Error('Google window was closed.');
      if (e?.code === 'auth/user-mismatch') throw new Error(`Please choose the Google account ${user.email}.`);
      if (e?.code === 'auth/credential-already-in-use') throw new Error('That Google account already belongs to another library account. Sign in with it at the library instead.');
      throw new Error(e?.message || 'Google sign-in failed.');
    }
    const cred = A.GoogleAuthProvider.credentialFromResult(result);
    if (!cred?.accessToken) throw new Error('Google did not return Drive access. Please try again.');
    const info = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(cred.accessToken), { referrerPolicy: 'no-referrer' })
      .then((r) => r.json()).catch(() => ({}));
    if (info.scope && !String(info.scope).split(' ').includes(SCOPE_DRIVE)) {
      throw new Error('Please allow the app to use its private Drive folder (needed for sync).');
    }
    token = { access_token: cred.accessToken, expiresAt: Date.now() + Number(info.expires_in || 3300) * 1000 };
    return token.access_token;
  })().finally(() => { pending = null; });
  return pending;
}

export function hasToken() {
  return !!token && token.expiresAt > Date.now();
}

/** Forget the Drive token (the site account stays signed in; sign out of it at /library/). */
export async function signOutGoogle() {
  token = null;
}

// Only ever uses a token we already hold; refreshing it needs a user click
// (popups opened without a click are blocked by browsers).
async function gfetch(url, opts = {}) {
  if (!hasToken()) throw Object.assign(new Error('Google session expired. Click "Reconnect".'), { code: 'auth' });
  const t = token.access_token;
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` },
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
  });
  if (res.status === 401) { token = null; throw Object.assign(new Error('Google session expired. Click "Reconnect".'), { code: 'auth' }); }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`Google API ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
  }
  return res;
}

export async function userInfo() {
  const res = await gfetch('https://www.googleapis.com/oauth2/v3/userinfo');
  const u = await res.json();
  return { sub: u.sub, email: u.email, name: u.name || u.email };
}

/** Storage backend on Drive's appDataFolder. Names are opaque file names. */
export class DriveStore {
  constructor() { this.ids = new Map(); }

  async find(name) {
    if (this.ids.has(name)) return this.ids.get(name);
    const q = encodeURIComponent(`name = '${name.replace(/[^a-zA-Z0-9._-]/g, '')}' and trashed = false`);
    const res = await gfetch(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,version)&pageSize=10`);
    const { files } = await res.json();
    const f = files?.[0] || null;
    if (f) this.ids.set(name, f);
    return f;
  }

  async version(name) {
    const f = await this.find(name);
    if (!f) return null;
    const res = await gfetch(`${API}/files/${f.id}?fields=id,version`);
    const j = await res.json();
    return j.version;
  }

  /** Returns { bytes: Uint8Array, version } or null. */
  async get(name) {
    const f = await this.find(name);
    if (!f) return null;
    try {
      const res = await gfetch(`${API}/files/${f.id}?alt=media`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const version = await this.version(name);
      return { bytes, version };
    } catch (e) {
      if (e.status === 404) { this.ids.delete(name); return null; }
      throw e;
    }
  }

  async put(name, bytes, mime = 'application/octet-stream') {
    const f = await this.find(name);
    let res;
    if (f) {
      res = await gfetch(`${UPLOAD}/files/${f.id}?uploadType=media&fields=id,version`, {
        method: 'PATCH', headers: { 'Content-Type': mime }, body: bytes,
      });
    } else {
      const boundary = 'planner' + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
      const head = new TextEncoder().encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
      const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
      res = await gfetch(`${UPLOAD}/files?uploadType=multipart&fields=id,name,version`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: new Blob([head, bytes, tail]),
      });
    }
    const j = await res.json();
    this.ids.set(name, { id: j.id, name });
    return j.version;
  }

  async del(name) {
    const f = await this.find(name);
    if (!f) return;
    await gfetch(`${API}/files/${f.id}`, { method: 'DELETE' }).catch((e) => { if (e.status !== 404) throw e; });
    this.ids.delete(name);
  }

  /** Delete every file in the app folder (used by "Delete all my data"). */
  async wipe() {
    let pageToken = '';
    do {
      const res = await gfetch(`${API}/files?spaces=appDataFolder&fields=nextPageToken,files(id)&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`);
      const j = await res.json();
      for (const f of j.files || []) await gfetch(`${API}/files/${f.id}`, { method: 'DELETE' }).catch(() => {});
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    this.ids.clear();
  }
}
