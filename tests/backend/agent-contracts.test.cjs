'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ENTITY_NAMES,
  ENTITY_DEFINITIONS,
  normalizeOrder,
  normalizeModel,
  normalizeMaterial,
  normalizeInventoryLot,
  normalizeRecord,
  toListResponse,
} = require('../../backend/agent/contracts/entities');

test('四类实体契约均可描述并统一输出记录', () => {
  assert.deepEqual(ENTITY_NAMES, ['orders', 'models', 'materials', 'inventory']);
  for (const name of ENTITY_NAMES) {
    assert.ok(ENTITY_DEFINITIONS[name]);
    assert.equal(normalizeRecord(name, { id: 'x' }).id, 'x');
  }
  assert.equal(normalizeModel({ id: 1, name: '模型' }).id, '1');
  assert.equal(normalizeMaterial({ id: 2, type: 'PLA' }).materialType, 'PLA');
  assert.equal(normalizeInventoryLot({ id: 3, material_id: 'm', qty_g: '1.5' }).materialId, 'm');
});

test('订单客户名兼容嵌套、旧字段和快照', () => {
  assert.equal(normalizeOrder({ customer: { name: '嵌套' }, customerName: '旧', customerSnapshot: { name: '快照' } }).customer.name, '嵌套');
  assert.equal(normalizeOrder({ customerName: '旧', customerSnapshot: { name: '快照' } }).customer.name, '旧');
  assert.equal(normalizeOrder({ customerSnapshot: { name: '快照' } }).customer.name, '快照');
});

test('列表 DTO 保留订单明细、备注、客户联系方式', () => {
  const row = normalizeOrder({ id: '1', customer: { name: '客户', email: 'a@b.test', phone: '1' }, items: [{ qty: 2, unitPrice: 3 }], notes: '备注' });
  assert.equal(row.items[0].quantity, 2);
  assert.equal(row.items[0].subtotal, 6);
  assert.equal(row.customer.email, 'a@b.test');
  assert.equal(row.notes, '备注');
});

test('列表响应包含完整分页元数据', () => {
  assert.deepEqual(toListResponse([{ id: '1' }], { total: 2, nextCursor: 'next', hasMore: true }), {
    items: [{ id: '1' }], total: 2, returned: 1, hasMore: true, nextCursor: 'next', truncated: false,
  });
});
