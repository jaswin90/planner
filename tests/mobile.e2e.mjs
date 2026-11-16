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

  // Touch gestures on timeline blocks (64 px = 1 hour on phones)
  await page.locator('.fab').click();
  await page.locator('.qa-title').fill('Workout');
  await page.locator('.qa-row input[type=time]').fill('10:00');
  await page.locator('.qa-foot .btn.primary').click();
  const ev = page.locator('.dv-event', { hasText: 'Workout' });
  await ev.waitFor();
  const timeIs = (txt) => page.waitForFunction((x) => [...document.querySelectorAll('.dv-event')].find((e) => e.textContent.includes('Workout'))?.querySelector('.ev-time').textContent === x, txt, { timeout: 4000 })
    .catch(async () => { throw new Error(`expected ${txt}, got ${await ev.locator('.ev-time').textContent()}`); });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const touchDrag = async (x, y, dx, dy, hold = 0) => {
    await touch('touchStart', x, y);
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', x + (dx * i) / 8, y + (dy * i) / 8); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await page.waitForTimeout(150);
  };
  await ev.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await timeIs('10:00–11:00');
  let bb = await ev.boundingBox();
  // A quick swipe over a block scrolls the page; it doesn't move the block
  await touchDrag(bb.x + 40, bb.y + bb.height / 2, 0, -60);
  await timeIs('10:00–11:00');
  // Press and hold, then drag: moves it
  bb = await ev.boundingBox();
  await touchDrag(bb.x + 40, bb.y + bb.height / 2, 0, 64, 500);
  await timeIs('11:00–12:00');
  assert.equal(await page.locator('dialog.sheet').count(), 0, 'a drag does not open the task');
  // Edges: drag the bottom down 30 min, then the top up 30 min (no hold needed)
  bb = await ev.boundingBox();
  await touchDrag(bb.x + 40, bb.y + bb.height - 5, 0, 32);
  await timeIs('11:00–12:30');
  bb = await ev.boundingBox();
  await touchDrag(bb.x + 40, bb.y + 5, 0, -32);
  await timeIs('10:30–12:30');
  // Hold and let go without moving: the task menu
  bb = await ev.boundingBox();
  await touch('touchStart', bb.x + 40, bb.y + bb.height / 2); await page.waitForTimeout(500); await touch('touchEnd');
  await page.locator('.tmenu .tm-it', { hasText: 'Mark done' }).waitFor();
  await page.keyboard.press('Escape');
  // Hold and drag onto tomorrow in the week strip: moves it to that day at the same time
  bb = await ev.boundingBox();
  const dayIdx = (new Date().getDay() + 6) % 7;
  const target = page.locator('.m-wd').nth(dayIdx === 6 ? 5 : dayIdx + 1);
  const tb = await target.boundingBox();
  await touchDrag(bb.x + 40, bb.y + bb.height / 2, tb.x + tb.width / 2 - bb.x - 40, tb.y + tb.height / 2 - bb.y - bb.height / 2, 500);
  await page.getByText(/^Moved to /).waitFor();
  await ev.waitFor({ state: 'detached' });
  await target.click();
  await timeIs('10:30–12:30');
  await page.locator('.m-wd.today').click();
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
