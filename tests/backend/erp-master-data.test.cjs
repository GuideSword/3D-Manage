'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createPartnerService } = require('../../backend/modules/partners/service');
const { createWarehouseService } = require('../../backend/modules/warehouses/service');
const { createOrderService } = require('../../backend/modules/orders/service');
const { createRelationalRouter } = require('../../backend/modules/adapters/http');
const express = require('../../backend/node_modules/express');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { TOKEN_AUDIENCE } = require('../../backend/utils/authTokens');
const url = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const owner = { actorId: 'owner', tokenVersion: '1' }, staff = { actorId: 'staff', tokenVersion: '1' }, viewer = { actorId: 'viewer', tokenVersion: '1' };

test('partner type cannot choose arbitrary SQL tables', () => {
  for (const kind of ['users', 'customers;DROP TABLE erp.users', '__proto__']) assert.throws(() => createPartnerService({}, kind), { code: 'MASTER_DATA_TYPE_INVALID' });
});
test('master data shares transactions, versions, roles and historical snapshots', { skip: !url }, async t => {
  assert.equal(new URL(url).pathname, '/erp_02a_verify');
  const pool = await createBusinessPool({ connectionString: url });
  t.after(() => pool.end());
  await migrateBusinessDatabase(pool);
  await pool.query("INSERT INTO erp.users(id,email,role,password_hash) VALUES('owner','owner@test','owner','hash'),('staff','staff@test','staff','hash'),('viewer','viewer@test','viewer','hash')");
  await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('default','DEFAULT','默认仓库',true)");
  let key = 0;
  const command = (service, operation, payload, actor = staff, nonce) => service.execute({ ...actor, operation, payload, key: nonce || `master-${++key}` });
  const customers = createPartnerService(pool, 'customers'), suppliers = createPartnerService(pool, 'suppliers');
  const warehouses = createWarehouseService(pool), orders = createOrderService(pool);
  let customer, supplier;
  await t.test('customer and supplier complete CRUD retain exact legacy extras and clear optional fields', async () => {
    for (const [service, prefix] of [[customers, 'customer'], [suppliers, 'supplier']]) {
      const created = (await command(service, `${prefix}.create`, { code: 'C1', name: '同名', contactName: '联系人', email: 'a@example.test', phone: '138', address: '地址', notes: '备注' })).body;
      assert.match(created.id, /^[0-9a-f-]{36}$/);
      await pool.query(`UPDATE erp.${prefix === 'customer' ? 'customers' : 'suppliers'} SET legacy_payload='{"unknown":9007199254740993.01}' WHERE id=$1`, [created.id]);
      const updated = (await command(service, `${prefix}.update`, { id: created.id, version: created.version, changes: { name: '改名', contactName: '', email: '', phone: '', address: '', notes: '' } })).body;
      assert.equal(updated.code, 'C1');
      assert.equal(updated.contactName, '');
      assert.equal(updated.unknown, '9007199254740993.01');
      const sameName = (await command(service, `${prefix}.create`, { code: 'C2', name: '改名' })).body;
      assert.equal((await service.list(viewer, { search: '改名' })).total, 2);
      await assert.rejects(command(service, `${prefix}.create`, { code: 'C2', name: '其他' }), { code: 'ENTITY_CONFLICT' });
      await command(service, `${prefix}.delete`, { id: sameName.id, version: sameName.version });
      await assert.rejects(service.get(viewer, sameName.id), { status: 404 });
      if (prefix === 'customer') customer = updated; else supplier = updated;
    }
  });
  await t.test('versions serialize concurrent edits, same-key retries do not duplicate audit', async () => {
    const results = await Promise.allSettled(['A', 'B'].map(notes => command(customers, 'customer.update', { id: customer.id, version: customer.version, changes: { notes } })));
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(results.find(x => x.status === 'rejected').reason.code, 'VERSION_CONFLICT');
    customer = await customers.get(viewer, customer.id);
    const payload = { id: customer.id, version: customer.version, active: false };
    const result = await command(customers, 'customer.setActive', payload, staff, 'customer-disable');
    assert.deepEqual(await command(customers, 'customer.setActive', payload, staff, 'customer-disable'), result);
    assert.equal((await customers.list(viewer, { active: 'false' })).total, 1);
    customer = (await command(customers, 'customer.setActive', { id: customer.id, version: result.body.version, active: true })).body;
  });
  await t.test('customer edits never rewrite order snapshots and references block deletion', async () => {
    const order = (await command(orders, 'order.create', { customerId: customer.id, items: [{ quantity: '1', unitPrice: '1' }] })).body;
    customer = (await command(customers, 'customer.update', { id: customer.id, version: customer.version, changes: { name: '新客户名' } })).body;
    assert.equal((await orders.get(viewer, order.id)).customer.name, order.customer.name);
    await assert.rejects(command(customers, 'customer.delete', { id: customer.id, version: customer.version }), { code: 'ENTITY_REFERENCED' });
    customer = (await command(customers, 'customer.setActive', { id: customer.id, version: customer.version, active: false })).body;
    await assert.rejects(command(orders, 'order.create', { customerId: customer.id, items: [{ quantity: '1', unitPrice: '1' }] }), { code: 'CUSTOMER_UNAVAILABLE' });
    assert.equal((await orders.get(viewer, order.id)).customer.name, order.customer.name);
    await pool.query('CREATE TABLE erp.supplier_reference(id text PRIMARY KEY,supplier_id text REFERENCES erp.suppliers(id))');
    await pool.query('INSERT INTO erp.supplier_reference VALUES($1,$2)', ['reference', supplier.id]);
    await assert.rejects(command(suppliers, 'supplier.delete', { id: supplier.id, version: supplier.version }), { code: 'ENTITY_REFERENCED' });
  });
  await t.test('Viewer writes, protected fields, stale sessions and blank identities are rejected', async () => {
    await assert.rejects(command(customers, 'customer.create', { code: 'V', name: 'V' }, viewer), { status: 403 });
    await assert.rejects(customers.get({ ...viewer, tokenVersion: '2' }, customer.id), { status: 401 });
    for (const changes of [{ name: '' }, { code: '' }, { active: false }, { version: '99' }, { createdBy: 'owner' }]) await assert.rejects(command(customers, 'customer.update', { id: customer.id, version: customer.version, changes }), { status: 400 });
    assert.equal((await customers.get(viewer, customer.id)).version, customer.version);
  });
  await t.test('default warehouse is readable by all roles, only Owner can edit name', async () => {
    const warehouse = await warehouses.getDefault(viewer);
    await assert.rejects(command(warehouses, 'warehouse.update', { id: warehouse.id, version: warehouse.version, changes: { name: 'B' } }), { status: 403 });
    for (const changes of [{ code: 'X' }, { active: false }, { isDefault: false }, { name: '' }]) await assert.rejects(command(warehouses, 'warehouse.update', { id: warehouse.id, version: warehouse.version, changes }, owner), { status: 400 });
    const payload = { id: warehouse.id, version: warehouse.version, changes: { name: '打印材料仓' } };
    const result = await command(warehouses, 'warehouse.update', payload, owner, 'warehouse-name');
    assert.equal(result.body.name, '打印材料仓');
    assert.deepEqual(await command(warehouses, 'warehouse.update', payload, owner, 'warehouse-name'), result);
    await assert.rejects(command(warehouses, 'warehouse.update', payload, owner), { code: 'VERSION_CONFLICT' });
  });
  await t.test('receipt failure rolls back profile, version and audit', async () => {
    const previous = await suppliers.get(owner, supplier.id);
    const before = (await pool.query('SELECT count(*)::int AS n FROM erp.audit_logs')).rows[0].n;
    await pool.query("ALTER TABLE erp.command_receipts ADD CONSTRAINT master_receipt_failure CHECK(key<>'master-fail')");
    try {
      await assert.rejects(command(suppliers, 'supplier.update', { id: supplier.id, version: previous.version, changes: { notes: '必须撤销' } }, owner, 'master-fail'), { code: 'BUSINESS_DATA_INVALID' });
      assert.deepEqual(await suppliers.get(owner, supplier.id), previous);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.audit_logs')).rows[0].n, before);
    } finally { await pool.query('ALTER TABLE erp.command_receipts DROP CONSTRAINT master_receipt_failure'); }
  });
  await t.test('HTTP master-data routes preserve roles, versions, capability guards and durable retries', async () => {
    const serverId = '11111111-1111-4111-8111-111111111111', jwtSecret = 'master-data-HTTP-fixture-secret-32-bytes';
    await pool.query("INSERT INTO erp.installation VALUES('default',$1,'主数据验收',now(),'relational')", [serverId]);
    const app = express();
    app.use('/api', createRelationalRouter(pool, { jwtSecret }));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    async function request(path, method = 'GET', body, actor = 'staff', requestKey, modern = true) {
      const token = jwt.sign({ sub: actor, ver: '1' }, jwtSecret, { audience: TOKEN_AUDIENCE, issuer: `3d-manage:${serverId}` });
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': requestKey || `master-http-${++key}`, ...(modern ? { 'X-Business-Rules-Version': '2' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }
    try {
      for (const kind of ['customers', 'suppliers']) {
        const created = await request(`/${kind}`, 'POST', { code: 'HTTP', name: 'HTTP资料' });
        assert.equal(created.status, 201);
        const id = created.body.id;
        assert.equal((await request(`/${kind}/${id}`, 'GET', undefined, 'viewer')).body.name, 'HTTP资料');
        assert.equal((await request(`/${kind}?search=HTTP`, 'GET')).body.total, 1);
        // React Native's fetch polyfill adds this cache-buster for no-store GETs.
        const nativePage = await request(`/${kind}?search=HTTP&active=true&limit=50&offset=0&_=1792080896260`);
        assert.equal(nativePage.status, 200);
        assert.equal(nativePage.body.total, 1);
        assert.equal(nativePage.body.items[0].id, id);
        assert.equal((await request(`/${kind}?_=arbitrary`)).status, 400);
        assert.equal((await request(`/${kind}?_=1792080896260&_=1792080896261`)).status, 400);
        assert.equal((await request(`/${kind}?unrecognized=true`)).status, 400);
        const payload = { version: created.body.version, changes: { notes: '' } };
        const updated = await request(`/${kind}/${id}`, 'PATCH', payload, 'staff', `http-${kind}-edit`);
        assert.equal(updated.status, 200);
        assert.deepEqual(await request(`/${kind}/${id}`, 'PATCH', payload, 'staff', `http-${kind}-edit`), updated);
        assert.equal((await request(`/${kind}/${id}`, 'PATCH', payload, 'staff')).status, 409);
        assert.equal((await request(`/${kind}`, 'POST', { code: 'V', name: 'V' }, 'viewer')).status, 403);
        assert.equal((await request(`/${kind}`, 'POST', { code: 'OLD', name: 'OLD' }, 'staff', undefined, false)).status, 428);
        const inactive = await request(`/${kind}/${id}/active`, 'POST', { version: updated.body.version, active: false });
        assert.equal(inactive.body.active, false);
        assert.equal((await request(`/${kind}/${id}`, 'DELETE', { version: inactive.body.version })).status, 200);
      }
      const warehouse = (await request('/warehouses/default', 'GET', undefined, 'viewer')).body;
      const payload = { id: warehouse.id, version: warehouse.version, changes: { name: 'HTTP仓库' } };
      assert.equal((await request('/warehouses/default', 'PATCH', payload)).status, 403);
      assert.equal((await request('/warehouses/default', 'PATCH', payload, 'owner')).body.name, 'HTTP仓库');
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
  await t.test('missing default warehouse is reported without creating or reassigning storage', async () => {
    await pool.query("UPDATE erp.warehouses SET is_default=false WHERE id='default'");
    try {
      await assert.rejects(warehouses.getDefault(viewer), { code: 'DEFAULT_WAREHOUSE_MISSING' });
      await assert.rejects(command(warehouses, 'warehouse.create', { name: '禁止隐式创建' }, owner), { code: 'COMMAND_UNKNOWN' });
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.warehouses')).rows[0].n, 1);
    } finally { await pool.query("UPDATE erp.warehouses SET is_default=true WHERE id='default'"); }
  });
});
