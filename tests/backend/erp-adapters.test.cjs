'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createCsvAdapter } = require('../../backend/modules/adapters/csv');
const { parseCsv, writeCsv } = require('../../backend/modules/adapters/csvCodec');
const { createMaterialService } = require('../../backend/modules/materials/service');
const { createOrderService } = require('../../backend/modules/orders/service');
const { createRelationalRouter } = require('../../backend/modules/adapters/http');
const { createAgentAdapter } = require('../../backend/modules/adapters/agent');
const { createHmac } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('../../backend/node_modules/express');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { TOKEN_AUDIENCE } = require('../../backend/utils/authTokens');
const url = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const owner = { actorId: 'owner', tokenVersion: '1' };
const staff = { actorId: 'staff', tokenVersion: '1' };
const viewer = { actorId: 'viewer', tokenVersion: '1' };

test('new adapters do not load legacy storage, old AI bridge or SQLite', () => {
  const loaded = Object.keys(require.cache).map(name => name.replaceAll('\\', '/'));
  for (const suffix of ['/backend/utils/store.js', '/backend/agent/dbBridge.js', '/backend/db/agent.js']) {
    assert.equal(loaded.some(name => name.endsWith(suffix)), false, suffix);
  }
});

test('CSV adapters share relational commands, snapshots, exact amounts and permissions', { skip: !url }, async t => {
  assert.equal(new URL(url).pathname, '/erp_02a_verify');
  const pool = await createBusinessPool({ connectionString: url });
  t.after(() => pool.end());
  await migrateBusinessDatabase(pool);
  await pool.query("INSERT INTO erp.users(id,email,role,password_hash) VALUES('owner','owner@test','owner','hash'),('staff','staff@test','staff','hash'),('viewer','viewer@test','viewer','hash')");
  await pool.query("INSERT INTO erp.customers(id,code,name) VALUES('customer','C1','同名客户'),('other-customer','C2','同名客户')");
  await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('warehouse','W1','默认仓库',true)");
  const jwtSecret = 'isolated-adapters-secret-at-least-32-bytes';
  const serverId = 'f5942634-5fdd-4964-abc6-3971b1787c0b';
  const password = 'Adapter-Password-2026!';
  await pool.query('UPDATE erp.users SET password_hash=$1', [await bcrypt.hash(password, 12)]);
  await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,'适配测试',now(),'relational')", [serverId]);
  const token = id => jwt.sign({ sub: id, ver: '1' }, jwtSecret, { audience: TOKEN_AUDIENCE, issuer: `3d-manage:${serverId}` });
  const app = express();
  const uploadDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-adapters-'));
  t.after(() => fs.rm(uploadDirectory, { recursive: true, force: true }));
  await fs.writeFile(path.join(uploadDirectory, 'part.stl'), 'solid fixture');
  app.use('/api', createRelationalRouter(pool, { jwtSecret, uploadDirectory }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let requestKey = 0;
  async function request(path, { method = 'GET', actor = 'staff', body, modern = true, key, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = `Bearer ${token(actor)}`;
    if (modern) headers['X-Business-Rules-Version'] = '2';
    if (method !== 'GET') headers['Idempotency-Key'] = key || `http-${++requestKey}`;
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text };
  }
  const csv = createCsvAdapter(pool);
  const materials = createMaterialService(pool);
  const orders = createOrderService(pool);
  const count = async table => (await pool.query(`SELECT count(*)::int AS n FROM erp.${table}`)).rows[0].n;
  let mat;
  await t.test('material CSV creates server IDs and exact strings, retries share durable command receipt', async () => {
    const text = writeCsv(['id', 'type', 'brand', 'color', 'unit_price', 'notes'], [{ id: 'client-id', type: 'PLA', brand: 'B', color: '白', unit_price: '99999999999999.999999', notes: '第一行\r\n"第二行",第三行' }]);
    const result = await csv.importRecords(staff, 'materials', text, 'csv-material');
    mat = result.body.items[0];
    assert.notEqual(mat.id, 'client-id');
    assert.equal(mat.unitPrice, '99999999999999.999999');
    assert.equal(mat.notes, '第一行\r\n"第二行",第三行');
    assert.deepEqual(await csv.importRecords(staff, 'materials', text, 'csv-material'), result);
    assert.equal(await count('materials'), 1);
    assert.equal(await count('audit_logs'), 1);
    assert.equal(await count('command_receipts'), 1);
    assert.equal((await materials.get(viewer, mat.id)).unitPrice, mat.unitPrice);
    const exported = await csv.exportRecords(owner, 'materials');
    const row = parseCsv(exported.content)[0];
    assert.equal(row.unit_price, mat.unitPrice);
    assert.equal(row.notes, mat.notes);
  });
  await t.test('bad second row rolls back first row, audit and receipt for every import type', async () => {
    const cases = [
      ['materials', ['type', 'brand', 'color', 'unit_price'], [{ type: 'PLA', brand: 'B', color: '白', unit_price: '1' }, { type: 'PLA', brand: 'B', color: '白', unit_price: '1.0000001' }], 'materials'],
      ['models', ['name', 'source'], [{ name: 'ok', source: 'original' }, { name: 'bad', source: 'unknown' }], 'models'],
      ['lots', ['material_id', 'qty_g'], [{ material_id: mat.id, qty_g: '1.001' }, { material_id: 'missing', qty_g: '1' }], 'stock_lots'],
      ['orders', ['order_id', 'customer_id', 'quantity', 'unit_price'], [{ order_id: 'A', customer_id: 'customer', quantity: '1', unit_price: '1' }, { order_id: 'B', customer_id: 'missing', quantity: '1', unit_price: '1' }], 'orders'],
    ];
    for (const [kind, headers, rows, table] of cases) {
      const before = await Promise.all([count(table), count('audit_logs'), count('command_receipts'), count('inventory_txns')]);
      await assert.rejects(csv.importRecords(staff, kind, writeCsv(headers, rows), `bad-${kind}`));
      assert.deepEqual(await Promise.all([count(table), count('audit_logs'), count('command_receipts'), count('inventory_txns')]), before);
    }
  });
  await t.test('orders group explicit customer IDs and verify each rounded line and total', async () => {
    const headers = ['order_id', 'customer_id', 'quantity', 'unit_price', 'subtotal', 'total', 'notes', 'line_notes'];
    const row = { order_id: 'source-order', customer_id: 'other-customer', quantity: '0.001', unit_price: '5', subtotal: '0.01', total: '0.02', notes: '多行\n订单', line_notes: '规格' };
    const text = writeCsv(headers, [row, row]);
    const result = await csv.importRecords(staff, 'orders', text, 'csv-order');
    const item = result.body.items[0];
    assert.equal(result.body.imported, 1);
    assert.equal(item.customerId, 'other-customer');
    assert.notEqual(item.id, 'source-order');
    assert.equal(item.total, '0.02');
    assert.equal(item.items.length, 2);
    assert.equal((await orders.get(viewer, item.id)).total, '0.02');
    const exported = parseCsv((await csv.exportRecords(owner, 'orders')).content);
    assert.equal(exported.length, 2);
    assert.equal(exported[0].subtotal, '0.01');
    assert.equal(exported[0].notes, row.notes);
    for (const [rows, code] of [[[row, { ...row, subtotal: '0.00' }], 'CSV_AMOUNT_MISMATCH'], [[row, { ...row, total: '1' }], 'CSV_ORDER_INCONSISTENT']]) {
      await assert.rejects(csv.importRecords(staff, 'orders', writeCsv(headers, rows), 'invalid-order'), { code });
    }
    await assert.rejects(csv.importRecords(staff, 'orders', 'order_id,customer_name,quantity,unit_price\nx,同名客户,1,1', 'no-customer-id'), { code: 'CSV_INVALID' });
    await assert.rejects(csv.importRecords(staff, 'orders', 'order_id,customer_id,quantity,unit_price,status\nx,customer,1,1,completed', 'not-a-draft'), { status: 400 });
  });
  await t.test('lot imports create exact opening movements, historical transactions cannot be imported', async () => {
    const result = await csv.importRecords(staff, 'lots', `material_id,qty_g,lot_no\n${mat.id},9007199254740.993,批次`, 'csv-lot');
    assert.equal(result.body.items[0].qtyMg, '9007199254740993');
    const exported = parseCsv((await csv.exportRecords(owner, 'lots')).content)[0];
    assert.equal(exported.qty_g, '9007199254740.993');
    const txn = parseCsv((await csv.exportRecords(owner, 'transactions')).content)[0];
    assert.equal(txn.qty_mg, '9007199254740993');
    assert.equal(txn.source, 'opening');
    await assert.rejects(csv.importRecords(owner, 'transactions', 'id\nx', 'history'), { status: 400 });
    await assert.rejects(csv.importRecords(owner, 'lots', `material_id,qty_g,balance_status\n${mat.id},1,legacy_unverified`, 'bad-balance'), { status: 400 });
  });
  await t.test('all export matches exceed page size and quoted filters remain literal', async () => {
    await pool.query("INSERT INTO erp.models(id,name,source) SELECT 'model-'||i,'批量模型 '||i,'original' FROM generate_series(1,205) i");
    const exported = await csv.exportRecords(owner, 'models', { search: '批量模型' });
    assert.equal(exported.count, 205);
    assert.equal(parseCsv(exported.content).length, 205);
    assert.equal((await csv.exportRecords(owner, 'models', { search: "%' OR true --" })).count, 0);
    await assert.rejects(csv.exportRecords(owner, 'models', { limit: 1 }), { status: 400 });
  });
  await t.test('current database roles and token versions protect every channel', async () => {
    await assert.rejects(csv.exportRecords(staff, 'materials'), { status: 403 });
    await assert.rejects(csv.exportRecords(viewer, 'materials'), { status: 403 });
    await assert.rejects(csv.importRecords(viewer, 'models', 'name\nforbidden', 'viewer'), { status: 403 });
    await assert.rejects(csv.exportRecords({ ...owner, tokenVersion: '2' }, 'materials'), { status: 401 });
    await assert.rejects(csv.importRecords(staff, 'models', 'name,files\na,[]', 'files'), { code: 'CSV_INVALID' });
    assert.equal((await pool.query("SELECT to_regclass('public.app_store') AS legacy")).rows[0].legacy, null);
  });
  await t.test('HTTP discovery and reads accept API1; writes require capability and authenticated actor', async () => {
    const info = await request('/system/info', { auth: false, modern: false });
    assert.equal(info.body.capabilities.businessRulesVersion, 2);
    assert.equal((await request(`/materials/${mat.id}`, { modern: false, actor: 'viewer' })).body.unitPrice, mat.unitPrice);
    assert.equal((await request('/materials', { method: 'POST', modern: false, body: {} })).status, 428);
    assert.equal((await request('/models', { method: 'POST', body: { name: '伪造', actorId: 'owner' } })).status, 400);
    assert.equal((await request('/models', { method: 'POST', actor: 'viewer', body: { name: '禁止' } })).status, 403);
    assert.equal((await request('/models?limit=1garbage')).status, 400);
    const page = await request('/models?page=2&pageSize=200');
    assert.equal(page.body.items.length, 5);
    assert.equal(page.body.page, 2);
    assert.equal(page.body.pageSize, 200);
    assert.equal((await request('/auth/me', { auth: false })).status, 401);
    assert.equal((await request('/auth/me', { actor: 'viewer' })).body.role, 'viewer');
    assert.equal(JSON.stringify((await request('/users', { actor: 'owner' })).body).includes('password_hash'), false);
  });
  await t.test('HTTP updates share versions, durable receipts and CSV-visible facts', async () => {
    const body = { version: mat.version, changes: { notes: 'HTTP 已修改\n保留换行' } };
    const options = { method: 'PATCH', body, key: 'http-material-update' };
    const result = await request(`/materials/${mat.id}`, options);
    assert.equal(result.status, 200);
    assert.equal(result.body.version, '2');
    assert.deepEqual(await request(`/materials/${mat.id}`, options), result);
    assert.equal((await request(`/materials/${mat.id}`, { ...options, key: 'new-stale-key' })).status, 409);
    assert.equal((await materials.get(viewer, mat.id)).notes, result.body.notes);
    const exported = await request('/csv/materials', { actor: 'owner' });
    assert.equal(parseCsv(exported.body)[0].notes, result.body.notes);
    const legacyExport = await request('/materials/export', { actor: 'owner' });
    assert.equal(parseCsv(legacyExport.body.content)[0].notes, result.body.notes);
    assert.equal((await request(`/materials/${mat.id}/audit`, { actor: 'owner' })).body.items[0].action, 'update');
    assert.equal((await request(`/materials/${mat.id}/audit`, { actor: 'staff' })).status, 403);
    assert.equal((await request('/csv/materials', { actor: 'staff' })).status, 403);
    assert.equal((await request('/commands/business/http-material-update', { actor: 'staff' })).body.body.id, mat.id);
    assert.equal((await request('/commands/business/http-material-update', { actor: 'owner' })).status, 404);
    const before = await Promise.all([count('audit_logs'), count('command_receipts')]);
    await pool.query("ALTER TABLE erp.command_receipts ADD CONSTRAINT adapters_receipt_failure CHECK(key<>'http-receipt-fail')");
    try {
      const failed = await request(`/materials/${mat.id}`, { method: 'PATCH', key: 'http-receipt-fail', body: { version: result.body.version, notes: '必须回滚' } });
      assert.equal(failed.status, 400);
      assert.equal((await materials.get(viewer, mat.id)).version, result.body.version);
      assert.equal((await materials.get(viewer, mat.id)).notes, result.body.notes);
      assert.deepEqual(await Promise.all([count('audit_logs'), count('command_receipts')]), before);
    } finally { await pool.query('ALTER TABLE erp.command_receipts DROP CONSTRAINT adapters_receipt_failure'); }
    const created = await request('/csv/models', { method: 'POST', body: { csv: 'name,description\nHTTP CSV,资料' } });
    assert.equal(created.status, 201);
    assert.equal((await request(`/models/${created.body.items[0].id}`)).body.name, 'HTTP CSV');
  });
  await t.test('HTTP model files, inventory posting, user editing and guarded deletion reach domain handlers', async () => {
    let result = await request('/models', { method: 'POST', body: { name: '文件模型' } });
    let model = result.body;
    result = await request(`/models/${model.id}/files/add`, { method: 'POST', body: { version: model.version, file: { fileKey: 'part.stl' } } });
    assert.equal(result.status, 201);
    model = result.body;
    assert.equal(model.files.length, 1);
    result = await request(`/models/${model.id}/active`, { method: 'POST', body: { version: model.version, active: false } });
    assert.equal(result.body.active, false);
    result = await request(`/models/${model.id}`, { method: 'DELETE', body: { version: result.body.version } });
    assert.equal(result.status, 200);
    assert.equal((await request(`/models/${model.id}`)).status, 404);
    assert.equal(await fs.readFile(path.join(uploadDirectory, 'part.stl'), 'utf8'), 'solid fixture');
    const lot = (await request('/inventory/lots', { method: 'POST', body: { materialId: mat.id, qty_g: '1' } })).body;
    assert.equal((await request(`/stock/lots/${lot.id}`, { modern: false })).body.qtyMg, '1000');
    const movement = await request('/inventory/transactions', { method: 'POST', body: { lotId: lot.id, type: 'out', qty_g: '0.001' }, key: 'http-stock-out' });
    assert.equal(movement.status, 201);
    assert.equal(movement.body.afterQtyMg, '999');
    assert.equal((await request(`/inventory/transactions/${movement.body.id}`)).body.qtyMg, '1');
    assert.ok((await request('/stock/inventory/txns', { modern: false })).body.items.some(item => item.id === movement.body.id));
    assert.equal((await request('/inventory/transactions', { method: 'POST', body: { lotId: lot.id, type: 'adjust', qty_g: '0', version: '2' } })).status, 403);
    assert.equal((await request(`/inventory/lots/${lot.id}`, { method: 'DELETE', body: { version: '2' } })).status, 409);
    assert.equal((await request('/inventory/summary?lowStockOnly=not-true')).status, 400);
    const user = await request('/users', { method: 'POST', actor: 'owner', body: { email: 'new@example.test', name: '新员工', role: 'staff', password } });
    assert.equal(user.status, 201);
    const edited = await request(`/users/${user.body.id}`, { method: 'PATCH', actor: 'owner', body: { version: user.body.version, name: '修改姓名' } });
    assert.equal(edited.body.name, '修改姓名');
    assert.equal((await request(`/users/${user.body.id}/reset-password`, { method: 'POST', actor: 'owner', body: { version: edited.body.version, password: 'Reset-Password-2026!' } })).status, 200);
    assert.equal((await request('/users/owner/reset-password', { method: 'POST', actor: 'owner', body: { version: '1', password: 'Reset-Password-2026!' } })).status, 409);
    const malformed = await fetch(`${base}/models`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"DO-NOT-ECHO",' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.text()).includes('DO-NOT-ECHO'), false);
  });
  await t.test('AI exposes read/propose only and reads current relational facts, never stale vector metadata', async () => {
    const semanticLookup = async (userId) => {
      assert.equal(userId, 'staff');
      return { items: [{ id: 'deleted', name: '过期资料', score: 1 }, { id: 'model-1', name: '错误名称', score: 0.9 }], indexComplete: true };
    };
    const agent = createAgentAdapter(pool, staff, { jwtSecret, semanticLookup });
    assert.equal(agent.db.execute, undefined);
    assert.equal(agent.db.confirmRecordUpdate, undefined);
    assert.equal(agent.db.confirmOrderDraft, undefined);
    const before = await Promise.all([count('audit_logs'), count('command_receipts')]);
    assert.equal((await agent.db.searchMaterials('白'))[0].notes, (await materials.get(viewer, mat.id)).notes);
    assert.equal((await agent.db.searchModelsByKeyword('批量模型', 1)).length, 1);
    assert.equal((await agent.db.listOrders({ limit: 1 })).length, 1);
    assert.equal((await agent.db.inventorySummary())[0].totalQtyMg, '9007199254741992');
    const found = await agent.db.semanticSearchModels('staff', 'fixture', [1, 0]);
    assert.equal(found.items.length, 1);
    assert.equal(found.items[0].name, '批量模型 1');
    await assert.rejects(agent.db.semanticSearchModels('owner', 'fixture', [1, 0]), { status: 403 });
    const proposal = await agent.db.prepareRecordUpdate({ entity: 'materials', id: mat.id, changes: { notes: 'AI 修改' } });
    assert.equal(proposal.before.notes, (await materials.get(viewer, mat.id)).notes);
    assert.deepEqual(await Promise.all([count('audit_logs'), count('command_receipts')]), before);
    await assert.rejects(agent.db.prepareRecordUpdate({ entity: 'orders', id: 'x', changes: { customer_name: '猜客户' } }), { status: 400 });
    await assert.rejects(agent.db.prepareRecordUpdate({ entity: 'materials', id: mat.id, changes: { unit_price: 1.1 } }), { status: 400 });
    const viewerAgent = createAgentAdapter(pool, viewer, { jwtSecret });
    await assert.rejects(viewerAgent.db.prepareRecordUpdate({ entity: 'materials', id: mat.id, changes: { notes: '无权' } }), { status: 403 });
  });
  await t.test('AI confirmations bind actor, signature, server, expiry and version, with durable retry', async () => {
    const agent = createAgentAdapter(pool, staff, { jwtSecret });
    const proposal = await agent.db.prepareRecordUpdate({ entity: 'materials', id: mat.id, changes: { notes: '已确认的 AI 修改' } });
    const input = { proposal, confirmed: true, key: 'ai-confirm-material' };
    await assert.rejects(agent.confirmRecordUpdate({ ...input, confirmed: false }), { code: 'HUMAN_CONFIRMATION_REQUIRED' });
    await assert.rejects(agent.confirmRecordUpdate({ ...input, proposal: { ...proposal, changes: { notes: '篡改' } } }), { code: 'PROPOSAL_INVALID' });
    await assert.rejects(createAgentAdapter(pool, owner, { jwtSecret }).confirmRecordUpdate(input), { code: 'PROPOSAL_INVALID' });
    await pool.query("UPDATE erp.installation SET server_id='11111111-1111-4111-8111-111111111111'");
    await assert.rejects(agent.confirmRecordUpdate(input), { code: 'PROPOSAL_INVALID' });
    await pool.query('UPDATE erp.installation SET server_id=$1', [serverId]);
    const expired = { ...proposal, expiresAt: Date.now() - 1 };
    const { signature: _old, ...unsigned } = expired;
    const stableFixture = value => value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableFixture(value[key])).join(',') + '}' : JSON.stringify(value);
    const signingKey = createHmac('sha256', jwtSecret).update('3d-manage:agent-proposals:v1').digest();
    expired.signature = createHmac('sha256', signingKey).update(stableFixture(unsigned)).digest('hex');
    await assert.rejects(agent.confirmRecordUpdate({ ...input, proposal: expired }), { code: 'PROPOSAL_EXPIRED' });
    const result = await agent.confirmRecordUpdate(input);
    assert.equal(result.body.notes, proposal.changes.notes);
    assert.deepEqual(await agent.confirmRecordUpdate(input), result);
    assert.equal((await request(`/materials/${mat.id}`)).body.notes, proposal.changes.notes);
    await assert.rejects(agent.confirmRecordUpdate({ ...input, key: 'ai-stale-version' }), { code: 'VERSION_CONFLICT' });
  });
  await t.test('AI mixed order edits and transition share one transaction, rollback and receipt', async () => {
    const agent = createAgentAdapter(pool, staff, { jwtSecret });
    const order = (await orders.list(owner)).items[0];
    const bad = await agent.db.prepareRecordUpdate({ entity: 'orders', id: order.id, changes: { notes: '必须回滚', status: 'completed' } });
    const before = await Promise.all([count('audit_logs'), count('command_receipts')]);
    await assert.rejects(agent.confirmRecordUpdate({ proposal: bad, confirmed: true, key: 'ai-bad-transition' }), { code: 'ORDER_TRANSITION_INVALID' });
    assert.equal((await orders.get(owner, order.id)).notes, order.notes);
    assert.equal((await orders.get(owner, order.id)).version, order.version);
    assert.deepEqual(await Promise.all([count('audit_logs'), count('command_receipts')]), before);
    const proposal = await agent.db.prepareRecordUpdate({ entity: 'orders', id: order.id, changes: { notes: '一起提交', status: 'pending_review' } });
    const input = { proposal, confirmed: true, key: 'ai-mixed-order' };
    const result = await agent.confirmRecordUpdate(input);
    assert.equal(result.body.notes, '一起提交');
    assert.equal(result.body.status, 'pending_review');
    assert.deepEqual(await agent.confirmRecordUpdate(input), result);
    assert.equal(await count('audit_logs'), before[0] + 2);
    assert.equal(await count('command_receipts'), before[1] + 1);
    const created = await agent.confirmOrderDraft({ confirmed: true, key: 'ai-new-draft', draft: { customerId: 'customer', items: [{ quantity: '0.001', unitPrice: '5' }] } });
    assert.equal(created.body.total, '0.01');
    await assert.rejects(agent.confirmOrderDraft({ confirmed: true, key: 'ai-no-customer', draft: { items: [{ quantity: '1', unitPrice: '1' }] } }), { status: 400 });
  });
  await t.test('relational mode gate refuses fallback, login and password maintenance work without capability header', async () => {
    await pool.query("UPDATE erp.installation SET storage_mode='legacy'");
    assert.equal((await request('/materials')).status, 503);
    assert.equal((await request('/system/info', { auth: false })).body.capabilities.relationalBusiness, false);
    await pool.query("UPDATE erp.installation SET storage_mode='relational'");
    const loggedIn = await request('/auth/login', { method: 'POST', auth: false, modern: false, body: { email: 'viewer@test', password } });
    assert.equal(loggedIn.status, 200);
    assert.equal(loggedIn.body.user.role, 'viewer');
    for (let i = 0; i < 5; i++) assert.equal((await request('/auth/change-password', { actor: 'viewer', method: 'POST', modern: false, body: { currentPassword: 'wrong-password', newPassword: 'New-Adapter-Password!' } })).body.code, 'CURRENT_PASSWORD_INVALID');
    assert.equal((await request('/auth/change-password', { actor: 'viewer', method: 'POST', modern: false, body: { currentPassword: password, newPassword: 'New-Adapter-Password!' } })).status, 429);
    const changed = await request('/auth/change-password', { actor: 'staff', method: 'POST', modern: false, body: { currentPassword: password, newPassword: 'New-Adapter-Password!' } });
    assert.equal(changed.status, 200);
    assert.equal((await request('/auth/me', { actor: 'staff' })).status, 401);
    for (let i = 0; i < 5; i++) assert.equal((await request('/auth/login', { method: 'POST', auth: false, modern: false, body: { email: 'viewer@test', password: 'wrong-password' } })).status, 401);
    assert.equal((await request('/auth/login', { method: 'POST', auth: false, modern: false, body: { email: 'viewer@test', password } })).status, 429);
  });
});

test('HTTP service failures hide database details and remain service errors', async t => {
  const failure = new Error('password=secret SELECT from private_table');
  const unavailable = { query: async () => { throw failure; }, connect: async () => { throw failure; } };
  const app = express();
  app.use('/api', createRelationalRouter(unavailable, { jwtSecret: 'offline-adapters-key-longer-than-32-bytes' }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/materials`);
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.equal(text.includes('secret'), false);
  assert.equal(text.includes('private_table'), false);
});
