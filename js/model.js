// Plain data model. No DOM, no network: unit-tested in Node.
//
// The whole decrypted document is { schema, items: { [id]: item } }.
// Each item carries updatedAt (ms) and rev (device:counter) so two copies
// of the document can be merged item by item; deletes are tombstones.

export const SCHEMA = 1;
export const STATUSES = ['todo', 'doing', 'done', 'backlog'];
export const SECTIONS = [
  { key: 'unplanned', label: 'Unplanned' },
  { key: 'doing', label: 'Doing' },
  { key: 'planned', label: 'Planned' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'done', label: 'Done' },
];
export const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;

export function emptyDoc() {
  return { schema: SCHEMA, items: {} };
}

export function newId() {
  const b = new Uint8Array(12);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Newer wins; equal timestamps are broken by rev so all devices agree. */
export function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return String(a.rev || '') >= String(b.rev || '') ? a : b;
}

/** Merge two documents. Returns { doc, changedLocal, changedRemote }. */
export function mergeDocs(local, remote, now = Date.now()) {
  const out = emptyDoc();
  let changedLocal = false; // merged differs from `local`
  let changedRemote = false; // merged differs from `remote`
  const ids = new Set([...Object.keys(local?.items || {}), ...Object.keys(remote?.items || {})]);
  for (const id of ids) {
    const l = local?.items?.[id];
    const r = remote?.items?.[id];
    const w = newer(l, r);
    if (w.deleted && now - w.updatedAt > TOMBSTONE_TTL_MS) {
      if (l) changedLocal = true;
      if (r) changedRemote = true;
      continue;
    }
    out.items[id] = w;
    if (w !== l && !same(w, l)) changedLocal = true;
    if (w !== r && !same(w, r)) changedRemote = true;
  }
  return { doc: out, changedLocal, changedRemote };
}

function same(a, b) {
  return !!a && !!b && a.updatedAt === b.updatedAt && a.rev === b.rev;
}

/** Which sidebar section a task belongs to. */
export function sectionOf(task) {
  if (task.status === 'done') return 'done';
  if (task.status === 'backlog') return 'backlog';
  if (task.status === 'doing') return 'doing';
  return task.date ? 'planned' : 'unplanned';
}

export function liveItems(doc, type) {
  return Object.values(doc.items).filter((it) => !it.deleted && (!type || it.type === type));
}

/** Attachment ids referenced by notes/tasks (html data-att or attachments list). */
export function referencedAttachments(doc) {
  const used = new Set();
  for (const it of liveItems(doc)) {
    for (const id of it.attachments || []) used.add(id);
    const html = it.html || '';
    for (const m of html.matchAll(/data-att="([0-9a-f]{24})"/g)) used.add(m[1]);
  }
  return used;
}

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 6x7 grid of dates for a month view, weeks starting Monday. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({ date: isoDate(d), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  return days;
}

/** Strip HTML to plain text for search and previews (no DOM needed). */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
