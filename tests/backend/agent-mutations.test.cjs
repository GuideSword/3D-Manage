'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function fixtureStore() {
  return {
    system: { serverId: 'server-1' },
    orders: [{ id: '1', customer: { name: '原客户' }, items: [{ materialType: 'PLA', qty: 1, unitPrice: 2 }], version: 1, updatedAt: 'v1' }],
    models: [], materials: [], stockLots: [], inventoryTxns: [], auditLogs: [],
  };
}

test('legacy mutation proposals require a writer and explicit confirmation path', async () => {
  const store = require('../../backend/utils/store');
  const original = store.withData;
  const data = fixtureStore();
  store.withData = async (fn, options) => {
    if (options?.write === false) return fn(data);
    return fn(data);
  };
  try {
    const { createLegacyAgentDataPort } = require('../../backend/agent/adapters/legacy');
    const viewer = createLegacyAgentDataPort({ actor: { id: '2', role: 'viewer' } });
    await assert.rejects(viewer.prepareUpdate('orders', '1', { notes: 'x' }, { id: '2', role: 'viewer' }), { code: 'BUSINESS_FORBIDDEN' });

    const port = createLegacyAgentDataPort({ actor: { id: '1', role: 'owner' } });
    const proposal = await port.prepareUpdate('orders', '1', { notes: '已确认' }, { id: '1', role: 'owner' });
    assert.equal(data.orders[0].notes, undefined);
    const updated = await port.confirmMutation(proposal, { id: '1', role: 'owner' }, 'mutation-1');
    assert.equal(updated.notes, '已确认');
    assert.equal(data.orders[0].notes, '已确认');
  } finally {
    store.withData = original;
  }
});

test('legacy mutation proposals reject tampering and stale versions', async () => {
  const store = require('../../backend/utils/store');
  const original = store.withData;
  const data = fixtureStore();
  store.withData = async (fn, options) => options?.write === false ? fn(data) : fn(data);
  try {
    const { createLegacyAgentDataPort } = require('../../backend/agent/adapters/legacy');
    const actor = { id: '1', role: 'owner' };
    const port = createLegacyAgentDataPort({ actor });
    const proposal = await port.prepareUpdate('orders', '1', { notes: '新值' }, actor);
    await assert.rejects(port.confirmMutation({ ...proposal, changes: { notes: '被篡改' } }, actor, 'x'), { code: 'PROPOSAL_INVALID' });
    data.orders[0].version = 2;
    await assert.rejects(port.confirmMutation(proposal, actor, 'x'), { code: 'VERSION_CONFLICT' });
  } finally {
    store.withData = original;
  }
});

