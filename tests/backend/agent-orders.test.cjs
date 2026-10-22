'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-orders-'));
process.env.DATA_DIR = dataDir;
const { withData } = require('../../backend/utils/store');
const bridge = require('../../backend/agent/dbBridge');
const { confirmRecordUpdate } = require('../../backend/agent/recordUpdates');
const { dispatchTool, getToolsForContext } = require('../../backend/agent/tools');

test('agent order list and detail retain embedded customer fields', async () => {
  await withData((data) => {
    data.orders.push({
      id: '101',
      customer: { name: '张三', email: 'zhang@example.com', phone: '13800000000' },
      status: 'pending_review',
      createdAt: '2026-09-30T00:00:00.000Z',
      items: [],
    });
    return data.orders.length;
  });

  const list = await bridge.listOrders();
  const detail = await bridge.getOrderDetail('101');
  assert.equal(list[0].customerName, '张三');
  assert.equal((await bridge.listOrders({ search: '张三' })).length, 1);
  assert.equal((await bridge.listOrders({ search: '不存在' })).length, 0);
  assert.deepEqual(detail.customer, {
    name: '张三', email: 'zhang@example.com', phone: '13800000000',
  });
});

test('record updates require confirmation, preserve other fields, and reject stale proposals', async () => {
  await withData((data) => {
    data.models.push({ id: '7', name: '原模型', description: '原描述', source: 'original', files: [{ id: '1' }], updatedAt: 'old' });
    data.materials.push({ id: '8', type: 'PLA', materialType: 'PLA', brand: '旧品牌', unitPrice: 30, updatedAt: 'old' });
    return true;
  });

  const proposal = await dispatchTool('propose_record_update', {
    entity: 'orders', id: '101', changes: { customer_name: '李四' },
  }, { role: 'staff', db: bridge });
  assert.equal((await bridge.getOrderDetail('101')).customer.name, '张三');
  await confirmRecordUpdate(proposal, '2');
  assert.equal((await bridge.getOrderDetail('101')).customer.name, '李四');
  await assert.rejects(confirmRecordUpdate(proposal, '2'), { status: 409 });
  const statusProposal = await bridge.prepareRecordUpdate({ entity: 'orders', id: '101', changes: { status: 'in_progress' } });
  await confirmRecordUpdate(statusProposal, '2');
  assert.equal((await bridge.getOrderDetail('101')).status, 'in_progress');

  const model = await bridge.prepareRecordUpdate({ entity: 'models', id: '7', changes: { description: '新描述' } });
  await confirmRecordUpdate(model, '2');
  const material = await bridge.prepareRecordUpdate({ entity: 'materials', id: '8', changes: { unit_price: 35 } });
  await confirmRecordUpdate(material, '2');
  const stored = await withData((data) => ({ model: data.models[0], material: data.materials[0], audits: data.auditLogs }), { write: false });
  assert.equal(stored.model.description, '新描述');
  assert.deepEqual(stored.model.files, [{ id: '1' }]);
  assert.equal(stored.material.unitPrice, 35);
  assert.equal(stored.material.brand, '旧品牌');
  assert.equal(stored.audits.filter((entry) => entry.action === 'update_from_agent').length, 4);
  assert.ok(!getToolsForContext({ role: 'viewer' }).some((tool) => tool.name === 'propose_record_update'));
  await assert.rejects(dispatchTool('propose_record_update', {
    entity: 'orders', id: '101', changes: { notes: 'x' },
  }, { role: 'viewer', db: bridge }), { code: 'TOOL_ROLE_FORBIDDEN' });
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
