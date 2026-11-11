// The vault: owns the key, the decrypted document, the local encrypted
// cache (IndexedDB) and sync with the site's cloud store (Firestore, see cloud.js).
//
// Storage layout (both local cache and cloud store):
//   planner-key.json  the account's random AES key (created on first sign-in)
//   planner-data.bin  AES-GCM(document JSON), AAD "doc"
//   att-<id>.bin      AES-GCM(file bytes),    AAD "att:<id>"
// Your account protects the key; files at rest are ciphertext.

import * as C from './crypto.js';
import { idb } from './idb.js';
import { emptyDoc, mergeDocs, newId } from './model.js';

const KEY = 'planner-key.json';
const DOC = 'planner-data.bin';
const attName = (id) => `att-${id}.bin`;

function deviceId() {
  try {
    let d = localStorage.getItem('planner.device');
    if (!d) { d = newId().slice(0, 8); localStorage.setItem('planner.device', d); }
    return d;
  } catch { return 'nodev'; }
}

export class Vault extends EventTarget {
  /** account: { id, uid, email, name, mode: 'cloud'|'local' }, remote: CloudStore|null */
  constructor(account, remote) {
    super();
    this.account = account;
    this.remote = remote;
    this.p = `acct:${account.id}:`;
    this.dek = null;
    this.meta = null;
    this.doc = emptyDoc();
    this.dev = deviceId();
    this.counter = 0;
    this.urls = new Map();
    this.queue = Promise.resolve();
    this.pushTimer = null;
    this.status = { state: 'idle' };
  }

  setStatus(state, msg = '') {
    this.status = { state, msg, at: Date.now() };
    this.dispatchEvent(new CustomEvent('status', { detail: this.status }));
  }

  get online() { return !!this.remote && navigator.onLine; }

  /**
   * Get the account key (the cloud copy wins, so every device uses the same one),
   * creating it on first use, then load the local cached document.
   */
  async open() {
    let keyB64 = await idb.get(this.p + KEY);
    if (this.remote) {
      const r = await this.remote.get(KEY);
      if (r) {
        const remoteKey = JSON.parse(new TextDecoder().decode(r.bytes)).k;
        if (remoteKey !== keyB64) await idb.del(this.p + DOC); // cache made with another key
        keyB64 = remoteKey;
      } else if (!keyB64) {
        keyB64 = C.newKeyB64();
        await this.remote.put(KEY, new TextEncoder().encode(JSON.stringify({ v: 2, k: keyB64 })), 'application/json');
      } else {
        // The cloud store is empty: upload this device's key so its data can sync back.
        await this.remote.put(KEY, new TextEncoder().encode(JSON.stringify({ v: 2, k: keyB64 })), 'application/json');
      }
    } else if (!keyB64) {
      if (this.account.mode === 'cloud') throw new Error('Nothing saved on this device yet. Open the planner once while online first.');
      keyB64 = C.newKeyB64();
    }
    await idb.set(this.p + KEY, keyB64);
    this.dek = await C.importKey(keyB64);
    const local = await idb.get(this.p + DOC);
    try { this.doc = local ? await C.decryptJson(this.dek, local, 'doc') : emptyDoc(); } catch { this.doc = emptyDoc(); }
  }

  /** Does this browser hold a copy for this account? */
  async hasLocalCopy() {
    return !!(await idb.get(this.p + KEY));
  }

  /** Forget the key and every decrypted byte held by this object. */
  lock() {
    clearTimeout(this.pushTimer);
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    this.urls.clear();
    this.dek = null;
    this.doc = emptyDoc();
  }

  // ---------- document edits ----------

  stamp(item) {
    item.updatedAt = Math.max(Date.now(), (item.updatedAt || 0) + 1);
    item.rev = `${this.dev}:${++this.counter}`;
    return item;
  }

  get(id) { const it = this.doc.items[id]; return it && !it.deleted ? it : null; }

  put(item) {
    if (!item.id) item.id = newId();
    if (!item.createdAt) item.createdAt = Date.now();
    this.doc.items[item.id] = this.stamp({ ...item });
    this.changed();
    return this.doc.items[item.id];
  }

  update(id, patch) {
    const cur = this.get(id);
    if (!cur) return null;
    return this.put({ ...cur, ...patch });
  }

  remove(id) {
    const cur = this.doc.items[id];
    if (!cur) return;
    for (const a of cur.attachments || []) this.removeAttachment(a, false);
    this.doc.items[id] = this.stamp({ id, type: cur.type, deleted: true });
    this.changed();
  }

