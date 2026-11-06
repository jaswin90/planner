// Vault crypto. Everything runs in the browser through WebCrypto.
//
// Design (see DESIGN.md, "Encryption"):
//   passphrase --PBKDF2-SHA256 (600k)--> KEK (AES-GCM-256, wrap only)
//   recovery code --PBKDF2-SHA256--------> RKEK
//   DEK (random AES-GCM-256) is stored only wrapped by KEK and by RKEK.
//   Every file (data doc, each attachment) is AES-GCM(DEK) with a fresh
//   96-bit IV and an AAD naming the file, so files cannot be swapped.
//
// Blob format: [1 byte version=1][12 byte IV][ciphertext+tag]

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export const KDF_ITERATIONS = 600000;
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

async function deriveKek(secret, salt, iterations) {
  const base = await subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function wrapRaw(kek, rawDek, label) {
  const iv = randomBytes(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(label) }, kek, rawDek);
  return { iv: b64(iv), ct: b64(ct) };
}

async function unwrapRaw(kek, wrapped, label) {
  return new Uint8Array(await subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(wrapped.iv), additionalData: enc.encode(label) },
    kek,
    unb64(wrapped.ct),
  ));
}

function importDek(raw) {
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Recovery code: 160 random bits shown as 8 groups of 4 base32 characters.
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
export function makeRecoveryCode() {
  const bytes = randomBytes(20);
  let bits = 0, val = 0, out = '';
  for (const byte of bytes) {
    val = ((val << 8) | byte) & 0xffff; bits += 8;
    while (bits >= 5 && out.length < 32) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g).join('-');
}

export function normalizeRecoveryCode(code) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Create a new vault. Returns { meta, dek, recoveryCode }.
 * `meta` holds no secrets in the clear and can be stored anywhere.
 */
export async function createVault(passphrase, { iterations = KDF_ITERATIONS } = {}) {
  if (!passphrase || passphrase.length < 10) throw new Error('Passphrase must be at least 10 characters.');
  const rawDek = randomBytes(32);
  const salt = randomBytes(16);
  const rsalt = randomBytes(16);
  const recoveryCode = makeRecoveryCode();
  const kek = await deriveKek(passphrase, salt, iterations);
  const rkek = await deriveKek(normalizeRecoveryCode(recoveryCode), rsalt, iterations);
  const meta = {
    v: 1,
    createdAt: new Date().toISOString(),
    kdf: { name: 'PBKDF2-SHA256', iterations, salt: b64(salt), rsalt: b64(rsalt) },
    wrap: await wrapRaw(kek, rawDek, 'planner:dek:pass'),
    rwrap: await wrapRaw(rkek, rawDek, 'planner:dek:recovery'),
  };
  const dek = await importDek(rawDek);
  rawDek.fill(0);
  return { meta, dek, recoveryCode };
}

async function unlockRaw(meta, secret, useRecovery) {
  if (!meta || meta.v !== 1) throw new Error('Unknown vault format.');
  const salt = unb64(useRecovery ? meta.kdf.rsalt : meta.kdf.salt);
  const kek = await deriveKek(useRecovery ? normalizeRecoveryCode(secret) : secret, salt, meta.kdf.iterations);
  try {
    return await unwrapRaw(kek, useRecovery ? meta.rwrap : meta.wrap, useRecovery ? 'planner:dek:recovery' : 'planner:dek:pass');
  } catch {
    throw new Error(useRecovery ? 'Wrong recovery code.' : 'Wrong passphrase.');
  }
}

/** Unlock with the passphrase (or recovery code). Returns a non-extractable DEK. */
export async function unlockVault(meta, secret, { recovery = false } = {}) {
  const raw = await unlockRaw(meta, secret, recovery);
  const dek = await importDek(raw);
  raw.fill(0);
  return dek;
}

/** Re-wrap the DEK under a new passphrase. Data files do not change. */
export async function changePassphrase(meta, oldSecret, newPassphrase, { recovery = false } = {}) {
  if (!newPassphrase || newPassphrase.length < 10) throw new Error('Passphrase must be at least 10 characters.');
  const raw = await unlockRaw(meta, oldSecret, recovery);
  const salt = randomBytes(16);
  const kek = await deriveKek(newPassphrase, salt, meta.kdf.iterations);
  const next = structuredClone(meta);
  next.kdf.salt = b64(salt);
  next.wrap = await wrapRaw(kek, raw, 'planner:dek:pass');
  next.changedAt = new Date().toISOString();
  raw.fill(0);
  return next;
}

export async function encryptBytes(dek, bytes, label) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(label) }, dek, bytes));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = FORMAT_VERSION;
  out.set(iv, 1);
  out.set(ct, 13);
  return out;
}

export async function decryptBytes(dek, blob, label) {
  const u = new Uint8Array(blob);
  if (u.length < 13 + 16 || u[0] !== FORMAT_VERSION) throw new Error('Not an encrypted planner file.');
  try {
    return new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv: u.subarray(1, 13), additionalData: enc.encode(label) }, dek, u.subarray(13),
    ));
  } catch {
    throw new Error('Decryption failed: file is damaged or belongs to another vault.');
  }
}

export async function encryptJson(dek, obj, label) {
  return encryptBytes(dek, enc.encode(JSON.stringify(obj)), label);
}

export async function decryptJson(dek, blob, label) {
  return JSON.parse(dec.decode(await decryptBytes(dek, blob, label)));
}

/** Replace the recovery code (needs the passphrase). Returns { meta, recoveryCode }. */
export async function replaceRecoveryCode(meta, passphrase) {
  const raw = await unlockRaw(meta, passphrase, false);
  const rsalt = randomBytes(16);
  const recoveryCode = makeRecoveryCode();
  const rkek = await deriveKek(normalizeRecoveryCode(recoveryCode), rsalt, meta.kdf.iterations);
  const next = structuredClone(meta);
  next.kdf.rsalt = b64(rsalt);
  next.rwrap = await wrapRaw(rkek, raw, 'planner:dek:recovery');
  raw.fill(0);
  return { meta: next, recoveryCode };
}
