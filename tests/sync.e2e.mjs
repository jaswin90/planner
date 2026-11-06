// Two devices share one fake Drive; edits on each must merge both ways,
// and attachments must cross over. Run: node tests/sync.e2e.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = spawn('python3', ['-m', 'http.server', '8767', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
let code = 0;
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8767/tests/blank.html');
  const out = await page.evaluate(async () => {
    const { Vault } = await import('/js/vault.js');
    const files = new Map(); // fake Drive
    const remote = () => ({
      async get(n) { return files.has(n) ? { bytes: files.get(n).slice(), version: 1 } : null; },
      async put(n, b) { files.set(n, new Uint8Array(b instanceof Blob ? await b.arrayBuffer() : b)); return 1; },
      async del(n) { files.delete(n); },
      async wipe() { files.clear(); },
    });
    const A = new Vault({ id: 'A', mode: 'google' }, remote());
    await A.open();
    const B = new Vault({ id: 'B', mode: 'google' }, remote());
    await B.open(); // picks up A's key from the shared Drive
    const n1 = A.put({ type: 'note', title: 'from A', attachments: [] });
    const att = await A.addAttachment(new File(['hello pdf'], 'x.pdf', { type: 'application/pdf' }), n1.id);
    A.update(n1.id, { attachments: [att] });
    const t1 = B.put({ type: 'task', title: 'from B', status: 'todo' });
    await A.sync(); await B.sync(); await A.sync();
    const plain = [...files.values()].map((b) => new TextDecoder('latin1').decode(b)).join('');
    const url = await B.attachmentUrl(att);
    const text = await (await fetch(url)).text();
    B.remove(n1.id); await B.sync(); await A.sync();
    return {
      aHasB: A.get(t1.id)?.title, bHasA: n1.id in B.doc.items, attText: text,
      leaked: ['from A', 'from B', 'hello pdf', 'x.pdf'].filter((w) => plain.includes(w)),
      deletedOnA: A.get(n1.id) === null, attGone: !files.has(`att-${att}.bin`),
      status: [A.status.state, B.status.state],
    };
  });
  console.log(out);
  const ok = out.aHasB === 'from B' && out.bHasA && out.attText === 'hello pdf' && !out.leaked.length && out.deletedOnA && out.attGone && out.status.every((s) => s === 'synced');
  console.log(ok ? 'SYNC OK' : 'SYNC FAILED');
  code = ok ? 0 : 1;
} catch (e) { console.error(e); code = 1; } finally { await browser.close(); server.kill(); process.exit(code); }
