// Phone layout test (iPhone-sized, touch): bottom tabs, Today, quick add, planner Day/Month, task menu.
// Usage: node tests/mobile.e2e.mjs
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8768;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
const errors = [];
let failed = false;
try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByRole('button', { name: 'Use on this device only' }).click();
  await page.locator('.btabs').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#/today');
  assert.deepEqual(await page.locator('.btabs a').allTextContents(), ['Today', 'Planner', 'Notes', 'Projects']);
  assert.equal(await page.locator('.ph-title h1').textContent(), 'Today');

  // Quick add with plain chips: today with a time, and one with no date
  await page.locator('.fab').click();
  await page.locator('.qa-title').fill('Standup');
  await page.locator('.qa-row input[type=time]').fill('09:00');
  await page.locator('.qchip', { hasText: '30 min' }).click();
  await page.locator('.qa-foot .btn.primary').click();
  await page.locator('.fab').click();
  await page.locator('.qa-title').fill('Renew passport');
  await page.locator('.qchip', { hasText: 'No date' }).click();
  await page.locator('.qa-title').press('Enter'); // Enter in the title adds
  await page.locator('.trow', { hasText: 'Standup' }).getByText('09:00–09:30').waitFor();
  await page.locator('.hcard', { hasText: 'Not planned yet' }).locator('.trow', { hasText: 'Renew passport' }).waitFor();

  // Tick completes; the progress bar counts it
  await page.locator('.trow', { hasText: 'Standup' }).locator('.tick').click();
  await page.locator('.trow.done', { hasText: 'Standup' }).waitFor();
  await page.locator('.ok-n', { hasText: '1 done' }).waitFor();

  // ⋯ menu plans the inbox task for tomorrow
  await page.locator('.trow', { hasText: 'Renew passport' }).locator('.more-btn').click();
  await page.locator('.tmenu .tm-it', { hasText: 'Tomorrow' }).click();
  await page.locator('.hcard', { hasText: 'Next 7 days' }).locator('.trow', { hasText: 'Renew passport' }).waitFor();

  // Planner: week strip, Any time list, Month dots, group sheet
  await page.locator('.btabs a', { hasText: 'Planner' }).click();
  await page.locator('.m-week').waitFor();
  assert.equal(await page.locator('.planner .side').count(), 0, 'no desktop sidebar on phones');
  await page.locator('.dv-event', { hasText: 'Standup' }).waitFor();
  await page.locator('.m-wd').nth(((new Date().getDay() + 6) % 7 + 1) % 7).click();
  await page.locator('.m-seg button', { hasText: 'Month' }).click();
  await page.locator('.m-month .m-day.on').waitFor();
  await page.locator('.m-chip', { hasText: 'Done' }).click();
  await page.locator('dialog.bsheet .trow', { hasText: 'Standup' }).waitFor();
  await page.keyboard.press('Escape');

  // Notes: the + button makes a note
  await page.locator('.btabs a', { hasText: 'Notes' }).click();
  await page.locator('.fab').click();
  await page.waitForFunction(() => /^#\/notes\/[0-9a-f]{24}$/.test(location.hash));

  // Account menu holds Settings and Sign out
  await page.locator('.avatar').click();
  await page.locator('.tmenu .tm-it', { hasText: 'Settings' }).click();
  await page.waitForFunction(() => location.hash === '#/settings');

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'no sideways scrolling');
  assert.deepEqual(errors, []);
  console.log('MOBILE OK');
} catch (e) {
  failed = true;
  console.error('MOBILE FAILED:', e, '\nerrors:', errors);
} finally {
  await browser.close();
  server.kill();
  process.exit(failed ? 1 : 0);
}
