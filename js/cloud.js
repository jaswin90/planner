// Cloud storage for the Planner: the site-wide account (jaswin90.github.io) and its Firestore
// database. Replaces Google Drive, which some workplaces block.
//
// Everything the vault writes is already AES-GCM ciphertext; this module only stores bytes.
// Layout, readable and writable only by the signed-in owner (see firestore.rules in the site
// repository):
//   planner/<uid>/files/<name>              { n: chunks, size, at }
//   planner/<uid>/files/<name>/chunks/<i>   { d: Bytes }   (≤ 700 KB each; Firestore's limit is 1 MiB)

const CHUNK = 700 * 1024;
let site = null;

/** The site's shared account module (served by jaswin90.github.io, not by this repo). */
export async function siteAuth() {
  if (!site) site = import('/assets/js/site-auth.js').catch((e) => { site = null; throw e; });
  return site;
}

export async function cloudConfigured() {
  try { return (await siteAuth()).configured(); } catch { return false; }
}

const authError = (msg) => Object.assign(new Error(msg), { code: 'auth' });

export class CloudStore {
  constructor(uid) { this.uid = uid; this.fb = null; }

  async f() {
    if (!this.fb) {
      const S = await siteAuth();
      this.fb = await S.firebase();
    }
    const { auth } = this.fb;
    if (!auth.currentUser || auth.currentUser.uid !== this.uid) throw authError('Please sign in again at the library.');
    return this.fb;
  }

  ref(F, db, name, ...rest) { return F.doc(db, 'planner', this.uid, 'files', safeName(name), ...rest); }

  async call(fn) {
    let timer;
    const slow = new Promise((_, no) => { timer = setTimeout(() => no(new Error(
      'The database did not answer within 45 seconds. Your network may be blocking firestore.googleapis.com; changes are kept on this device.')), 45_000); });
    try { return await Promise.race([fn(), slow]); }
    catch (e) {
      if (e && (e.code === 'permission-denied' || e.code === 'unauthenticated')) throw authError('Not allowed: sign in at the library with an invited account.');
      throw e;
    } finally { clearTimeout(timer); }
  }

  /** Returns { bytes: Uint8Array, version } or null. */
  async get(name) {
    const { F, db } = await this.f();
    return this.call(async () => {
      const meta = await F.getDoc(this.ref(F, db, name));
      if (!meta.exists()) return null;
      const { n = 0, size = 0, at = 0 } = meta.data();
      const parts = await Promise.all([...Array(n).keys()].map((i) => F.getDoc(this.ref(F, db, name, 'chunks', String(i)))));
      const out = new Uint8Array(size);
      let off = 0;
      for (const p of parts) {
        if (!p.exists()) throw new Error(`Stored file ${name} is incomplete; it will be re-uploaded from this device.`);
        const b = p.data().d.toUint8Array();
        out.set(b, off); off += b.length;
      }
      return { bytes: out, version: at };
    });
  }

  async put(name, bytes) {
    const { F, db } = await this.f();
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return this.call(async () => {
      const old = await F.getDoc(this.ref(F, db, name));
      const oldN = old.exists() ? (old.data().n || 0) : 0;
      const n = Math.max(1, Math.ceil(bytes.length / CHUNK));
      // Chunks first (a few per request, to stay under Firestore's request size), then the
      // record that says how many there are, then remove chunks left over from a larger version.
      for (let i = 0; i < n; i += 8) {
        const batch = F.writeBatch(db);
        for (let j = i; j < Math.min(n, i + 8); j++) {
          batch.set(this.ref(F, db, name, 'chunks', String(j)), { d: F.Bytes.fromUint8Array(bytes.subarray(j * CHUNK, (j + 1) * CHUNK)) });
        }
        await batch.commit();
      }
      const at = Date.now();
      await F.setDoc(this.ref(F, db, name), { n, size: bytes.length, at });
      if (oldN > n) {
        const batch = F.writeBatch(db);
        for (let j = n; j < oldN; j++) batch.delete(this.ref(F, db, name, 'chunks', String(j)));
        await batch.commit();
      }
      return at;
    });
  }

  async del(name) {
    const { F, db } = await this.f();
    return this.call(async () => {
      const meta = await F.getDoc(this.ref(F, db, name));
      if (!meta.exists()) return;
      const n = meta.data().n || 0;
      const batch = F.writeBatch(db);
      for (let j = 0; j < n; j++) batch.delete(this.ref(F, db, name, 'chunks', String(j)));
      batch.delete(this.ref(F, db, name));
      await batch.commit();
    });
  }

  /** Delete every stored file (used by "Delete all my data"). */
  async wipe() {
    const { F, db } = await this.f();
    return this.call(async () => {
      const files = await F.getDocs(F.collection(db, 'planner', this.uid, 'files'));
      for (const d of files.docs) await this.del(d.id);
    });
  }
}

function safeName(name) { return String(name).replace(/[^a-zA-Z0-9._-]/g, '_'); }
