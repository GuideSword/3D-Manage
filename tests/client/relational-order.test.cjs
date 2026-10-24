'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../utils/relationalOrderCore.cjs');
const display = require('../../utils/orderDisplayCore.cjs');
const original = {
  id: 'order', customerId: 'customer-a', customer: { name: '历史名称', phone: '旧电话' }, version: '9007199254740993', status: 'pending_review',
  notes: '旧备注', dueDate: '2026-11-01T08:00:00.000Z', total: '9007199254740993.01', attachments: [{ fileKey: 'keep.pdf' }],
  items: [{ id: 'line', modelId: 'removed-model', modelName: '历史模型', quantity: '1.000', unitPrice: '5.000000', subtotal: '5.01', color: '白色', materialType: 'PLA', notes: '原说明', unknown: '9007199254740993.01' }],
};
test('order details display stored amounts and full precision instead of recomputing historic facts', () => {
  assert.equal(display.amount('9007199254740993.01'), '9007199254740993.01');
  assert.equal(display.amount('0'), '0.00');
  assert.equal(display.lineAmount({ quantity: '1', unitPrice: '5', subtotal: '5.01' }), '5.01');
  assert.equal(display.unitPrice('25.000001'), '25.000001');
  assert.equal(display.lineAmount({ quantity: '0.001', unitPrice: '5' }), '0.01');
  assert.equal(display.amount(undefined), '—');
});

test('order mapping keeps original customer, historical model ID, exact values and date', () => {
  const form = core.orderToForm(original);
  assert.equal(form.customerId, 'customer-a');
  assert.equal(form.dueDate, original.dueDate);
  assert.equal(form.items[0].unitPrice, '5.000000');
  assert.equal(form.items[0].modelId, 'removed-model');
  assert.deepEqual(core.orderPayload(form, original), { version: original.version, changes: {} });
  const cleared = core.orderPayload({ ...form, notes: '', dueDate: '' }, original);
  assert.deepEqual(cleared, { version: original.version, changes: { notes: '', dueDate: null } });
  assert.equal(JSON.stringify(cleared).includes('attachments'), false);
});
test('new order requires explicit customer ID, strips client pricing/IDs, and previews rounded lines exactly', () => {
  const form = { ...core.orderToForm(), customerId: 'chosen-by-id', items: [
    { ...core.newLine(), id: 'client-id', modelId: 'model', quantity: '0.001', unitPrice: '5', subtotal: '99' },
    { ...core.newLine(), modelId: 'model', quantity: '0.001', unitPrice: '5' },
  ] };
  const payload = core.orderPayload(form);
  assert.equal(payload.customerId, 'chosen-by-id');
  assert.equal(payload.items[0].quantity, '0.001');
  assert.equal(payload.items[0].unitPrice, '5');
  assert.equal(Object.hasOwn(payload.items[0], 'id'), false);
  assert.equal(Object.hasOwn(payload.items[0], 'subtotal'), false);
  assert.equal(Object.hasOwn(payload, 'total'), false);
  assert.equal(core.previewTotal(form.items), '0.02');
  assert.equal(core.previewTotal([{ quantity: '1', unitPrice: '99999999999999.999999' }]), '100000000000000.00');
  assert.throws(() => core.orderPayload({ ...form, customerId: '' }), { code: 'CUSTOMER_SELECTION_REQUIRED' });
  assert.throws(() => core.orderPayload({ ...form, items: [{ ...form.items[0], modelId: '' }] }), { code: 'ORDER_FORM_INVALID' });
});
test('only notes use description-only row patches and retain stored amounts in any status', () => {
  for (const status of ['draft', 'pending_review', 'in_progress', 'completed', 'cancelled']) {
    const record = { ...original, status };
    const form = core.orderToForm(record);
    form.items[0].notes = '';
    assert.deepEqual(core.orderPayload(form, record), { version: original.version, changes: { items: [{ id: 'line', notes: '' }] } });
  }
});
test('commercial changes keep real existing IDs but reject changes after execution', () => {
  const form = core.orderToForm(original);
  form.items[0].quantity = '2.001';
  form.items.push({ ...core.newLine(), modelId: 'new-model', quantity: '1', unitPrice: '0' });
  const payload = core.orderPayload(form, original);
  assert.equal(payload.changes.items[0].id, 'line');
  assert.equal(payload.changes.items[0].quantity, '2.001');
  assert.equal(Object.hasOwn(payload.changes.items[1], 'id'), false);
  assert.equal(Object.hasOwn(payload.changes.items[0], 'unknown'), false);
  for (const status of ['in_progress', 'completed', 'cancelled']) assert.throws(() => core.orderPayload(form, { ...original, status }), { code: 'ORDER_COMMERCIAL_LOCKED' });
  assert.throws(() => core.orderPayload({ ...core.orderToForm(original), customerId: 'other' }, { ...original, status: 'in_progress' }), { code: 'ORDER_COMMERCIAL_LOCKED' });
  assert.throws(() => core.orderPayload(form, { ...original, status: 'draft', commercialEditable: false }), { code: 'ORDER_COMMERCIAL_LOCKED' });
});
test('missing historical model references and old snapshots do not become guessed new IDs', () => {
  const record = { ...original, items: [{ ...original.items[0], modelId: '' }] };
  const form = core.orderToForm(record);
  assert.equal(form.items[0].modelId, '');
  form.items[0].notes = '补充';
  assert.deepEqual(core.orderPayload(form, record).changes.items, [{ id: 'line', notes: '补充' }]);
  const swapped = core.orderPayload({ ...form, customerId: 'other' }, record);
  assert.equal(swapped.changes.customerId, 'other');
  assert.equal(Object.hasOwn(swapped.changes, 'customer'), false);
});
test('unrelated edits do not resubmit or validate unchanged historical specification quirks', () => {
  const record = { ...original, items: [{ ...original.items[0], layerHeightMm: '-1', externalFileUrl: 'old-scheme:preserved' }] };
  const form = core.orderToForm(record);
  form.items[0].notes = '补充说明';
  assert.deepEqual(core.orderPayload(form, record).changes.items, [{ id: 'line', notes: '补充说明' }]);
  form.items[0].unitPrice = '6';
  const patch = core.orderPayload(form, record).changes.items[0];
  assert.equal(Object.hasOwn(patch, 'layerHeightMm'), false);
  assert.equal(Object.hasOwn(patch, 'externalFileUrl'), false);
  assert.equal(patch.unitPrice, '6');
  assert.equal(core.previewTotal(core.orderToForm(original).items, original), original.total);
});
test('invalid precision, unsafe numbers, bogus line identities and invalid dates are rejected', () => {
  for (const value of ['1.0001', '1e3', '-1', '0']) {
    const form = core.orderToForm(original); form.items[0].quantity = value;
    assert.throws(() => core.orderPayload(form, original));
  }
  for (const value of ['1.0000001', 1.1, 9007199254740992]) {
    const form = core.orderToForm(original); form.items[0].unitPrice = value;
    assert.throws(() => core.orderPayload(form, original));
  }
  const form = core.orderToForm(original);
  form.items[0].id = 'fake';
  assert.throws(() => core.orderPayload(form, original), { code: 'ORDER_FORM_INVALID' });
  assert.throws(() => core.orderPayload({ ...core.orderToForm(original), dueDate: '2026-02-30' }, original), { code: 'ORDER_FORM_INVALID' });
});
