'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionLifecycleCore } = require('../../utils/sessionLifecycleCore.cjs');
const { supportsMasterData, partnerToForm, formToPartner, recordVersion, createBusinessCommandController, createMasterDataApi } = require('../../utils/masterDataCore.cjs');
const server = { apiBaseUrl: 'http://isolated/api', serverKey: 'server-a', capabilities: { businessRulesVersion: 2, relationalBusiness: true } };
const scope = { serverKey: 'server-a', sessionEpoch: 1, userId: 'staff' };

test('master-data capability follows current server and cannot survive replacement or removal', () => {
  const lifecycle = createSessionLifecycleCore();
  lifecycle.setServer(server);
  assert.equal(supportsMasterData(lifecycle.get()), true);
  assert.equal(Object.isFrozen(lifecycle.get().capabilities), true);
  lifecycle.setServer({ apiBaseUrl: 'http://other/api', serverKey: 'server-b' });
  assert.equal(supportsMasterData(lifecycle.get()), false);
  lifecycle.setServer(null);
  assert.equal(supportsMasterData(lifecycle.get()), false);
  for (const capabilities of [{ businessRulesVersion: 2 }, { relationalBusiness: true, businessRulesVersion: 3 }, { relationalBusiness: true, businessRulesVersion: '2' }]) {
    assert.equal(supportsMasterData({ ...server, capabilities }), false);
  }
});
test('partner forms retain Unicode and multiline notes, clear blanks and do not submit protected fields', () => {
  const form = partnerToForm({ code: 'C1', name: '客户', phone: null, notes: '第一行\n 第二行 ', version: '9007199254740993', active: false, unknown: 'extra' });
  assert.deepEqual(formToPartner({ ...form, code: ' C1 ', name: ' 客户 ', address: '  ', email: '' }),
    { code: 'C1', name: '客户', contactName: '', email: '', phone: '', address: '', notes: '第一行\n 第二行 ' });
  assert.deepEqual(formToPartner({ notes: '' }, { partial: true }), { notes: '' });
  for (const invalid of [{ ...form, name: ' ' }, { ...form, code: '' }, { ...form, version: '2' }, { ...form, name: 'x'.repeat(241) }, { ...form, phone: 138 }]) {
    assert.throws(() => formToPartner(invalid), { code: 'MASTER_DATA_INPUT_INVALID' });
  }
  assert.equal(recordVersion('9007199254740993'), '9007199254740993');
  for (const invalid of [0, -1, 1.1, 9007199254740992, '1e3', '01', '9223372036854775808', undefined]) assert.throws(() => recordVersion(invalid));
});
test('partner and warehouse API bind endpoints, versions and idempotency keys without numeric conversion', async () => {
  const calls = [];
  let current = server;
  const api = createMasterDataApi({ request: async (path, options) => { calls.push({ path, ...options }); return { id: 'result' }; }, getRuntime: () => current });
  const customers = api.partners('customers');
  await customers.getPage({ search: '同名 & 空格', active: 'false', limit: 50 });
  assert.match(calls[0].path, /search=%E5%90%8C%E5%90%8D%20%26%20%E7%A9%BA%E6%A0%BC/);
  await customers.update('id/child', { version: '9007199254740993', changes: { notes: '' } }, 'update-key');
  assert.equal(calls[1].path, '/customers/id%2Fchild');
  assert.deepEqual(JSON.parse(calls[1].body), { version: '9007199254740993', changes: { notes: '' } });
  assert.deepEqual(calls[1].headers, { 'X-Business-Rules-Version': '2', 'Idempotency-Key': 'update-key' });
  await api.partners('suppliers').setActive('supplier', { version: '2', active: false }, 'disable');
  assert.equal(calls[2].path, '/suppliers/supplier/active');
  await customers.delete('customer', '3', 'delete');
  assert.deepEqual(JSON.parse(calls[3].body), { version: '3' });
  await api.warehouses.update({ id: 'w', version: '4', name: ' 仓库 ' }, 'warehouse');
  assert.deepEqual(JSON.parse(calls[4].body), { id: 'w', version: '4', changes: { name: '仓库' } });
  assert.throws(() => customers.setActive('id', { version: '1', active: 'false' }, 'bad'));
  assert.throws(() => api.partners('__proto__'));
  current = { ...server, capabilities: {} };
  assert.throws(() => customers.getById('customer'), { code: 'MASTER_DATA_UNAVAILABLE' });
  assert.equal(calls.length, 5);
});
test('transport and authorization failures remain unchanged for normal API session handling', async () => {
  for (const status of [401, 403, 409, 503]) {
    const error = Object.assign(new Error('测试错误'), { status });
    const api = createMasterDataApi({ getRuntime: () => server, request: async () => { throw error; } });
    await assert.rejects(api.partners('customers').getById('customer'), actual => actual === error);
  }
});
test('business commands preserve key/content after ambiguous failure and forbid cross-account retries', async () => {
  let keys = 0, calls = 0;
  const controller = createBusinessCommandController(() => `key-${++keys}`);
  const payload = { version: '1', changes: { notes: '' } };
  await assert.rejects(controller.run('customer.update', payload, scope, async () => { throw Object.assign(new Error('503'), { status: 503 }); }));
  for (const other of [{ ...scope, userId: 'owner' }, { ...scope, serverKey: 'server-b' }, { ...scope, sessionEpoch: 2 }]) {
    await assert.rejects(controller.run('customer.update', payload, other, async () => { calls++; }), { code: 'BUSINESS_RETRY_PENDING' });
  }
  await assert.rejects(controller.run('customer.update', { version: '2', changes: { notes: '改内容' } }, scope, async () => { calls++; }), { code: 'BUSINESS_RETRY_PENDING' });
  assert.equal(calls, 0);
  const result = await controller.run('customer.update', payload, scope, async (sent, key) => ({ sent, key }));
  assert.equal(result.key, 'key-1');
  assert.deepEqual(result.sent, payload);
  assert.equal(await controller.run('customer.update', payload, scope, async () => { calls++; }), null);
});
test('business commands reject duplicate clicks, unlock after definite conflict and support reusable actions', async () => {
  let finish, calls = 0, keys = 0;
  const controller = createBusinessCommandController(() => `key-${++keys}`, { reusable: true });
  const first = controller.run('customer.create', { name: 'A' }, scope, async () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  assert.equal(await controller.run('customer.create', { name: 'A' }, scope, async () => { calls++; }), null);
  finish({ id: 'a' }); await first;
  assert.equal(calls, 1);
  await assert.rejects(controller.run('customer.update', { version: '1' }, scope, async () => { throw Object.assign(new Error('冲突'), { status: 409 }); }));
  assert.equal(await controller.run('customer.update', { version: '2' }, scope, async (_body, key) => key), 'key-3');
  await assert.rejects(controller.run('customer.create', {}, { ...scope, userId: null }, async () => {}), { code: 'BUSINESS_SESSION_REQUIRED' });
});
