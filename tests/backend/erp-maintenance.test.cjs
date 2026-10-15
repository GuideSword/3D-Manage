'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const express = require('../../backend/node_modules/express');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { TOKEN_AUDIENCE } = require('../../backend/utils/authTokens');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createBusinessCommands } = require('../../backend/business-db/commands');
const { createMaintenanceService } = require('../../backend/business-db/maintenance');
const { createRelationalServices } = require('../../backend/modules/adapters/services');
const { createRelationalRouter } = require('../../backend/modules/adapters/http');
const { createAgentAdapter } = require('../../backend/modules/adapters/agent');
const { parseArguments } = require('../../backend/scripts/erp-maintenance');
const databaseUrl = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const serverId = '11111111-1111-4111-8111-111111111111';
const jwtSecret = 'maintenance-fixture-secret-minimum-32-characters';
const owner = { actorId: 'owner', tokenVersion: '1' };

test('host maintenance CLI requires an explicit target, identity, version and reason', () => {
  const base = ['--target-env', 'ERP_MAINTENANCE_FIXTURE_DATABASE_URL', '--server-id', serverId];
  assert.equal(parseArguments(['status', ...base]).action, 'status');
  assert.equal(parseArguments(['enter', ...base, '--expected-version', '1', '--reason', '验收']).action, 'enter');
  for (const args of [[], ['status'], ['status', ...base, '--reason', 'unused'], ['enter', ...base],
    ['enter', ...base, '--expected-version', '0', '--reason', '验收'], ['enter', ...base, '--expected-version', '1', '--reason', ''],
    ['leave', ...base, '--expected-version', '1', '--reason', '验收', '--target-env', 'OTHER'],
    ['status', ...base, '--unknown', 'value']]) assert.throws(() => parseArguments(args), { code: 'MAINTENANCE_ARGUMENTS_INVALID' });
});

