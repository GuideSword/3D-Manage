'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('../../backend/node_modules/express');
const { createRelationalAgentDataPort } = require('../../backend/agent/adapters/relational');
const { createAgentRouter } = require('../../backend/modules/adapters/agent');

function request(app, path, options = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      try {
        const url = `http://127.0.0.1:${server.address().port}${path}`;
        const response = await fetch(url, { ...options, headers: { Authorization: 'Bearer fixture', ...(options.headers || {}) } });
        resolve({ status: response.status, body: await response.json() });
      } catch (error) { reject(error); } finally { server.close(); }
    });
    server.on('error', reject);
  });
}

test('relational agent port returns complete normalized lists and cursor metadata', async () => {
  const rows = [
    { id: 'o-1', customer: { name: '客户 A', email: 'a@example.test' }, items: [{ qty: 2, unitPrice: 3 }], notes: '备注', version: '1' },
    { id: 'o-2', customerName: '客户 B', items: [], notes: '', version: '1' },
  ];
  const services = { orders: { list: async () => ({ items: rows, total: rows.length }), get: async (_s, id) => rows.find(row => row.id === id) },
    models: { list: async () => ({ items: [], total: 0 }) }, materials: { list: async () => ({ items: [], total: 0 }) },
    inventory: { list: async () => ({ items: [], total: 0 }) } };
  const port = createRelationalAgentDataPort({ pool: {}, session: { actorId: 'staff', tokenVersion: '1' }, services });
  const result = await port.list('orders', { limit: 50 });
  assert.equal(result.total, 2);
  assert.equal(result.returned, 2);
  assert.equal(result.hasMore, false);
  assert.equal(result.items[0].customer.name, '客户 A');
  assert.equal(result.items[0].items[0].quantity, 2);
});

test('relational agent router authenticates and delegates list requests', async () => {
  const app = express(); app.use(express.json());
  const port = { list: async (entity) => ({ items: [{ id: 'm-1', name: '模型' }], total: 1, returned: 1, hasMore: false, nextCursor: null, truncated: false }),
    get: async () => ({ id: 'm-1', name: '模型' }) };
  app.use('/agent', createAgentRouter({ authenticate: async token => token === 'fixture' ? { actorId: 'staff', tokenVersion: '1', user: { role: 'staff' } } : null,
    createPort: () => port }));
  const response = await request(app, '/agent/records/models');
  assert.equal(response.status, 200);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.items[0].name, '模型');
});
