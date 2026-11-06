// Tiny IndexedDB key-value store. Only ciphertext and non-secret metadata
// are ever written here.

const DB_NAME = 'planner';
const STORE = 'kv';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    const req = fn(s);
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const idb = {
  get: (k) => tx('readonly', (s) => s.get(k)),
  set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
  del: (k) => tx('readwrite', (s) => s.delete(k)),
  keys: (prefix) => tx('readonly', (s) => s.getAllKeys()).then((ks) => ks.filter((k) => String(k).startsWith(prefix))),
  async delPrefix(prefix) {
    for (const k of await idb.keys(prefix)) await idb.del(k);
  },
};