test('PostgreSQL maintenance drains active writes, persists across connections and protects every relational write seam', { skip: !databaseUrl }, async t => {
  const target = new URL(databaseUrl);
  assert.equal(target.pathname, '/erp_02a_verify'); assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  const pool = await createBusinessPool({ connectionString: databaseUrl }); t.after(() => pool.end());
  await migrateBusinessDatabase(pool);
  await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,'维护验收',now(),'relational')", [serverId]);
  const password = 'Maintenance-Fixture-Only-2026!';
  const hash = await bcrypt.hash(password, 12);
  for (const role of ['owner', 'staff', 'viewer']) await pool.query('INSERT INTO erp.users(id,email,name,role,password_hash) VALUES($1,$2,$1,$1,$3)', [role, `${role}@maintenance.example.test`, hash]);
  await pool.query("INSERT INTO erp.customers(id,code,name) VALUES('customer-a','C001','维护客户')");
  await pool.query("INSERT INTO erp.warehouses(id,code,name,is_default) VALUES('default','DEFAULT','默认仓库',true)");
  const services = createRelationalServices(pool, { jwtSecret });
  const maintenance = createMaintenanceService(pool);
  const status = () => maintenance.status({ expectedServerId: serverId });
  const changeState = async state => maintenance.setState({ expectedServerId: serverId, expectedVersion: (await status()).version, state, reason: '隔离维护验收' });
  let nonce = 0;
  const command = (service, operation, payload, key = `maintenance-${++nonce}`) => service.execute({ ...owner, operation, payload, key });
  const material = (await command(services.materials, 'material.create', { type: 'PLA', brand: '维护耗材', color: '白色', unitPrice: '1' })).body;
  const model = (await command(services.models, 'model.create', { name: '维护模型' })).body;
  async function facts() {
    const result = {};
    for (const table of ['users','customers','suppliers','warehouses','materials','models','model_files','model_images','orders','order_items','order_attachments','stock_lots','inventory_txns','object_uploads','audit_logs','command_receipts']) {
      const raw = (await pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]') AS raw FROM erp.${table} t`)).rows[0].raw;
      result[table] = createHash('sha256').update(raw).digest('hex');
    }
    return result;
  }
  async function duringMaintenance(work) {
    await changeState('maintenance');
    try { await work(); } finally { await changeState('open'); }
  }
  await t.test('state, identity, version, reason and no-op transitions are guarded and durable', async () => {
    const initial = await status(); assert.equal(initial.state, 'open'); assert.equal(initial.version, '1');
    await assert.rejects(maintenance.status({ expectedServerId: '22222222-2222-4222-8222-222222222222' }), { code: 'ERP_STORAGE_IDENTITY_MISMATCH' });
    await assert.rejects(maintenance.status({}), { code: 'MAINTENANCE_ARGUMENTS_INVALID' });
    await assert.rejects(maintenance.setState({ expectedServerId: serverId, expectedVersion: '1', state: 'maintenance', reason: '' }), { code: 'MAINTENANCE_ARGUMENTS_INVALID' });
    await assert.rejects(maintenance.setState({ expectedServerId: serverId, expectedVersion: '1', state: 'unknown', reason: '验收' }), { code: 'MAINTENANCE_ARGUMENTS_INVALID' });
    const entered = await changeState('maintenance'); assert.equal(entered.state, 'maintenance'); assert.equal(entered.version, '2');
    const second = await createBusinessPool({ connectionString: databaseUrl });
    try { assert.deepEqual(await createMaintenanceService(second).status({ expectedServerId: serverId }), entered); } finally { await second.end(); }
    const before = await facts();
    assert.deepEqual(await maintenance.setState({ expectedServerId: serverId, expectedVersion: entered.version, state: 'maintenance', reason: '不会重复记审计' }), entered);
    assert.deepEqual(await facts(), before);
    await assert.rejects(maintenance.setState({ expectedServerId: serverId, expectedVersion: '1', state: 'open', reason: '旧版本' }), { code: 'VERSION_CONFLICT' });
    await changeState('open');
    await pool.query("UPDATE erp.installation SET storage_mode='legacy'");
    try { await assert.rejects(status(), { code: 'MAINTENANCE_REQUIRES_RELATIONAL' }); }
    finally { await pool.query("UPDATE erp.installation SET storage_mode='relational'"); }
  });
  await t.test('all business and account services reject writes without changing facts or receipts', async () => {
    const requests = [
      [services.materials, 'material.create', { type: 'PLA', brand: '新增耗材', color: '白色', unitPrice: '2' }],
      [services.models, 'model.create', { name: '新增模型' }],
      [services.orders, 'order.create', { customerId: 'customer-a', items: [{ modelId: model.id, quantity: '1', unitPrice: '1' }] }],
      [services.inventory, 'lot.create', { materialId: material.id, qty_g: '1' }],
      [services.customers, 'customer.update', { id: 'customer-a', version: '1', changes: { name: '维护时不可改名' } }],
      [services.warehouses, 'warehouse.update', { id: 'default', version: '1', changes: { name: '维护时不可改名' } }],
      [services.users, 'user.update', { id: 'staff', version: '1', changes: { name: '维护时不可改名' } }],
    ];
    await duringMaintenance(async () => {
      const before = await facts();
      for (const [index, [service, operation, payload]] of requests.entries()) await assert.rejects(command(service, operation, payload, index === 0 ? 'retry-after-maintenance' : undefined), { code: 'BUSINESS_MAINTENANCE', status: 503 });
      await assert.rejects(services.users.changeOwnPassword({ ...owner, key: 'maintenance-password', payload: { version: '1', currentPassword: password, newPassword: 'Maintenance-New-Pass-2026!' } }), { code: 'BUSINESS_MAINTENANCE', status: 503 });
      assert.equal((await services.materials.get(owner, material.id)).id, material.id);
      assert.deepEqual(await facts(), before);
    });
    const [service, operation, payload] = requests[0];
    const result = await command(service, operation, payload, 'retry-after-maintenance');
    assert.deepEqual(await command(service, operation, payload, 'retry-after-maintenance'), result);
  });
  await t.test('HTTP login, CSV import and confirmed AI updates share the fence; reads and existing sessions survive', async () => {
    const app = express(); app.use('/api', createRelationalRouter(pool, { jwtSecret }));
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const token = jwt.sign({ sub: 'owner', ver: '1' }, jwtSecret, { audience: TOKEN_AUDIENCE, issuer: `3d-manage:${serverId}` });
    const agent = createAgentAdapter(pool, owner, { jwtSecret });
    const proposal = await agent.db.prepareRecordUpdate({ entity: 'materials', id: material.id, changes: { notes: '维护时不可改说明' } });
    try {
      await duringMaintenance(async () => {
        const before = await facts();
        const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@maintenance.example.test', password }) });
        assert.equal(login.status, 503); assert.equal((await login.json()).code, 'BUSINESS_MAINTENANCE');
        const read = await fetch(base + '/materials', { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(read.status, 200); assert.ok((await read.json()).items.some(row => row.id === material.id));
        await assert.rejects(services.csv.importRecords(owner, 'materials', 'type,brand,color,unit_price\r\nPLA,维护导入,白色,1', 'maintenance-csv'), { code: 'BUSINESS_MAINTENANCE', status: 503 });
        await assert.rejects(agent.confirmRecordUpdate({ proposal, confirmed: true, key: 'maintenance-ai' }), { code: 'BUSINESS_MAINTENANCE', status: 503 });
        assert.deepEqual(await facts(), before);
      });
      const result = await agent.confirmRecordUpdate({ proposal, confirmed: true, key: 'maintenance-ai' });
      assert.equal(result.body.notes, '维护时不可改说明');
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
  await t.test('an exclusive maintenance transition waits for active writes and blocks queued incoming writes', async () => {
    let releaseHandler, enteredHandler;
    const release = new Promise(resolve => { releaseHandler = resolve; });
    const entered = new Promise(resolve => { enteredHandler = resolve; });
    const execute = createBusinessCommands(pool, { 'probe.write': { roles: ['owner'], async handle(tx, { payload, audit }) {
      await tx.query('INSERT INTO erp.models(id,name,source) VALUES($1,$1,$2)', [payload.id, 'original']);
      await audit({ entity: 'models', entityId: payload.id, action: 'create', diff: {} });
      if (payload.id === 'inflight-probe') { enteredHandler(); await release; }
      return { status: 201, body: { id: payload.id } };
    } } });
    const inflight = execute({ ...owner, operation: 'probe.write', key: 'old-write', payload: { id: 'inflight-probe' } });
    await entered;
    const entering = changeState('maintenance');
    let incoming;
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock(%' LIMIT 1")).rows;
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, 'Maintenance must actually wait for an in-flight shared transaction lock');
      incoming = execute({ ...owner, operation: 'probe.write', key: 'new-write', payload: { id: 'incoming-probe' } }).then(value => ({ value }), error => ({ error }));
      let newWriterWaiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock_shared(%' LIMIT 1")).rows;
        if (rows.length) { newWriterWaiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(newWriterWaiting, true, 'New write must wait behind the queued exclusive maintenance transition');
      releaseHandler(); await inflight; await entering;
      assert.equal((await incoming).error.code, 'BUSINESS_MAINTENANCE');
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM erp.models WHERE id='inflight-probe'")).rows[0].n, 1);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM erp.models WHERE id='incoming-probe'")).rows[0].n, 0);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM erp.command_receipts WHERE key='new-write'")).rows[0].n, 0);
    } finally {
      releaseHandler(); await Promise.allSettled([inflight, entering, incoming].filter(Boolean));
      if ((await status()).state === 'maintenance') await changeState('open');
    }
  });
  await t.test('audit failure rolls back state/version and releases the exclusive lock', async () => {
    const before = await status();
    await pool.query("ALTER TABLE erp.audit_logs ADD CONSTRAINT maintenance_audit_failure CHECK(action<>'maintenance.enter') NOT VALID");
    try {
      await assert.rejects(changeState('maintenance'), { code: '23514' });
      assert.deepEqual(await status(), before);
    } finally { await pool.query('ALTER TABLE erp.audit_logs DROP CONSTRAINT maintenance_audit_failure'); }
    await command(services.models, 'model.create', { name: '回滚后可写' });
  });
  await t.test('missing or invalid maintenance state fails closed and never recreates configuration', async () => {
    const row = (await pool.query('DELETE FROM erp.runtime_control RETURNING *')).rows[0];
    try {
      await assert.rejects(command(services.models, 'model.create', { name: '不应创建' }), { code: 'MAINTENANCE_STATE_INVALID', status: 503 });
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.runtime_control')).rows[0].n, 0);
    } finally { await pool.query('INSERT INTO erp.runtime_control VALUES($1,$2,$3,$4,$5)', [row.id, row.state, row.reason, row.version, row.updated_at]); }
    await pool.query('ALTER TABLE erp.runtime_control DROP CONSTRAINT runtime_control_state_check');
    await pool.query("UPDATE erp.runtime_control SET state='unknown'");
    try {
      await assert.rejects(command(services.models, 'model.create', { name: '非法状态不可写' }), { code: 'MAINTENANCE_STATE_INVALID', status: 503 });
      await assert.rejects(status(), { code: 'MAINTENANCE_STATE_INVALID' });
    } finally {
      await pool.query("UPDATE erp.runtime_control SET state='open'");
      await pool.query("ALTER TABLE erp.runtime_control ADD CONSTRAINT runtime_control_state_check CHECK(state IN ('open','maintenance'))");
    }
    await pool.query('ALTER TABLE erp.runtime_control RENAME TO unavailable_runtime_control');
    try { await assert.rejects(command(services.models, 'model.create', { name: '缺表不可写' }), { code: 'MAINTENANCE_STATE_INVALID', status: 503 }); }
    finally { await pool.query('ALTER TABLE erp.unavailable_runtime_control RENAME TO runtime_control'); }
  });
  await t.test('host CLI status/enter/leave target only the explicit database and do not expose credentials', async () => {
    const args = ['--target-env', 'ERP_MAINTENANCE_FIXTURE_DATABASE_URL', '--server-id', serverId];
    const options = { env: { ...process.env, ERP_MAINTENANCE_FIXTURE_DATABASE_URL: databaseUrl }, timeout: 15000 };
    const run = async (action, extra = []) => JSON.parse((await execFile(process.execPath, ['backend/scripts/erp-maintenance.js', action, ...args, ...extra], options)).stdout);
    const before = await run('status'); assert.equal(before.state, 'open');
    const entered = await run('enter', ['--expected-version', before.version, '--reason', 'CLI隔离验收']);
    assert.equal(entered.state, 'maintenance');
    assert.equal((await run('status')).state, 'maintenance');
    const reopened = await run('leave', ['--expected-version', entered.version, '--reason', 'CLI恢复写入']);
    assert.equal(reopened.state, 'open');
    assert.equal(JSON.stringify(reopened).includes(new URL(databaseUrl).password), false);
  });
});
