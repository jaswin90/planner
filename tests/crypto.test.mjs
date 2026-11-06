import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/crypto.js';

test('encrypt/decrypt round trip with a stored key', async () => {
  const kb = C.newKeyB64();
  const key = await C.importKey(kb);
  const blob = await C.encryptJson(key, { hello: 'world' }, 'doc');
  assert.ok(!new TextDecoder('latin1').decode(blob).includes('world'));
  const again = await C.importKey(kb);
  assert.deepEqual(await C.decryptJson(again, blob, 'doc'), { hello: 'world' });
});

test('another account key cannot decrypt', async () => {
  const a = await C.importKey(C.newKeyB64());
  const b = await C.importKey(C.newKeyB64());
  const blob = await C.encryptBytes(a, new Uint8Array([1, 2, 3]), 'doc');
  await assert.rejects(C.decryptBytes(b, blob, 'doc'), /Decryption failed/);
});

test('AAD binds ciphertext to its file name; tampering is detected', async () => {
  const key = await C.importKey(C.newKeyB64());
  const blob = await C.encryptBytes(key, new TextEncoder().encode('secret'), 'att:aaa');
  await assert.rejects(C.decryptBytes(key, blob, 'att:bbb'), /Decryption failed/);
  const bad = blob.slice(); bad[bad.length - 1] ^= 1;
  await assert.rejects(C.decryptBytes(key, bad, 'att:aaa'), /Decryption failed/);
});

test('fresh IV every time', async () => {
  const key = await C.importKey(C.newKeyB64());
  const a = await C.encryptBytes(key, new Uint8Array(4), 'x');
  const b = await C.encryptBytes(key, new Uint8Array(4), 'x');
  assert.notDeepEqual(a.slice(1, 13), b.slice(1, 13));
});

test('bad key is refused', async () => {
  await assert.rejects(C.importKey(C.b64(new Uint8Array(5))), /Bad key/);
});

test('password-protected backup round trip', async () => {
  const box = await C.encryptWithPassword('{"hello":"backup"}', 'my backup pw', 1000);
  assert.ok(!JSON.stringify(box).includes('hello'));
  assert.equal(await C.decryptWithPassword(box, 'my backup pw'), '{"hello":"backup"}');
  await assert.rejects(C.decryptWithPassword(box, 'wrong'), /Wrong backup password/);
});
