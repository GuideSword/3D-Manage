'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../../backend/agent/contracts/entities');

function makeOrders(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(count - index),
    customer: { name: `客户 ${count - index}`, email: `c${index}@example.test` },
    items: [{ materialType: 'PLA', qty: 1, unitPrice: index + 1 }],
    status: 'draft',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  }));
}

test('legacy agent port returns complete DTOs and reliable cursors', async () => {
  const store = require('../../backend/utils/store');
  const original = store.withData;
  store.withData = async (reader) => reader({ orders: makeOrders(205), models: [], materials: [], stockLots: [], inventoryTxns: [], customers: [] });
  try {
    const { createLegacyAgentDataPort } = require('../../backend/agent/adapters/legacy');
    const port = createLegacyAgentDataPort({ actor: { id: '1', role: 'owner' } });
    const first = await port.list('orders', { limit: 50 });
    assert.equal(first.total, 205);
    assert.equal(first.returned, 50);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);
    assert.equal(first.items[0].customer.name, '客户 1');
    assert.equal(first.items[0].items[0].quantity, 1);

    const all = await port.list('orders', { all: true, limit: 50 });
    assert.equal(all.items.length, 200);
    assert.equal(all.truncated, true);
  } finally {
    store.withData = original;
  }
});

test('legacy agent port supports search and detail normalization', async () => {
  const store = require('../../backend/utils/store');
  const original = store.withData;
  store.withData = async (reader) => reader({
    orders: [{ id: '1', customerName: '旧字段客户', notes: '重点订单', items: [{ qty: 2, unit_price: 3 }] }],
    models: [], materials: [], stockLots: [], inventoryTxns: [], customers: [],
  });
  try {
    const { createLegacyAgentDataPort } = require('../../backend/agent/adapters/legacy');
    const port = createLegacyAgentDataPort({ actor: { id: '1', role: 'viewer' } });
    const listed = await port.list('orders', { search: '旧字段客户' });
    assert.equal(listed.items[0].customer.name, '旧字段客户');
    assert.equal(listed.items[0].items[0].subtotal, 6);
    const detail = await port.get('orders', '1');
    assert.equal(detail.notes, '重点订单');
  } finally {
    store.withData = original;
  }
});

