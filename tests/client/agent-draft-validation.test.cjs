'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { orderDraftSchema, normalizeOrderDraft, missingOrderDraftFields } = require('../../backend/agent/contracts/drafts');

test('missing_fields 根据规范化后的实际值计算', () => {
  const draft = normalizeOrderDraft({ customer_name: ' 客户 ', items: [{ material_type: 'PLA', qty: '2', unit_price: '3' }], missing_fields: ['customer_name'] });
  assert.equal(draft.customer_name, '客户');
  assert.deepEqual(draft.missing_fields, []);
  assert.deepEqual(missingOrderDraftFields(draft), []);
});

test('草稿校验会标记真实缺失项并拒绝无订单行', () => {
  const draft = normalizeOrderDraft({ customer_name: ' ', items: [] });
  assert.deepEqual(draft.missing_fields, ['customer_name', 'items']);
  assert.equal(orderDraftSchema.safeParse({ customer_name: '客户', items: [] }).success, false);
});

test('数量和单价转换为有限数字，非法值保持缺失', () => {
  const draft = normalizeOrderDraft({ customer_name: '客户', items: [{ material_type: 'PLA', qty: '2.5', unit_price: '3.2' }, { material_type: 'ABS', qty: 'nope', unit_price: Infinity }] });
  assert.equal(draft.items[0].qty, 2.5);
  assert.equal(draft.items[0].unit_price, 3.2);
  assert.ok(draft.missing_fields.includes('items[1].qty'));
  assert.ok(draft.missing_fields.includes('items[1].unit_price'));
});