  changed() {
    this.dirty = true;
    this.saveLocal().catch((e) => this.setStatus('error', e.message));
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.sync(), 1500);
  }

  async saveLocal() {
    if (!this.dek) return;
    await idb.set(this.p + DOC, await C.encryptJson(this.dek, this.doc, 'doc'));
  }

  // ---------- sync ----------

  sync() {
    this.queue = this.queue.then(() => this._sync()).catch(() => {});
    return this.queue;
  }

  async _sync() {
    if (!this.dek) return;
    if (!this.remote) { this.setStatus('local', 'Saved on this device'); return; }
    if (!navigator.onLine) { this.setStatus('offline', 'Offline — changes saved on this device'); return; }
    this.setStatus('syncing', 'Syncing…');
    try {
      const r = await this.remote.get(DOC);
      let remoteDoc = r ? await C.decryptJson(this.dek, r.bytes, 'doc') : null;
      const { doc, changedLocal, changedRemote } = mergeDocs(this.doc, remoteDoc || emptyDoc());
      // Keep edits that happened while we were downloading.
      const { doc: finalDoc } = mergeDocs(this.doc, doc);
      this.doc = finalDoc;
      if (changedRemote || !r) await this.remote.put(DOC, await C.encryptJson(this.dek, this.doc, 'doc'));
      if (changedLocal) {
        await this.saveLocal();
        this.dispatchEvent(new Event('change'));
      }
      await this.flushAttachments();
      this.dirty = false;
      this.setStatus('synced', 'Synced');
    } catch (e) {
      if (e.code === 'auth') this.setStatus('auth', e.message);
      else if (!navigator.onLine) this.setStatus('offline', 'Offline — changes saved on this device');
      else this.setStatus('error', e.message);
    }
  }

  // ---------- attachments ----------

  async addAttachment(file, ownerId, maxMB = 20) {
    if (file.size > maxMB * 1024 * 1024) throw new Error(`"${file.name}" is larger than ${maxMB} MB.`);
    const id = newId();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const blob = await C.encryptBytes(this.dek, bytes, `att:${id}`);
    await idb.set(this.p + 'blob:' + id, blob);
    if (this.remote) await idb.set(this.p + 'up:' + id, 1);
    const mime = String(file.type || 'application/octet-stream').slice(0, 100);
    this.put({ id, type: 'att', name: String(file.name || 'file').slice(0, 200), mime, size: file.size, owner: ownerId });
    this.urls.set(id, URL.createObjectURL(new Blob([bytes], { type: safeMime(mime) })));
    return id;
  }

  removeAttachment(id, notify = true) {
    const cur = this.doc.items[id];
    if (!cur || cur.deleted) return;
    this.doc.items[id] = this.stamp({ id, type: 'att', deleted: true });
    idb.del(this.p + 'blob:' + id);
    idb.del(this.p + 'up:' + id);
    if (this.remote) idb.set(this.p + 'rm:' + id, 1);
    const u = this.urls.get(id);
    if (u) { URL.revokeObjectURL(u); this.urls.delete(id); }
    if (notify) this.changed();
  }

  /** Object URL for a decrypted attachment (cached for this session). */
  async attachmentUrl(id) {
    if (this.urls.has(id)) return this.urls.get(id);
    const meta = this.get(id);
    if (!meta) throw new Error('Attachment not found.');
    let blob = await idb.get(this.p + 'blob:' + id);
    if (!blob && this.remote) {
      const r = await this.remote.get(attName(id));
      if (!r) throw new Error('Attachment not uploaded yet from the other device.');
      blob = r.bytes;
      await idb.set(this.p + 'blob:' + id, blob);
    }
    if (!blob) throw new Error('Attachment missing on this device.');
    const bytes = await C.decryptBytes(this.dek, blob, `att:${id}`);
    const url = URL.createObjectURL(new Blob([bytes], { type: safeMime(meta.mime) }));
    this.urls.set(id, url);
    return url;
  }

  async flushAttachments() {
    for (const k of await idb.keys(this.p + 'up:')) {
      const id = k.slice((this.p + 'up:').length);
      const blob = await idb.get(this.p + 'blob:' + id);
      if (blob && this.get(id)) await this.remote.put(attName(id), blob);
      await idb.del(k);
    }
    for (const k of await idb.keys(this.p + 'rm:')) {
      await this.remote.del(attName(k.slice((this.p + 'rm:').length)));
      await idb.del(k);
    }
    // Drop local copies of attachments deleted on another device.
    for (const k of await idb.keys(this.p + 'blob:')) {
      const id = k.slice((this.p + 'blob:').length);
      if (this.doc.items[id]?.deleted || !this.doc.items[id]) await idb.del(k);
    }
  }

  /** Remove this account's cached data from this browser. */
  async forgetDevice() {
    this.lock();
    await idb.delPrefix(this.p);
  }

  /** Delete everything, here and in the cloud store. */
  async destroyAll() {
    if (this.remote) await this.remote.wipe();
    await this.forgetDevice();
  }
}

// Only let the browser render types that cannot run script in our origin.
// Everything else downloads as a plain binary.
const SAFE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|application\/pdf|text\/plain|audio\/[a-z0-9.+-]+|video\/(mp4|webm|ogg))$/;
export function safeMime(m) {
  const base = String(m || '').split(';')[0].trim().toLowerCase();
  return SAFE.test(base) ? base : 'application/octet-stream';
}
