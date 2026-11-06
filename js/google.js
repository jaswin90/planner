// Google sign-in (Google Identity Services token model) and Drive storage.
//
// Scope is drive.appdata only: the app can see nothing in your Drive except
// its own hidden app folder, and the app folder is invisible in the Drive UI.
// The access token lives in memory only; it is never written to storage.

import { CONFIG } from './config.js';

const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

let tokenClient = null;
let token = null; // { access_token, expiresAt }
let pending = null;
let gisLoaded = null;

export function googleConfigured() {
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(CONFIG.googleClientId || '');
}

function loadGis() {
  if (!gisLoaded) {
    gisLoaded = new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisLoaded = null; reject(new Error('Could not load Google sign-in. Are you online?')); };
      document.head.appendChild(s);
    });
  }
  return gisLoaded;
}

/** Ask Google for an access token. `interactive` = allow showing the consent popup. */
export async function getToken({ interactive = true, hint, chooseAccount = false } = {}) {
  if (token && token.expiresAt - Date.now() > 60_000) return token.access_token;
  if (pending) return pending;
  await loadGis();
  pending = new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope: SCOPES,
      hint,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, 'https://www.googleapis.com/auth/drive.appdata')) {
          return reject(new Error('Please allow the app to use its private Drive folder (needed for sync).'));
        }
        token = { access_token: resp.access_token, expiresAt: Date.now() + Number(resp.expires_in || 3600) * 1000 };
        resolve(token.access_token);
      },
      error_callback: (err) => reject(new Error(err?.type === 'popup_closed' ? 'Sign-in window was closed.' : (err?.message || 'Sign-in failed.'))),
    });
    tokenClient.requestAccessToken({ prompt: chooseAccount ? 'select_account' : interactive ? '' : 'none' });
  }).finally(() => { pending = null; });
  return pending;
}

export function hasToken() {
  return !!token && token.expiresAt > Date.now();
}

export async function signOutGoogle() {
  if (token && window.google?.accounts?.oauth2) {
    await new Promise((r) => window.google.accounts.oauth2.revoke(token.access_token, r));
  }
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
