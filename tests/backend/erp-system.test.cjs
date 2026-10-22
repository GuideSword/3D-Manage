'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('../../backend/node_modules/express');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { TOKEN_AUDIENCE } = require('../../backend/utils/authTokens');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createMaintenanceService } = require('../../backend/business-db/maintenance');
const { createSystemService } = require('../../backend/modules/system/service');
const { createRelationalRouter } = require('../../backend/modules/adapters/http');
const databaseUrl = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const serverId = '11111111-1111-4111-8111-111111111111';
const secret = 'system-http-fixture-secret-at-least-32-characters';
const owner = { actorId: 'owner', tokenVersion: '1' };
const staff = { actorId: 'staff', tokenVersion: '1' };
const viewer = { actorId: 'viewer', tokenVersion: '1' };

test('relational system metadata and complete dashboard use one canonical source', { skip: !databaseUrl }, async t => {
  const target = new URL(databaseUrl);
  assert.equal(target.pathname, '/erp_02a_verify'); assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  const pool = await createBusinessPool({ connectionString: databaseUrl }); t.after(() => pool.end());
  await migrateBusinessDatabase(pool);
  await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,'原组织',now(),'relational')", [serverId]);
  for (const role of ['owner', 'staff', 'viewer']) await pool.query('INSERT INTO erp.users(id,email,name,role,password_hash) VALUES($1,$2,$1,$1,$3)', [role, `${role}@system.example.test`, 'unused-hash']);
  await pool.query("CREATE TABLE public.app_store(id text PRIMARY KEY,data jsonb NOT NULL); INSERT INTO public.app_store VALUES('default','{\"organization\":\"旧原文\",\"money\":9007199254740993.01}')");
  const legacy = (await pool.query('SELECT data::text FROM public.app_store')).rows;
  const system = createSystemService(pool), maintenance = createMaintenanceService(pool);
  let nonce = 0;
  const rename = (version, name, actor = owner, key = `org-${++nonce}`) => system.execute({ ...actor, operation: 'organization.update', key, payload: { version, organizationName: name } });
  const state = () => maintenance.status({ expectedServerId: serverId });
  const maintain = async value => maintenance.setState({ expectedServerId: serverId, expectedVersion: (await state()).version, state: value, reason: '系统验收' });
  await t.test('organization has a version, Owner-only writes, exact retries and strict fields', async () => {
    const before = await system.organization(viewer); assert.equal(before.version, '1'); assert.equal(before.organizationName, '原组织');
    for (const actor of [staff, viewer]) await assert.rejects(rename(before.version, '越权改名', actor), { status: 403 });
    for (const organizationName of ['', ' '.repeat(5), 'a'.repeat(121)]) await assert.rejects(rename(before.version, organizationName), { status: 400 });
    await assert.rejects(system.execute({ ...owner, operation: 'organization.update', key: 'unknown-field', payload: { version: before.version, organizationName: '合法名称', serverId: 'forged' } }), { status: 400 });
    const result = await rename(before.version, '  新组织  ', owner, 'organization-retry');
    assert.equal(result.body.organizationName, '新组织'); assert.equal(result.body.version, '2'); assert.equal(result.body.serverId, serverId);
    assert.deepEqual(await rename(before.version, '  新组织  ', owner, 'organization-retry'), result);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM erp.audit_logs WHERE action='organization.update'")).rows[0].n, 1);
    await assert.rejects(rename(before.version, '过期覆盖'), { code: 'VERSION_CONFLICT' });
  });
  await t.test('concurrent versions allow only one update and failures roll back organization plus audit', async () => {
    const before = await system.organization(owner);
    const results = await Promise.allSettled(['A', 'B'].map(name => rename(before.version, name)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'VERSION_CONFLICT');
    for (const target of ['audit', 'receipt']) {
      const current = await system.organization(owner);
      const audits = (await pool.query('SELECT count(*)::int AS n FROM erp.audit_logs')).rows[0].n;
      if (target === 'audit') await pool.query("ALTER TABLE erp.audit_logs ADD CONSTRAINT system_failure CHECK(action<>'organization.update') NOT VALID");
      else await pool.query("ALTER TABLE erp.command_receipts ADD CONSTRAINT system_failure CHECK(key<>'system-fail')");
      try {
        await assert.rejects(rename(current.version, '必须回滚', owner, 'system-fail'), { code: 'BUSINESS_DATA_INVALID' });
        assert.deepEqual(await system.organization(owner), current);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.audit_logs')).rows[0].n, audits);
      } finally { await pool.query(`ALTER TABLE erp.${target === 'audit' ? 'audit_logs' : 'command_receipts'} DROP CONSTRAINT system_failure`); }
    }
  });
  await pool.query("INSERT INTO erp.materials(id,type,brand,color,unit,unit_price) VALUES('material-a','PLA','仪表盘','白色','kg',1)");
  await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('default','DEFAULT','默认仓库',true)");
  await pool.query("INSERT INTO erp.customers(id,code,name) VALUES('customer-a','C001','订单客户')");
  await pool.query("INSERT INTO erp.stock_lots(id,material_id,warehouse_id,qty_mg,baseline_qty_mg,balance_status) SELECT 'low-'||s,'material-a','default',1,0,'tracked' FROM generate_series(1,105) s");
  for (const [id, qty, stateValue, active, balance] of [
    ['boundary', '100000', 'in_stock', true, 'tracked'], ['above', '100001', 'in_stock', true, 'tracked'],
    ['frozen', '1', 'frozen', true, 'tracked'], ['scrapped', '1', 'scrapped', true, 'tracked'],
    ['inactive', '1', 'in_stock', false, 'tracked'], ['invalid', null, 'in_stock', false, 'legacy_invalid'],
    ['unverified', '1', 'in_stock', true, 'legacy_unverified'],
  ]) await pool.query('INSERT INTO erp.stock_lots(id,material_id,warehouse_id,qty_mg,baseline_qty_mg,balance_status,state,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, 'material-a', 'default', qty, balance === 'legacy_unverified' ? '1' : '0', balance, stateValue, active]);
  const statuses = ['pending_review', 'in_progress', 'completed', 'draft', 'cancelled', 'pending_review', 'in_progress'];
  for (let index = 0; index < statuses.length; index++) await pool.query("INSERT INTO erp.orders(id,number,customer_id,customer_snapshot,status,total,created_by,active,created_at) VALUES($1,$1,'customer-a','{\"name\":\"订单客户\"}',$2,$3,'owner',$4,$5)", [`order-${index}`, statuses[index], index === 4 ? '9007199254740993.01' : '1.00', index < 5, `2026-10-${String(10 + index).padStart(2, '0')}T00:00:00Z`]);
  await pool.query("INSERT INTO erp.order_items(order_id,id,position,quantity,unit_price,subtotal,spec_snapshot) VALUES('order-4','historical-line',0,1,1,9007199254740993.01,'{\"unknown\":9007199254740993.01}')");
  await t.test('dashboard counts all eligible batches beyond a page, preserves boundaries, statuses and exact historical money', async () => {
    const audits = (await pool.query('SELECT count(*)::int AS n FROM erp.audit_logs')).rows[0].n;
    const snapshot = await system.dashboard(owner);
    assert.deepEqual(snapshot.stats, { pendingReview: 1, inProgress: 1, lowStock: 107 });
    assert.deepEqual(snapshot.recentOrders.map(order => order.id), ['order-4','order-3','order-2','order-1']);
    assert.equal(snapshot.recentOrders[0].total, '9007199254740993.01');
    assert.equal(snapshot.recentOrders[0].items[0].subtotal, '9007199254740993.01');
    assert.equal(snapshot.recentOrders[0].items[0].unknown, '9007199254740993.01');
    assert.deepEqual(await system.dashboard(staff), snapshot); assert.deepEqual(await system.dashboard(viewer), snapshot);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.audit_logs')).rows[0].n, audits);
    await assert.rejects(system.dashboard({ ...owner, tokenVersion: '2' }), { status: 401 });
  });
  await t.test('HTTP discovery, organization and dashboard reflect canonical state and permit maintenance reads', async () => {
    const app = express(); app.use('/api', createRelationalRouter(pool, { jwtSecret: secret }));
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const request = async (path, method = 'GET', body, role = 'owner', modern = true) => {
      const token = jwt.sign({ sub: role, ver: '1' }, secret, { audience: TOKEN_AUDIENCE, issuer: `3d-manage:${serverId}` });
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': `system-http-${++nonce}`, ...(modern ? { 'X-Business-Rules-Version': '2' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cacheControl: response.headers.get('cache-control') };
    };
    try {
      let organization = await system.organization(owner);
      assert.equal((await request('/system/organization')).body.version, organization.version);
      assert.equal((await request('/system/organization', 'PATCH', { version: organization.version, organizationName: 'HTTP组织' }, 'staff')).status, 403);
      assert.equal((await request('/system/organization', 'PATCH', { version: organization.version, organizationName: 'HTTP组织' }, 'owner', false)).status, 428);
      assert.equal((await request('/system/organization', 'PATCH', { version: organization.version, organizationName: 'HTTP组织' })).status, 200);
      const info = await request('/system/info');
      assert.equal(info.body.organizationName, 'HTTP组织'); assert.equal(info.body.organizationVersion, String(BigInt(organization.version) + 1n));
      assert.equal(info.body.capabilities.dashboardRulesVersion, 1); assert.equal(info.body.capabilities.businessWritable, true);
      assert.equal(info.cacheControl, 'no-store');
      for (const role of ['owner','staff','viewer']) assert.deepEqual((await request('/system/dashboard?_=1792080896260', 'GET', undefined, role)).body.stats, { pendingReview: 1, inProgress: 1, lowStock: 107 });
      for (const path of ['/system/dashboard?unknown=true', '/system/dashboard?_=bad', '/system/dashboard?_=1&_=2']) assert.equal((await request(path)).status, 400);
      assert.equal((await request('/inventory/summary?_=1792080896260')).status, 200);
      assert.equal((await request('/inventory/summary?low_stock_only=true&_=1792080896260')).status, 200);
      assert.equal((await request('/inventory/summary?low_stock_only=true&lowStockOnly=false')).status, 400);
      assert.equal((await request('/materials/export?_=1792080896260')).status, 200);
      assert.equal((await request('/stock/export?_=1792080896260')).status, 200);
      await maintain('maintenance');
      try {
        const maintained = (await request('/system/info')).body;
        assert.equal(maintained.maintenance, true); assert.equal(maintained.capabilities.businessWritable, false);
        assert.equal(JSON.stringify(maintained).includes('系统验收'), false);
        assert.equal((await request('/system/dashboard')).status, 200);
        organization = await system.organization(owner);
        assert.equal((await request('/system/organization', 'PATCH', { version: organization.version, organizationName: '维护不能改名' })).status, 503);
        assert.equal((await system.organization(owner)).organizationName, 'HTTP组织');
      } finally { await maintain('open'); }
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
  assert.deepEqual((await pool.query('SELECT data::text FROM public.app_store')).rows, legacy);
});
