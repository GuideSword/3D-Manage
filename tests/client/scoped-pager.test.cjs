'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createScopedPager } = require('../../utils/scopedPagerCore.cjs');
const scope = { serverKey: 'A', sessionEpoch: 1, userId: 'owner' };
const rows = n => Array.from({ length: n }, (_, i) => ({ id: String(i), qty: '999999999999999.999' }));
test('pager loads subsequent pages explicitly and keeps exact DTO values and authoritative total', async () => {
  const data = rows(205), calls = [];
  const pager = createScopedPager({ getScope: () => scope, fetchPage: async query => { calls.push(query); return { items: data.slice(query.offset, query.offset + query.limit), total: data.length }; } });
  await pager.refresh({ materialId: 'm' });
  assert.equal(pager.getSnapshot().items.length, 100); assert.equal(pager.getSnapshot().total, 205); assert.equal(pager.getSnapshot().hasMore, true);
  await pager.loadMore(); await pager.loadMore();
  assert.equal(pager.getSnapshot().items.length, 205); assert.equal(pager.getSnapshot().hasMore, false); assert.equal(pager.getSnapshot().items[204].qty, '999999999999999.999');
  assert.deepEqual(calls.map(q => q.offset), [0, 100, 200]); assert.ok(calls.every(q => q.materialId === 'm'));
});
test('failed next page preserves rows and retries exactly its offset; failed initial read remains an error', async () => {
  let fail = true; const calls = [];
  const pager = createScopedPager({ getScope: () => scope, fetchPage: async q => { calls.push(q.offset); if (q.offset === 100 && fail) throw Error('读取失败'); return { items: rows(101).slice(q.offset, q.offset + q.limit), total: 101 }; } });
  await pager.refresh(); await pager.loadMore(); assert.equal(pager.getSnapshot().items.length, 100); assert.equal(pager.getSnapshot().error, '读取失败');
  fail = false; await pager.loadMore(); assert.deepEqual(calls, [0, 100, 100]); assert.equal(pager.getSnapshot().items.length, 101);
  const bad = createScopedPager({ getScope: () => scope, fetchPage: async () => { throw Error('读取失败'); } }); await bad.refresh();
  assert.equal(bad.getSnapshot().total, null); assert.equal(bad.getSnapshot().error, '读取失败');
});
test('server/account scope changes discard late pages and never append rows from another account', async () => {
  let current = scope, release;
  const pager = createScopedPager({ getScope: () => current, fetchPage: () => new Promise(resolve => { release = resolve; }) });
  const pending = pager.refresh(); current = { ...scope, userId: 'staff', sessionEpoch: 2 }; release({ items: rows(1), total: 1 }); await pending;
  assert.deepEqual(pager.getSnapshot().items, []); assert.equal(pager.getSnapshot().total, null);
  const changed = pager.refresh(); current = { ...current, serverKey: 'B', sessionEpoch: 3 }; release({ items: rows(1), total: 1 }); await changed; assert.deepEqual(pager.getSnapshot().items, []);
});
test('new search supersedes an in-flight old search and stale errors cannot erase fresh results', async () => {
  const waiting = new Map(); const pager = createScopedPager({ getScope: () => scope, fetchPage: q => new Promise((resolve, reject) => waiting.set(q.search, { resolve, reject })) });
  const old = pager.refresh({ search: 'old' }), fresh = pager.refresh({ search: 'new' });
  waiting.get('new').resolve({ items: [{ id: 'new' }], total: 1 }); await fresh;
  waiting.get('old').reject(Error('旧请求失败')); await old; assert.deepEqual(pager.getSnapshot().items, [{ id: 'new' }]); assert.equal(pager.getSnapshot().error, '');
});
test('malformed, duplicate or shifted pages require refresh instead of pretending all records were read', async () => {
  for (const response of [{ items: rows(1), total: -1 }, { items: [{ id: '' }], total: 1 }, { items: [], total: 10 }, { items: rows(2), total: 1 }]) {
    const pager = createScopedPager({ getScope: () => scope, fetchPage: async () => response }); await pager.refresh(); assert.ok(pager.getSnapshot().error); assert.equal(pager.getSnapshot().total, null);
  }
  const pager = createScopedPager({ getScope: () => scope, fetchPage: async q => ({ items: q.offset ? [{ id: '0' }] : rows(100), total: 101 }) });
  await pager.refresh(); await pager.loadMore(); assert.equal(pager.getSnapshot().items.length, 100); assert.match(pager.getSnapshot().error, /刷新/);
});

test('scope invalidation clears visible state without fetching new-account data implicitly', async () => {
  let calls = 0, notifications = 0; const pager = createScopedPager({ getScope: () => scope, fetchPage: async () => { calls++; return { items: rows(1), total: 1 }; } });
  const unsubscribe = pager.subscribe(() => notifications++); await pager.refresh(); const before = notifications;
  pager.invalidate(); assert.deepEqual(pager.getSnapshot().items, []); assert.equal(pager.getSnapshot().total, null); assert.equal(calls, 1); assert.ok(notifications > before); unsubscribe();
});
