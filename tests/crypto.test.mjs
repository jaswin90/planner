import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/crypto.js';

const FAST = { iterations: 1000 }; // keep tests quick; the app uses 600k

test('create, unlock, encrypt, decrypt round trip', async () => {
  const { meta, dek, recoveryCode } = await C.createVault('correct horse battery', FAST);
  assert.match(recoveryCode, /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
  assert.ok(!JSON.stringify(meta).includes('correct horse'));
  const blob = await C.encryptJson(dek, { hello: 'world' }, 'doc');
  const dek2 = await C.unlockVault(meta, 'correct horse battery');
  assert.deepEqual(await C.decryptJson(dek2, blob, 'doc'), { hello: 'world' });
});

test('wrong passphrase is rejected', async () => {
  const { meta } = await C.createVault('correct horse battery', FAST);
  await assert.rejects(C.unlockVault(meta, 'wrong passphrase!!'), /Wrong passphrase/);
});

test('recovery code unlocks and can reset passphrase', async () => {
  const { meta, dek, recoveryCode } = await C.createVault('correct horse battery', FAST);
  const blob = await C.encryptBytes(dek, new Uint8Array([1, 2, 3]), 'att:x');
  const viaCode = await C.unlockVault(meta, recoveryCode.toLowerCase().replace(/-/g, ' '), { recovery: true });
  assert.deepEqual([...await C.decryptBytes(viaCode, blob, 'att:x')], [1, 2, 3]);
  const meta2 = await C.changePassphrase(meta, recoveryCode, 'a brand new passphrase', { recovery: true });
  await assert.rejects(C.unlockVault(meta2, 'correct horse battery'));
  const k = await C.unlockVault(meta2, 'a brand new passphrase');
  assert.deepEqual([...await C.decryptBytes(k, blob, 'att:x')], [1, 2, 3]);
});

test('replacing recovery code invalidates the old one', async () => {
  const { meta, recoveryCode } = await C.createVault('correct horse battery', FAST);
  const { meta: m2, recoveryCode: c2 } = await C.replaceRecoveryCode(meta, 'correct horse battery');
  assert.notEqual(c2, recoveryCode);
  await assert.rejects(C.unlockVault(m2, recoveryCode, { recovery: true }));
  await C.unlockVault(m2, c2, { recovery: true });
});

test('AAD binds ciphertext to its file name; tampering is detected', async () => {
  const { dek } = await C.createVault('correct horse battery', FAST);
  const blob = await C.encryptBytes(dek, new TextEncoder().encode('secret'), 'att:aaa');
  await assert.rejects(C.decryptBytes(dek, blob, 'att:bbb'), /Decryption failed/);
  const bad = blob.slice(); bad[bad.length - 1] ^= 1;
  await assert.rejects(C.decryptBytes(dek, bad, 'att:aaa'), /Decryption failed/);
});

test('fresh IV every time', async () => {
  const { dek } = await C.createVault('correct horse battery', FAST);
  const a = await C.encryptBytes(dek, new Uint8Array(4), 'x');
  const b = await C.encryptBytes(dek, new Uint8Array(4), 'x');
  assert.notDeepEqual(a.slice(1, 13), b.slice(1, 13));
});

test('short passphrase refused', async () => {
  await assert.rejects(C.createVault('short', FAST), /at least 10/);
});

test('default KDF strength', () => {
  assert.ok(C.KDF_ITERATIONS >= 600000);
});
