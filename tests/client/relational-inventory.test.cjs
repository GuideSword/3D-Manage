'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGrams, formatGrams, compareGrams, validateSummary, summarizeInventory, createRelationalInventoryApi } = require('../../utils/relationalInventoryCore.cjs');
const runtime = { serverKey: 'A', apiBaseUrl: 'http://127.0.0.1/api', capabilities: { businessRulesVersion: 2, relationalBusiness: true } };
const summary = (id, total, available, count = 1) => ({ materialId: id, totalQtyMg: total, availableQtyMg: available, totalQty: formatGrams(total), availableQty: formatGrams(available), lotCount: count, balanceIncomplete: false, legacyUnverified: false });
test('inventory grams support the full bigint boundary, exact milligrams and accurate comparisons', () => {
  assert.equal(parseGrams('9223372036854775.807'), 9223372036854775807n); assert.equal(formatGrams(parseGrams('100.001')), '100.001'); assert.equal(formatGrams(0n), '0');
  assert.equal(compareGrams('9007199254740.993', '9007199254740.992'), 1);
  for (const value of ['9223372036854775.808', '-1', '1.0001', '1e3', 1.1, 9007199254740992]) assert.throws(() => parseGrams(value));
});
test('whole-inventory summary adds integer milligrams without concatenating quantities or rounding', () => {
  const input = [summary('a', '9007199254740993', '100001', 205), summary('b', '1', '1', 2)]; input[1].balanceIncomplete = true;
  assert.equal(validateSummary(input), input); const result = summarizeInventory(input);
  assert.equal(result.totalQty, '9007199254740.994'); assert.equal(result.availableQty, '100.002'); assert.equal(result.lotCount, 207); assert.equal(result.balanceIncomplete, true);
  for (const invalid of [[input[0], input[0]], [{ ...input[0], totalQty: '1' }], [{ ...input[0], lotCount: -1 }], [{ ...input[0], availableQtyMg: '9999999999999999999' }]]) assert.throws(() => validateSummary(invalid));
});
test('inventory read API preserves paging and strict summary filters', async () => {
  const calls = []; const api = createRelationalInventoryApi({ getRuntime: () => runtime, request: async (path, options) => { calls.push({ path, ...options }); return path.startsWith('/inventory/summary') ? [] : { items: [], total: 0 }; } });
  await api.getLotsPage({ materialId: 'm/a', limit: 100, offset: 200 }); await api.getTransactionsPage({ lotId: 'lot', limit: 20 }); await api.getSummary({ materialId: 'm/a' });
  assert.match(calls[0].path, /\/inventory\/lots\?materialId=m%2Fa&limit=100&offset=200/); assert.match(calls[1].path, /^\/inventory\/transactions/); assert.match(calls[2].path, /^\/inventory\/summary/);
  assert.throws(() => api.getLotsPage({ limit: 201 })); assert.throws(() => api.getSummary({ unsupported: true }));
});
test('inventory writes require explicit keys/read versions and preserve quantity strings', async () => {
  const calls = []; const api = createRelationalInventoryApi({ getRuntime: () => runtime, request: async (path, options) => { calls.push({ path, ...options }); return {}; } });
  await api.createLot({ materialId: 'm', lotNo: 'LOT', qty: '9007199254740.993' }, 'create');
  await api.updateLot('lot/a', { version: '9007199254740993', changes: { notes: '', active: false } }, 'edit');
  await api.post({ lotId: 'lot/a', version: '2', type: 'adjust', qty: '0', notes: '盘点' }, 'count'); await api.deleteLot('empty', '3', 'delete');
  await api.setState('frozen', { version: '8', state: 'frozen' }, 'state'); await api.archiveLot('archive', '9', 'archive');
  assert.equal(JSON.parse(calls[0].body).qty, '9007199254740.993'); assert.equal(calls[1].path, '/inventory/lots/lot%2Fa'); assert.deepEqual(JSON.parse(calls[1].body), { version: '9007199254740993', changes: { notes: '', active: false } });
  assert.deepEqual(JSON.parse(calls[3].body), { version: '3' }); assert.equal(JSON.parse(calls[2].body).qty, '0'); assert.equal(JSON.parse(calls[2].body).unit, 'g');
  for (let i = 0; i < calls.length; i++) assert.deepEqual(calls[i].headers, { 'X-Business-Rules-Version': '2', 'Idempotency-Key': ['create', 'edit', 'count', 'delete', 'state', 'archive'][i] });
  assert.equal(calls[4].path, '/inventory/lots/frozen/state'); assert.deepEqual(JSON.parse(calls[4].body), { version: '8', state: 'frozen' }); assert.equal(calls[5].path, '/inventory/lots/archive/archive'); assert.deepEqual(JSON.parse(calls[5].body), { version: '9' });
  assert.throws(() => api.setState('lot', { version: '1', state: 'unknown' }, 'bad'));
  assert.throws(() => api.post({ lotId: 'lot', type: 'out', qty: '1' }, 'bad')); assert.throws(() => api.updateLot('lot', { version: '1', changes: { qty: '1' } }, 'bad'));
  assert.throws(() => api.createLot({ materialId: 'm', qty: '1' }));
});

test('transaction forms preserve selected lot versions and compare exact available stock', () => {
  const { inventoryTransactionPayload } = require('../../utils/relationalInventoryCore.cjs');
  const lot = { id: 'lot', version: '9007199254740993', qty: '9007199254740.993', active: true, state: 'in_stock', balanceStatus: 'tracked' };
  const form = { mode: 'existing', lotId: 'lot', qty: '9007199254740.993', notes: '' };
  assert.deepEqual(inventoryTransactionPayload('out', form, lot), { lotId: 'lot', version: '9007199254740993', type: 'out', qty: '9007199254740.993', unit: 'g', notes: '' });
  assert.throws(() => inventoryTransactionPayload('out', { ...form, qty: '9007199254740.994' }, lot), /库存不足/);
  assert.equal(inventoryTransactionPayload('adjust', { ...form, qty: '0' }, lot).qty, '0');
  assert.throws(() => inventoryTransactionPayload('in', { ...form, qty: '0' }, lot));
  assert.throws(() => inventoryTransactionPayload('out', form, { ...lot, state: 'frozen' }));
  assert.throws(() => inventoryTransactionPayload('out', form, { ...lot, active: false }));
  assert.throws(() => inventoryTransactionPayload('out', form, { ...lot, id: 'other' }));
});
test('new-lot forms send only material metadata and exact grams without inventing balance or ledger fields', () => {
  const { inventoryTransactionPayload } = require('../../utils/relationalInventoryCore.cjs');
  const result = inventoryTransactionPayload('in', { mode: 'new', materialId: 'm', lotNo: ' LOT ', location: '', notes: '', qty: '1.001' });
  assert.deepEqual(result, { materialId: 'm', lotNo: 'LOT', location: '', notes: '', qty: '1.001', unit: 'g' });
  assert.throws(() => inventoryTransactionPayload('in', { mode: 'new', materialId: 'm', lotNo: '', qty: '1' }));
});
