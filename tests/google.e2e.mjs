// Exercises the real Google sign-in + Drive code against a fake Google
// (Playwright request interception). Two browser contexts = two devices
// signed in to the same account, sharing one fake Drive.
// Run: node tests/google.e2e.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8768;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const tmp = mkdtempSync(join(tmpdir(), 'planner-g-'));
const png = join(tmp, 'beach.png');
writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64'));

// ---------------- fake Google ----------------
const drive = new Map(); // id -> { name, bytes, version }
let nextId = 1;
const calls = [];
const FAKE_GIS = `window.google = { accounts: { oauth2: {
  initTokenClient(cfg) { return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: 'tok-' + Math.random(), expires_in: 3600, scope: cfg.scope })); } }; },
  hasGrantedAllScopes() { return true; },
  revoke(t, cb) { cb && cb(); },
} } };`;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const json = (route, obj, status = 200) => route.fulfill({ status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

async function googleRoute(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (url.hostname !== 'accounts.google.com' && !/^Bearer tok-/.test(req.headers().authorization || '')) return json(route, { error: 'no auth' }, 401);
  calls.push(`${method} ${url.pathname}`);
  if (url.hostname === 'accounts.google.com') return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/javascript' }, body: FAKE_GIS });
  if (url.pathname === '/oauth2/v3/userinfo') return json(route, { sub: '4242', email: 'me@gmail.com', name: 'Me' });
  let m;
  if (url.pathname === '/drive/v3/files' && method === 'GET') {
    assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
    const q = url.searchParams.get('q') || '';
    const name = (q.match(/name = '([^']+)'/) || [])[1];
    const files = [...drive.entries()].filter(([, f]) => !name || f.name === name).map(([id, f]) => ({ id, name: f.name, version: String(f.version) }));
    return json(route, { files });
  }
  if ((m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
    const f = drive.get(m[1]);
    if (!f) return json(route, { error: 'not found' }, 404);
    if (method === 'DELETE') { drive.delete(m[1]); return route.fulfill({ status: 204, headers: cors }); }
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/octet-stream' }, body: f.bytes });
    return json(route, { id: m[1], version: String(f.version) });
  }
  if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
    assert.equal(url.searchParams.get('uploadType'), 'multipart');
    const boundary = req.headers()['content-type'].match(/boundary=(\S+)/)[1];
    const body = req.postDataBuffer();
    const parts = splitMultipart(body, boundary);
    const meta = JSON.parse(parts[0].toString());
    assert.deepEqual(meta.parents, ['appDataFolder']);
    const id = 'f' + nextId++;
    drive.set(id, { name: meta.name, bytes: parts[1], version: 1 });
    return json(route, { id, name: meta.name, version: '1' });
  }
  if ((m = url.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)) && method === 'PATCH') {
    const f = drive.get(m[1]);
    f.bytes = req.postDataBuffer(); f.version++;
    return json(route, { id: m[1], version: String(f.version) });
  }
  return json(route, { error: 'unexpected ' + method + ' ' + url.pathname }, 400);
}

function splitMultipart(buf, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const out = [];
  let i = buf.indexOf(sep);
  while (i !== -1) {
    const next = buf.indexOf(sep, i + sep.length);
    if (next === -1) break;
    const part = buf.subarray(i + sep.length + 2, next - 2); // strip CRLFs
    const hdrEnd = part.indexOf('\r\n\r\n');
    out.push(part.subarray(hdrEnd + 4));
    i = next;
  }
  return out;
}

const config = readFileSync(join(root, 'js/config.js'), 'utf8').replace("googleClientId: ''", "googleClientId: '123456789012-abcdefg.apps.googleusercontent.com'");

async function device(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.route(/^https:\/\/(accounts\.google\.com|www\.googleapis\.com)\//, googleRoute);
  await ctx.route(/\/js\/config\.js$/, (r) => r.fulfill({ status: 200, headers: { 'Content-Type': 'text/javascript' }, body: config }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  return page;
}

const browser = await chromium.launch();
let code = 0;
try {
  // ---- device A: first sign-in creates the key, adds a note with a photo
  const A = await device(browser);
  await A.getByRole('button', { name: 'Sign in with Google' }).click();
  await A.locator('.top').waitFor();
  await A.locator('.status.st-synced').waitFor();
  assert.ok([...drive.values()].some((f) => f.name === 'planner-key.json'), 'key created in Drive');

  await A.locator('nav.tabs a', { hasText: 'Notes' }).click();
  await A.getByRole('button', { name: 'New note' }).first().click();
  await A.getByPlaceholder('Title').fill('Holiday plan');
  await A.locator('.n-note .rte').click();
  await A.keyboard.type('Pack sunscreen PLAINTEXTCANARY');
  const [fc] = await Promise.all([A.waitForEvent('filechooser'), A.locator('.n-note .tb[data-cmd=image]').click()]);
  await fc.setFiles(png);
  await A.locator('.n-note .rte img[src^="blob:"]').waitFor();
  await A.getByPlaceholder('Add a task', { exact: false }).count(); // noop
  await A.locator('.n-note .title-in').click();
  await A.waitForTimeout(2500); // debounce + sync
  await A.locator('.status.st-synced').waitFor();
  const names = [...drive.values()].map((f) => f.name).sort();
  assert.ok(names.includes('planner-data.bin') && names.some((n) => /^att-[0-9a-f]{24}\.bin$/.test(n)), names.join(','));
  const all = Buffer.concat([...drive.values()].map((f) => Buffer.from(f.bytes))).toString('latin1');
  for (const w of ['Holiday plan', 'PLAINTEXTCANARY', 'beach.png', 'IHDR']) assert.ok(!all.includes(w), `plaintext "${w}" in Drive`);

  // ---- device B: same account sees the note and the photo
  const B = await device(browser);
  await B.getByRole('button', { name: 'Sign in with Google' }).click();
  await B.locator('.top').waitFor();
  await B.locator('nav.tabs a', { hasText: 'Notes' }).click();
  await B.locator('.nl-card', { hasText: 'Holiday plan' }).click();
  await B.locator('.n-note .rte', { hasText: 'PLAINTEXTCANARY' }).waitFor();
  await B.locator('.n-note .rte img[src^="blob:"]').waitFor();

  // B adds a task; A picks it up on its next sync (focus)
  await B.locator('nav.tabs a', { hasText: 'Planner' }).click();
  await B.getByPlaceholder('Add a task and press Enter').fill('Book flights');
  await B.keyboard.press('Enter');
  await B.waitForTimeout(2500);
  await A.locator('nav.tabs a', { hasText: 'Planner' }).click();
  await A.evaluate(() => window.dispatchEvent(new Event('focus')));
  await A.locator('.sticky', { hasText: 'Book flights' }).waitFor({ timeout: 10000 });

  // Returning user sees "Continue as"
  await A.reload();
  await A.getByRole('button', { name: 'Continue as me@gmail.com' }).waitFor();

  // Delete everything empties the Drive app folder
  await A.getByRole('button', { name: 'Continue as me@gmail.com' }).click();
  await A.locator('.top').waitFor();
  await A.getByRole('link', { name: 'Settings' }).click();
  await A.getByRole('button', { name: 'Delete all my data' }).click();
  await A.locator('dialog input').fill('DELETE');
  await A.getByRole('button', { name: 'Delete everything' }).click();
  await A.waitForURL(/./);
  await A.getByRole('button', { name: /Sign in with Google|Continue as/ }).waitFor();
  assert.equal(drive.size, 0, 'Drive app folder emptied');

  const errs = [...A.errors, ...B.errors];
  assert.deepEqual(errs, [], 'console errors');
  console.log('GOOGLE E2E OK', calls.length, 'API calls');
} catch (e) {
  console.error('GOOGLE E2E FAILED:', e);
  code = 1;
} finally {
  await browser.close();
  server.kill();
  process.exit(code);
}
