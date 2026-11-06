// End-to-end test in headless Chromium, "this device only" mode.
// Usage: node tests/e2e.mjs   (starts its own static server)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // global install is fine
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8765;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const shots = process.env.SHOTS || '';

const tmp = mkdtempSync(join(tmpdir(), 'planner-e2e-'));
const png = join(tmp, 'photo.png');
// 2x2 red PNG
writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64'));
const pdf = join(tmp, 'doc.pdf');
writeFileSync(pdf, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

const SECRET = 'TOPSECRETNOTEBODY';
const errors = [];
const browser = await chromium.launch();
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByText('Google sign-in is not set up yet').waitFor();
  if (shots) await page.screenshot({ path: `${shots}/1-welcome.png` });

  // Straight into the app: no passphrase
  await page.getByRole('button', { name: 'Use on this device only' }).click();
  await page.locator('.top').waitFor();

  // Only two tabs: Planner and Notes
  const tabs = await page.locator('nav.tabs a').allTextContents();
  assert.deepEqual(tabs, ['Planner', 'Notes']);
  // Only Day and Month views
  assert.deepEqual(await page.locator('.seg button').allTextContents(), ['Day', 'Month']);

  // Planner: quick-add and drag onto a day
  await page.getByPlaceholder('Add a task and press Enter').fill('Write report');
  await page.keyboard.press('Enter');
  await page.getByPlaceholder('Add a task and press Enter').fill('Call bank');
  await page.keyboard.press('Enter');
  await page.locator('.sec-unplanned .sticky', { hasText: 'Write report' }).waitFor();
  const target = page.locator('.day:not(.out)').nth(10);
  const date = await target.getAttribute('data-date');
  await page.locator('.sticky', { hasText: 'Write report' }).dragTo(target);
  await page.locator(`.day[data-date="${date}"] .chip`, { hasText: 'Write report' }).waitFor();
  await page.locator('.sec-planned .sticky', { hasText: 'Write report' }).waitFor();
  // Drag the other one to Doing
  await page.locator('.sticky', { hasText: 'Call bank' }).dragTo(page.locator('.sec-doing'));
  await page.locator('.sec-doing .sticky', { hasText: 'Call bank' }).waitFor();
  if (shots) await page.screenshot({ path: `${shots}/2-month.png` });

  // Day view: open that day, drag "Call bank" to 10:00
  await page.locator(`.day[data-date="${date}"] .dnum`).click();
  await page.locator('.dayview').waitFor();
  await page.locator('.dv-allday .chip', { hasText: 'Write report' }).waitFor();
  await page.locator('.sticky', { hasText: 'Call bank' }).dragTo(page.locator('.dv-hour[data-hour="10"]'));
  await page.locator('.dv-hour[data-hour="10"] .chip', { hasText: 'Call bank' }).waitFor();
  if (shots) await page.screenshot({ path: `${shots}/3-day.png` });

  // Task dialog with notes
  await page.locator('.dv-hour[data-hour="10"] .chip', { hasText: 'Call bank' }).click();
  await page.locator('dialog .rte').click();
  await page.keyboard.type('Ask about the loan');
  await page.locator('dialog').getByRole('button', { name: 'Done', exact: true }).click();

  // Notes: create a rich note with photo and PDF
  await page.locator('nav.tabs a', { hasText: 'Notes' }).click();
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByPlaceholder('Title').fill('Trip ideas');
  await page.locator('.note-pane .rte').click();
  await page.keyboard.type(SECRET + ' ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('bold bit');
  await page.keyboard.press('Control+b');
  const [fc1] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.note-pane .tb[data-cmd=image]').click()]);
  await fc1.setFiles(png);
  await page.locator('.note-pane .rte img[data-att][src^="blob:"]').waitFor();
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.note-pane .tb[data-cmd=attach]').click()]);
  await fc2.setFiles(pdf);
  await page.locator('.note-pane .rte .att-chip', { hasText: 'doc.pdf' }).waitFor();
  await page.locator('.att-list .att-name', { hasText: 'doc.pdf' }).waitFor();
  await page.locator('.att-list .att-name', { hasText: 'photo.png' }).waitFor();

  // Checklist
  await page.locator('.note-pane .rte').press('End');
  await page.keyboard.press('Enter');
  await page.locator('.note-pane .tb[data-cmd=checklist]').click();
  await page.keyboard.type('Book hotel');
  await page.locator('.note-pane ul.checklist li').waitFor();

  // Paste hostile HTML: must be neutralised
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<img src=x onerror="window.__pwned=1"><a href="javascript:window.__pwned=2">bad</a><script>window.__pwned=3</script><b onclick="x()">ok</b><iframe src="https://example.com"></iframe>');
    document.querySelector('.note-pane .rte').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  const html = await page.locator('.note-pane .rte').innerHTML();
  assert.ok(!/onerror|onclick|javascript:|<script|<iframe/i.test(html), html);
  await page.locator('.nl-item', { hasText: 'Trip ideas' }).waitFor();
  if (shots) await page.screenshot({ path: `${shots}/4-notes.png` });

  // Open the PDF viewer
  await page.locator('.att-list .att-open', { hasText: 'doc.pdf' }).click();
  await page.locator('dialog iframe.pdf').waitFor();
  await page.keyboard.press('Escape');

  // Let autosave run, then check nothing readable is stored in the browser.
  await page.locator('.note-pane .title-in').click();
  await page.waitForTimeout(800);
  const dump = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('planner'); q.onsuccess = () => r(q.result); });
    const vals = await new Promise((r) => { const q = db.transaction('kv').objectStore('kv').getAll(); q.onsuccess = () => r(q.result); });
    const parts = vals.map((v) => (v instanceof Uint8Array ? new TextDecoder('latin1').decode(v) : JSON.stringify(v)));
    return parts.join('\n') + JSON.stringify(localStorage);
  });
  for (const word of [SECRET, 'Trip ideas', 'Write report', 'Call bank', 'loan', 'doc.pdf', 'PDF-1.4']) {
    assert.ok(!dump.includes(word), `plaintext "${word}" found in browser storage`);
  }

  // Reload: data persists (encrypted) and opens without any passphrase
  await page.goto(`http://127.0.0.1:${PORT}/#/notes`);
  await page.reload();
  await page.getByRole('button', { name: 'Use on this device only' }).click();
  await page.locator('.nl-item', { hasText: 'Trip ideas' }).click();
  await page.locator('.note-pane .rte', { hasText: SECRET }).waitFor();
  await page.locator('.note-pane .rte img[src^="blob:"]').waitFor();
  assert.ok((await page.locator('.note-pane .rte b, .note-pane .rte strong').first().textContent()).startsWith('bold bit'));
  assert.equal(await page.getByText(/passphrase/i).count(), 0);

  // Settings is reachable from the gear, not a tab
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByText('Projects & notebooks').waitFor();

  // Phone layout renders
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('nav.tabs a', { hasText: 'Planner' }).click();
  await page.locator('.seg button', { hasText: 'Month' }).click();
  await page.locator('.cal').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `horizontal overflow ${overflow}px on phone`);
  if (shots) await page.screenshot({ path: `${shots}/5-phone.png` });

  const bad = errors.filter((e) => !/favicon/.test(e));
  assert.deepEqual(bad, [], 'console errors');
  console.log('E2E OK');
} catch (e) {
  failed = true;
  console.error('E2E FAILED:', e);
  console.error('console errors:', errors);
} finally {
  await browser.close();
  server.kill();
  process.exit(failed ? 1 : 0);
}
