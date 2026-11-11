// File encryption (WebCrypto, AES-256-GCM).
//
// One random 256-bit key per account, created automatically on first
// sign-in and kept in the account's private cloud store (and cached
// in this browser). No passphrase: your site account (Google sign-in) is the lock.
//
// Blob format: [1 byte version=1][12 byte IV][ciphertext+tag]
// AAD names the file ("doc", "att:<id>") so files cannot be swapped.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;
const FORMAT_VERSION = 1;

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function b64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(str) {
  const s = atob(str);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

/** New random key, returned as base64 for storage. */
export function newKeyB64() {
  return b64(randomBytes(32));
}

/** Import a stored key for use (non-extractable in memory). */
export async function importKey(keyB64) {
  const raw = unb64(keyB64);
  if (raw.length !== 32) throw new Error('Bad key.');
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key, bytes, label) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(label) }, key, bytes));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = FORMAT_VERSION;
  out.set(iv, 1);
  out.set(ct, 13);
  return out;
}

export async function decryptBytes(key, blob, label) {
  const u = new Uint8Array(blob);
  if (u.length < 13 + 16 || u[0] !== FORMAT_VERSION) throw new Error('Not an encrypted planner file.');
  try {
    return new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv: u.subarray(1, 13), additionalData: enc.encode(label) }, key, u.subarray(13),
    ));
  } catch {
    throw new Error('Decryption failed: file is damaged or belongs to another account.');
  }
}

export async function encryptJson(key, obj, label) {
  return encryptBytes(key, enc.encode(JSON.stringify(obj)), label);
}

export async function decryptJson(key, blob, label) {
  return JSON.parse(dec.decode(await decryptBytes(key, blob, label)));
}

// ---- password-protected backup files (PBKDF2-SHA256 600k -> AES-GCM) ----
export const BACKUP_ITERATIONS = 600000;

async function passwordKey(password, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Encrypt a string with a password. Returns a JSON-able object. */
export async function encryptWithPassword(text, password, iterations = BACKUP_ITERATIONS) {
  const salt = randomBytes(16);
  const key = await passwordKey(password, salt, iterations);
  const blob = await encryptBytes(key, enc.encode(text), 'backup');
  return { kdf: 'PBKDF2-SHA256', iterations, salt: b64(salt), data: b64(blob) };
}

export async function decryptWithPassword(box, password) {
  const key = await passwordKey(password, unb64(box.salt), box.iterations);
  try {
    return dec.decode(await decryptBytes(key, unb64(box.data), 'backup'));
  } catch {
    throw new Error('Wrong backup password (or the file is damaged).');
  }
}
