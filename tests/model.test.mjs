import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDocs, sectionOf, monthGrid, htmlToText, referencedAttachments, TOMBSTONE_TTL_MS } from '../js/model.js';

const doc = (...items) => ({ schema: 1, items: Object.fromEntries(items.map((i) => [i.id, i])) });

test('merge keeps the newer copy of each item', () => {
  const local = doc({ id: 'a', title: 'L', updatedAt: 2, rev: 'x:1' }, { id: 'b', title: 'Lb', updatedAt: 1, rev: 'x:2' });
  const remote = doc({ id: 'a', title: 'R', updatedAt: 1, rev: 'y:1' }, { id: 'b', title: 'Rb', updatedAt: 5, rev: 'y:2' }, { id: 'c', title: 'Rc', updatedAt: 1, rev: 'y:3' });
  const { doc: m, changedLocal, changedRemote } = mergeDocs(local, remote);
  assert.equal(m.items.a.title, 'L');
  assert.equal(m.items.b.title, 'Rb');
  assert.equal(m.items.c.title, 'Rc');
  assert.ok(changedLocal && changedRemote);
});

test('merge of identical docs reports no change', () => {
  const d = doc({ id: 'a', updatedAt: 1, rev: 'x:1' });
  const r = mergeDocs(d, structuredClone(d));
  assert.equal(r.changedLocal, false);
  assert.equal(r.changedRemote, false);
});

test('deletes win when newer, and old tombstones are purged', () => {
  const now = Date.now();
  const local = doc({ id: 'a', deleted: true, updatedAt: now, rev: 'x:1' }, { id: 'old', deleted: true, updatedAt: now - TOMBSTONE_TTL_MS - 1, rev: 'x:2' });
  const remote = doc({ id: 'a', title: 'still here', updatedAt: now - 10, rev: 'y:1' });
  const { doc: m } = mergeDocs(local, remote, now);
  assert.equal(m.items.a.deleted, true);
  assert.equal(m.items.old, undefined);
});

test('equal timestamps resolve the same way on both sides', () => {
  const a = doc({ id: 'a', v: 1, updatedAt: 5, rev: 'aaa:1' });
  const b = doc({ id: 'a', v: 2, updatedAt: 5, rev: 'bbb:1' });
  assert.equal(mergeDocs(a, b).doc.items.a.v, mergeDocs(b, a).doc.items.a.v);
});

test('sidebar sections', () => {
  assert.equal(sectionOf({ status: 'todo' }), 'unplanned');
  assert.equal(sectionOf({ status: 'todo', date: '2026-11-06' }), 'planned');
  assert.equal(sectionOf({ status: 'doing', date: '2026-11-06' }), 'doing');
  assert.equal(sectionOf({ status: 'done' }), 'done');
  assert.equal(sectionOf({ status: 'backlog' }), 'backlog');
});

test('month grid starts on Monday and has 42 days', () => {
  const g = monthGrid(2026, 10); // November 2026 starts on a Sunday
  assert.equal(g.length, 42);
  assert.equal(g[0].date, '2026-10-26');
  assert.equal(g[6].date, '2026-11-01');
  assert.equal(g[6].inMonth, true);
});

test('html to text and attachment references', () => {
  assert.equal(htmlToText('<p>Hi &amp; <b>there</b></p><p>x</p>'), 'Hi & there\nx');
  const d = doc({ id: 'n', type: 'note', html: '<img data-att="0123456789abcdef01234567">', attachments: ['aaaaaaaaaaaaaaaaaaaaaaaa'], updatedAt: 1 });
  assert.deepEqual([...referencedAttachments(d)].sort(), ['0123456789abcdef01234567', 'aaaaaaaaaaaaaaaaaaaaaaaa']);
});
