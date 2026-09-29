const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '3d-erp-inventory-'));
process.env.DATA_DIR = tempDir;
const testDatabaseUrl = process.env.ERP_TEST_DATABASE_URL;
process.env.STORE_DRIVER = testDatabaseUrl ? 'postgres' : 'file';
if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.STORE_TABLE = `erp_inventory_test_${require('node:crypto').randomBytes(6).toString('hex')}`;
  process.env.STORE_ID = 'p0-test';
}
process.env.JWT_SECRET = 'erp-test-isolated-secret-with-at-least-32-characters';
const store = require('../../backend/utils/store');
const inventory = require('../../backend/services/inventory');
const { gramsToMg } = require('../../backend/services/inventoryQuantity');
const { assertOrderCanDelete } = require('../../backend/services/orders');
const owner = { id: 'owner', role: 'owner' };
const staff = { id: 'staff', role: 'staff' };
const viewer = { id: 'viewer', role: 'viewer' };
let sequence = 0;
const options = (actor = owner, key = `test-${++sequence}`) => ({ actor, idempotencyKey: key });
const command = (operation, payload, opts = options()) => inventory.executeCommand(operation, payload, opts);
const create = (qty = 1000, opts) => command('lot.create', { materialId: 'm1', lotNo: 'TEST', qty }, opts);
const post = (lotId, type, qty, extra = {}, opts) => command('inventory.post', { lotId, type, qty, ...extra }, opts);
test.beforeEach(async () => {
  await store.withData((data) => {
    Object.assign(data, store.createFreshData());
    data.materials.push({ id: 'm1', type: 'PLA', color: 'Blue' });
    data.orders.push({ id: 'o1', items: [] });
    data.users.push(...[owner, staff, viewer].map((user) => ({ ...user, active: true, tokenVersion: 1 })));
    return true;
  });
});
test.after(async () => {
  await store.closeStore();
  if (testDatabaseUrl) {
    const { Pool } = require('../../backend/node_modules/pg');
    const cleanupPool = new Pool({ connectionString: testDatabaseUrl });
    try { await cleanupPool.query(`DROP TABLE IF EXISTS "${process.env.STORE_TABLE}"`); }
    finally { await cleanupPool.end(); }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('数量严格校验，毫克计算不产生浮点累计误差', async () => {
  assert.equal(gramsToMg('0.001'), 1);
  for (const value of ['', ' ', null, undefined, false, [], {}, '-1', '1g', '1e3', '1.0000', '0.0001', NaN, Infinity, '9007199254741']) {
    assert.throws(() => gramsToMg(value), { code: 'INVALID_QUANTITY' });
  }
  const { body: lot } = await create('0.1');
  await post(lot.id, 'in', '0.2');
  assert.equal((await store.getData()).stockLots[0].qtyMg, 300);
  assert.equal((await store.getData()).stockLots[0].qty, 0.3);
});

test('新批次期初、领用、盘点和报废都有可解释流水', async () => {
  const { body: lot } = await create('1000');
  const out = (await post(lot.id, 'out', '200', { orderId: 'o1' })).body;
  assert.equal(out.deltaQtyMg, -200000);
  const adjustment = (await post(lot.id, 'adjust', '700')).body;
  assert.deepEqual([adjustment.qty, adjustment.beforeQty, adjustment.afterQty, adjustment.deltaQty], [700, 800, 700, -100]);
  await post(lot.id, 'scrap', '700', { reason: '受潮' });
  const data = await store.getData();
  assert.equal(data.stockLots[0].qtyMg, 0);
  assert.equal(data.stockLots[0].state, 'scrapped');
  assert.equal(data.inventoryTxns[0].source, 'opening');
  assert.equal(data.inventoryTxns.reduce((sum, txn) => sum + txn.deltaQtyMg, 0), 0);
  assert.equal(data.inventoryTxns.length, 4);
  assert.equal(data.commandReceipts.length, 4);
  assert.equal(data.auditLogs.length, 4);
});

test('重复请求返回原结果，内容冲突拒绝，用户键隔离，回执可持久读取', async () => {
  const { body: lot } = await create(100);
  const opts = options(staff, 'retry-out');
  const first = await post(lot.id, 'out', 80, {}, opts);
  const retry = await post(lot.id, 'out', 80, {}, opts);
  assert.deepEqual(retry, first);
  await assert.rejects(post(lot.id, 'out', 10, {}, opts), { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  await post(lot.id, 'in', 10, {}, options(owner, 'retry-out'));
  const data = await store.getData();
  assert.equal(data.stockLots[0].qty, 30);
  assert.equal(data.inventoryTxns.filter((txn) => txn.type === 'out').length, 1);
  assert.deepEqual(data.commandReceipts.find((item) => item.key === 'retry-out' && item.actorId === staff.id).result, first);
  const { spawnSync } = require('node:child_process');
  const restarted = spawnSync(process.execPath, ['-e', `
    const inventory = require('./backend/services/inventory');
    inventory.executeCommand('inventory.post', JSON.parse(process.env.ERP_TEST_COMMAND), {
      actor: {id:'staff',role:'staff'}, idempotencyKey:'retry-out'
    }).then((result) => { process.stdout.write(JSON.stringify(result)); })
      .catch(() => { process.exitCode = 1; })
      .finally(() => require('./backend/utils/store').closeStore());
  `], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, ERP_TEST_COMMAND: JSON.stringify({ lotId: lot.id, type: 'out', qty: 80 }) }, encoding: 'utf8' });
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), first);
  assert.equal((await store.getData()).inventoryTxns.length, 3);
});

test('同键并发只过账一次，不同键竞争可用量只成功一次', async () => {
  const { body: lot } = await create(100);
  const results = await Promise.allSettled([post(lot.id, 'out', 80), post(lot.id, 'out', 80)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.find((item) => item.status === 'rejected').reason.code, 'INSUFFICIENT_STOCK');
  const opts = options(owner, 'concurrent-in');
  const [a, b] = await Promise.all([post(lot.id, 'in', 1, {}, opts), post(lot.id, 'in', 1, {}, opts)]);
  assert.deepEqual(a, b);
  assert.equal((await store.getData()).stockLots[0].qty, 21);
  if (testDatabaseUrl) {
    await post(lot.id, 'in', 79);
    const { spawn } = require('node:child_process');
    const separateProcess = (key) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', `
        const inventory = require('./backend/services/inventory');
        inventory.executeCommand('inventory.post', {lotId:process.env.ERP_TEST_LOT,type:'out',qty:80}, {
          actor:{id:'staff',role:'staff'}, idempotencyKey:process.env.ERP_TEST_KEY
        }).then((result) => process.stdout.write(JSON.stringify(result)))
          .catch((error) => process.stdout.write(JSON.stringify({status:error.status,code:error.code})))
          .finally(() => require('./backend/utils/store').closeStore());
      `], { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, ERP_TEST_LOT: lot.id, ERP_TEST_KEY: key } });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => {
        try { assert.equal(code, 0); resolve(JSON.parse(output)); } catch (error) { reject(error); }
      });
    });
    const competing = await Promise.all([separateProcess('pg-race-a'), separateProcess('pg-race-b')]);
    assert.deepEqual(competing.map((item) => item.status).sort(), [201, 409]);
    assert.equal((await store.getData()).stockLots[0].qty, 20);
  }
});

test('缺键、无效物料、单位、数量、订单、报废原因和余额失败均不写入', async () => {
  const { body: lot } = await create(100);
  const before = await store.getData();
  const invalid = [
    post(lot.id, 'in', 1, {}, { actor: owner }),
    command('lot.create', { materialId: 'missing', qty: 1 }),
    post(lot.id, 'in', '1g'), post(lot.id, 'in', 1, { unit: 'kg' }),
    post(lot.id, 'out', 101), post(lot.id, 'out', 0), post(lot.id, 'unknown', 1),
    post(lot.id, 'in', 1, { orderId: 'missing' }), post(lot.id, 'scrap', 1),
    command('lot.create', { materialId: 'm1', qty: 1, qty_g: 2 }),
  ];
  const failures = await Promise.allSettled(invalid);
  assert.ok(failures.every((item) => item.status === 'rejected'));
  assert.deepEqual(await store.getData(), before);
});

test('资料编辑、版本检查、停用与恢复；删除保护所有历史', async () => {
  const { body: lot } = await create(100);
  for (const changes of [{ qty: 1 }, { qtyMg: 1 }, { materialId: 'other' }, { id: 'forged' }, { state: 'in_stock' }, { createdAt: 'x' }]) {
    await assert.rejects(command('lot.update', { id: lot.id, changes }), { code: 'PROTECTED_LOT_FIELD' });
  }
  const updated = (await command('lot.update', { id: lot.id, changes: { location: 'A', version: 1 } })).body;
  assert.equal(updated.version, 2);
  await assert.rejects(post(lot.id, 'adjust', 10, { version: 1 }), { code: 'VERSION_CONFLICT' });
  await command('lot.archive', { id: lot.id, changes: { version: 2 } });
  await assert.rejects(post(lot.id, 'out', 1), { code: 'LOT_INACTIVE' });
  await command('lot.update', { id: lot.id, changes: { active: true } });
  await assert.rejects(command('lot.delete', { id: lot.id }), { code: 'LOT_REFERENCED' });
  const empty = (await create(0)).body;
  await store.withData((data) => { data.orders[0].items.push({ lotId: empty.id }); return true; });
  await assert.rejects(command('lot.delete', { id: empty.id }), { code: 'LOT_REFERENCED' });
  const unused = (await create(0)).body;
  assert.equal((await command('lot.delete', { id: unused.id })).body.success, true);
});

test('CSV/数组导入共用期初规则，非法第二行导致整批回滚', async () => {
  const before = await store.getData();
  await assert.rejects(command('lots.import', { lots: [{ materialId: 'm1', qty: 50 }, { materialId: 'm1', qty: '-5' }] }), { code: 'INVALID_QUANTITY' });
  assert.deepEqual(await store.getData(), before);
  const opts = options(staff, 'import-retry');
  const payload = { lots: [{ materialId: 'm1', qty: '50.001' }, { materialId: 'm1', qty: 0 }] };
  const first = await command('lots.import', payload, opts);
  assert.deepEqual(await command('lots.import', payload, opts), first);
  assert.equal(first.body.imported, 2);
  assert.equal((await store.getData()).inventoryTxns.length, 1);
});

test('回执写入时注入异常，库存、流水、审计、回执全部回滚', async () => {
  const { body: lot } = await create(100);
  const before = await store.getData();
  await assert.rejects(store.withData((data) => {
    data.commandReceipts.push = () => { throw new Error('injected receipt failure'); };
    return inventory.commandInData(data, 'inventory.post', { lotId: lot.id, type: 'out', qty: 50 }, options());
  }), /injected receipt failure/);
  assert.deepEqual(await store.getData(), before);
  await post(lot.id, 'out', 50);
  assert.equal((await store.getData()).stockLots[0].qty, 50);
});

test('历史 500g 余额与绝对盘点保留，不重复累加，迁移幂等', () => {
  const legacy = store.createFreshData();
  legacy.schemaVersion = 2;
  delete legacy.commandReceipts;
  legacy.stockLots.push({ id: 'old', materialId: 'm1', qty: 500 });
  legacy.inventoryTxns.push({ id: 'old-adjust', lotId: 'old', type: 'adjust', qty: 500 });
  const migrated = store.migrateData(legacy);
  assert.equal(migrated.data.stockLots[0].qty, 500);
  assert.equal(migrated.data.stockLots[0].ledgerBaselineQtyMg, 500000);
  assert.equal(migrated.data.stockLots[0].balanceStatus, 'legacy_unverified');
  assert.deepEqual(migrated.data.inventoryTxns, [{ id: 'old-adjust', lotId: 'old', type: 'adjust', qty: 500 }]);
  assert.equal(store.migrateData(migrated.data).changed, false);
  const bad = store.createFreshData(); bad.schemaVersion = 2;
  bad.stockLots.push({ id: 'bad', materialId: 'm1', qty: '1.0001' });
  store.migrateData(bad);
  assert.equal(bad.stockLots[0].balanceStatus, 'legacy_invalid');
  assert.equal(bad.stockLots[0].qty, '1.0001');
  assert.throws(() => inventory.postTransactionInData(bad, { lotId: 'bad', type: 'in', qty: 1 }, { actor: owner }), { code: 'LEGACY_BALANCE_INVALID' });
});

test('Staff 无盘点权限、Viewer 无写权限；订单引用不能删除', async () => {
  const { body: lot } = await create(100);
  await assert.rejects(post(lot.id, 'adjust', 10, {}, options(staff)), { status: 403 });
  await assert.rejects(create(1, options(viewer)), { status: 403 });
  await post(lot.id, 'out', 1, { orderId: 'o1' }, options(staff));
  assert.throws(() => assertOrderCanDelete({ inventoryTxns: [{ orderId: 'o1' }] }, 'o1'), { code: 'ORDER_REFERENCED' });
});

test('HTTP 创建、导入、重试、旧编辑拒绝、权限及删除引用保护', async () => {
  const express = require('../../backend/node_modules/express');
  const { issueToken } = require('../../backend/utils/authTokens');
  const app = express(); app.use(express.json());
  app.use('/stock', require('../../backend/routes/stock'));
  app.use('/materials', require('../../backend/routes/materials'));
  app.use('/orders', require('../../backend/routes/orders'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const data = await store.getData();
  const tokens = Object.fromEntries(data.users.map((user) => [user.role, issueToken(user, data.system.serverId)]));
  const request = async (url, method = 'GET', body, role = 'owner', key = `http-${++sequence}`) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}`, ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request('/stock/lots', 'POST', { materialId: 'm1', qty: 100 }, 'owner', '')).status, 400);
    const created = await request('/stock/lots', 'POST', { materialId: 'm1', qty: 100 }, 'staff', 'http-create');
    assert.equal(created.status, 201);
    assert.deepEqual(await request('/stock/lots', 'POST', { qty: 100, materialId: 'm1' }, 'staff', 'http-create'), created);
    const id = created.body.id;
    const postBody = { lotId: id, type: 'out', qty: '80', orderId: 'o1', actorId: 'forged' };
    const posted = await request('/stock/inventory/txns', 'POST', postBody, 'staff', 'http-out');
    assert.equal(posted.status, 201); assert.equal(posted.body.actorId, 'staff');
    assert.deepEqual(await request('/stock/inventory/txns', 'POST', postBody, 'staff', 'http-out'), posted);
    assert.equal((await request('/stock/inventory/txns', 'POST', { lotId: id, type: 'adjust', qty: 0 }, 'staff')).status, 403);
    assert.equal((await request('/stock/lots', 'POST', { materialId: 'm1', qty: 1 }, 'viewer')).status, 403);
    assert.equal((await request(`/stock/lots/${id}`, 'PATCH', { qty: 500 })).body.code, 'PROTECTED_LOT_FIELD');
    assert.equal((await request(`/stock/lots/${id}`, 'DELETE')).body.code, 'LOT_REFERENCED');
    assert.equal((await request('/materials/m1', 'DELETE')).body.code, 'MATERIAL_REFERENCED');
    assert.equal((await request('/orders/o1', 'DELETE')).body.code, 'ORDER_REFERENCED');
    assert.equal((await request('/materials/m1', 'PATCH', { id: 'forged' })).body.id, 'm1');
    assert.equal((await request('/orders/o1', 'PATCH', { id: 'forged' })).body.id, 'o1');
    assert.equal((await request('/orders/o1', 'DELETE')).body.code, 'ORDER_REFERENCED');
    const before = await store.getData();
    const badCsv = await request('/stock/import', 'POST', { csv: 'material_id,qty\nm1,10\nm1,1x\n' });
    assert.equal(badCsv.status, 400); assert.deepEqual(await store.getData(), before);
    const imported = await request('/stock/import', 'POST', { csv: 'material_id,qty\nm1,50.001\n' }, 'owner', 'csv-retry');
    assert.equal(imported.status, 201);
    assert.deepEqual(await request('/stock/import', 'POST', { csv: 'material_id,qty\nm1,50.001\n' }, 'owner', 'csv-retry'), imported);
    const exported = await request('/stock/export?type=transactions');
    assert.match(exported.body.content, /before_qty,after_qty,delta_qty/);
    await request(`/stock/lots/${id}/archive`, 'POST', { version: 2 });
    assert.equal((await request('/stock/inventory/txns', 'POST', { lotId: id, type: 'in', qty: 1 })).body.code, 'LOT_INACTIVE');
    assert.equal((await request(`/stock/lots/${id}`, 'GET', undefined, 'viewer')).body.qty, 20);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('AI 库存摘要共用服务，现存、可操作与历史异常分别呈现', async () => {
  const { body: a } = await create(100);
  await create(50);
  await command('lot.archive', { id: a.id, changes: {} });
  const tool = require('../../backend/agent/tools/inventory')[0];
  const summary = await tool.handler({}, { db: require('../../backend/agent/dbBridge') });
  assert.equal(summary[0].totalQty, 150);
  assert.equal(summary[0].availableQty, 50);
  assert.equal(summary[0].lowStock, true);
  await store.withData((data) => {
    data.stockLots.push({ id: 'bad', materialId: 'm1', qty: 'oops', balanceStatus: 'legacy_invalid' });
    return true;
  });
  assert.equal((await inventory.inventorySummary())[0].balanceIncomplete, true);
});
