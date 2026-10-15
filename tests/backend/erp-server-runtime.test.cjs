'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const http = require('node:http');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createMaintenanceService } = require('../../backend/business-db/maintenance');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { TOKEN_AUDIENCE } = require('../../backend/utils/authTokens');
const databaseUrl = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
const password = 'Server-Runtime-Fixture-2026!';
const bootstrapToken = 'server-runtime-bootstrap-token-32-characters';
const serverId = '11111111-1111-4111-8111-111111111111';
const jwtSecret = 'server-runtime-jwt-fixture-at-least-32-characters';

async function request(base, endpoint, method = 'GET', body, token, extra = {}) {
  const response = await fetch(base + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function createHarness(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-server-runtime-'));
  const children = new Set();
  t.after(async () => {
    for (const child of children) await child.stop();
    const resolved = path.resolve(directory), parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('erp-server-runtime-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return async function launch(name, driver, connectionString = '', override = {}) {
    const dataDir = path.join(directory, name);
    await fs.mkdir(dataDir, { recursive: true });
    const child = fork(path.resolve(__dirname, '../fixtures/erp-server-child.cjs'), [], { silent: true,
      cwd: path.resolve(__dirname, '../..'), env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        STORE_DRIVER: driver, DATABASE_URL: connectionString, STORE_TABLE: 'app_store', STORE_ID: 'default', DATABASE_SSL: 'false',
        DATA_DIR: dataDir, UPLOAD_DIR: path.join(dataDir, 'uploads'), JWT_SECRET: jwtSecret,
        AGENT_KEY_ENC_SECRET: 'server-runtime-agent-fixture-at-least-32-characters', BOOTSTRAP_TOKEN: bootstrapToken,
        OSS_ENABLED: 'false', AGENT_ENABLED: 'false', ...override } });
    let logs = '';
    child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
    child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    let stopPromise;
    const record = { stop: () => stopPromise ||= Promise.resolve().then(async () => {
      if (child.connected) child.send('stop');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 12000);
      try { return await exited; } finally { clearTimeout(deadline); children.delete(record); }
    }) };
    children.add(record);
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('Fixture startup timeout: ' + logs)); }, 15000);
      child.once('message', message => { clearTimeout(timer); resolve(message); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error('Fixture exited before startup message: ' + code + '\n' + logs)); });
    });
    return { ...record, ...ready, base: `http://127.0.0.1:${ready.port}`, dataDir, logs: () => logs };
  };
}

test('real file-mode server preserves bootstrap, authentication, restart and shutdown behavior', async t => {
  const launch = await createHarness(t);
  const child = await launch('file', 'file');
  assert.equal(child.state, 'ready', child.logs()); assert.equal(child.mode, 'legacy');
  assert.equal(child.loadedLegacy, true); assert.equal(child.loadedAI, true); assert.equal(child.agentFile, true);
  assert.equal((await request(child.base, '/health')).status, 200);
  const discovery = await request(child.base, '/api/system/info');
  assert.equal(discovery.body.initialized, false);
  const boot = await request(child.base, '/api/system/bootstrap', 'POST', { organizationName: '运行测试', ownerName: 'Owner', email: 'owner@server.example.test', password }, undefined, { 'X-Bootstrap-Token': bootstrapToken });
  assert.equal(boot.status, 201); assert.equal(boot.body.user.role, 'owner');
  const login = await request(child.base, '/api/auth/login', 'POST', { email: 'owner@server.example.test', password });
  assert.equal(login.status, 200);
  const info = (await request(child.base, '/api/system/info')).body;
  assert.equal(info.initialized, true);
  assert.equal((await child.stop()).code, 0);
  const restarted = await launch('file', 'file');
  assert.equal(restarted.state, 'ready', restarted.logs());
  assert.equal((await request(restarted.base, '/api/system/info')).body.serverId, info.serverId);
  assert.equal((await request(restarted.base, '/api/auth/login', 'POST', { email: 'owner@server.example.test', password })).status, 200);
  assert.equal((await restarted.stop()).code, 0);
});

test('real PostgreSQL server selects one storage mode before importing initialization or routes', { skip: !databaseUrl }, async t => {
  const target = new URL(databaseUrl);
  assert.equal(target.pathname, '/erp_02a_verify'); assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  const pool = await createBusinessPool({ connectionString: databaseUrl }); t.after(() => pool.end());
  const launch = await createHarness(t);
  const hash = await bcrypt.hash(password, 12);
  const timestamp = '2026-10-16T00:00:00.000Z';
  const data = { schemaVersion: 3, system: { serverId, organizationName: '原资料', initializedAt: timestamp },
    users: [{ id: 'owner', email: 'owner@server.example.test', name: 'Owner', role: 'owner', active: true, tokenVersion: 1, passwordHash: hash, createdAt: timestamp, updatedAt: timestamp }],
    orders: [], models: [], materials: [], stockLots: [], inventoryTxns: [], auditLogs: [], objectUploads: [], commandReceipts: [], createdAt: timestamp, updatedAt: timestamp };
  await pool.query('CREATE TABLE public.app_store(id text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())');
  await pool.query('INSERT INTO public.app_store(id,data) VALUES($1,$2)', ['default', JSON.stringify(data)]);
  await t.test('legacy PostgreSQL remains usable before any ERP schema exists', async () => {
    const child = await launch('legacy-pg', 'postgres', databaseUrl);
    assert.equal(child.state, 'ready', child.logs()); assert.equal(child.mode, 'legacy'); assert.equal(child.loadedLegacy, true);
    assert.equal((await request(child.base, '/api/system/info')).body.serverId, serverId);
    assert.equal((await request(child.base, '/api/auth/login', 'POST', { email: 'owner@server.example.test', password })).status, 200);
    assert.equal((await child.stop()).code, 0);
    assert.equal((await pool.query("SELECT to_regnamespace('erp') AS name")).rows[0].name, null);
  });
  await migrateBusinessDatabase(pool);
  await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,'关系资料',now(),'relational')", [serverId]);
  await pool.query("INSERT INTO erp.users(id,email,name,role,password_hash) VALUES('owner','owner@server.example.test','Owner','owner',$1)", [hash]);
  await pool.query("UPDATE public.app_store SET data=jsonb_set(data,'{precisionProof}','9007199254740993.01')");
  const before = (await pool.query('SELECT data::text AS raw FROM public.app_store')).rows;
  await t.test('relational server never imports legacy store or AI and preserves old raw evidence', async () => {
    for (let run = 0; run < 2; run++) {
      const child = await launch('relational', 'postgres', databaseUrl);
      assert.equal(child.state, 'ready', child.logs()); assert.equal(child.mode, 'relational');
      assert.equal(child.loadedLegacy, false); assert.equal(child.loadedAI, false); assert.equal(child.agentFile, false);
      const info = await request(child.base, '/api/system/info');
      assert.equal(info.body.organizationName, '关系资料'); assert.equal(info.body.capabilities.businessRulesVersion, 2);
      const login = await request(child.base, '/api/auth/login', 'POST', { email: 'owner@server.example.test', password });
      assert.equal(login.status, 200);
      assert.equal((await request(child.base, '/api/customers?_=1792080896260', 'GET', undefined, login.body.token)).status, 200);
      assert.equal((await request(child.base, '/api/system/dashboard?_=1792080896260', 'GET', undefined, login.body.token)).status, 200);
      for (const endpoint of ['/api/agent/conversations', '/api/files/old.pdf', '/api/oss/download-url']) {
        const response = await request(child.base, endpoint, 'GET', undefined, login.body.token);
        assert.equal(response.status, 503); assert.equal(response.body.code, 'FEATURE_MAINTENANCE');
      }
      await pool.query("UPDATE erp.installation SET storage_mode='legacy'");
      assert.equal((await request(child.base, '/health')).status, 503);
      assert.equal((await request(child.base, '/api/customers', 'GET', undefined, login.body.token)).status, 503);
      await pool.query("UPDATE erp.installation SET storage_mode='relational'");
      assert.equal((await child.stop()).code, 0);
      assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, before);
    }
  });
  await t.test('listen failure closes the selected PostgreSQL pool and does not load legacy services', async () => {
    const occupied = http.createServer((_req, res) => res.end());
    await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
    try {
      const child = await launch('occupied-port', 'postgres', databaseUrl, { PORT: String(occupied.address().port) });
      assert.equal(child.state, 'failed'); assert.equal(child.code, 'EADDRINUSE');
      assert.equal(child.loadedLegacy, false); assert.equal(child.loadedAI, false);
      await child.stop();
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='manage3d-erp' AND datname=current_database()")).rows[0].n, 1);
      assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, before);
    } finally { await new Promise(resolve => occupied.close(resolve)); }
  });
  await t.test('maintenance persists over real server restarts while health and authenticated reads stay available', async () => {
    const maintenance = createMaintenanceService(pool);
    const initial = await maintenance.status({ expectedServerId: serverId });
    await maintenance.setState({ expectedServerId: serverId, expectedVersion: initial.version, state: 'maintenance', reason: '实际重启维护验收' });
    const token = jwt.sign({ sub: 'owner', ver: '1' }, jwtSecret, { audience: TOKEN_AUDIENCE, issuer: `3d-manage:${serverId}` });
    const audits = (await pool.query('SELECT count(*)::int AS n FROM erp.audit_logs')).rows[0].n;
    try {
      for (let run = 0; run < 2; run++) {
        const child = await launch('maintained-server', 'postgres', databaseUrl);
        assert.equal(child.state, 'ready', child.logs()); assert.equal(child.loadedLegacy, false); assert.equal(child.loadedAI, false);
        assert.equal((await request(child.base, '/health')).status, 200);
        assert.equal((await request(child.base, '/api/system/info')).status, 200);
        assert.equal((await request(child.base, '/api/customers', 'GET', undefined, token)).status, 200);
        const login = await request(child.base, '/api/auth/login', 'POST', { email: 'owner@server.example.test', password });
        assert.equal(login.status, 503); assert.equal(login.body.code, 'BUSINESS_MAINTENANCE');
        assert.equal((await child.stop()).code, 0);
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.audit_logs')).rows[0].n, audits);
        assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, before);
      }
    } finally {
      const current = await maintenance.status({ expectedServerId: serverId });
      await maintenance.setState({ expectedServerId: serverId, expectedVersion: current.version, state: 'open', reason: '重启验收结束' });
    }
  });
  await t.test('shutdown during pending startup cannot leave a listening server or PostgreSQL connection', async () => {
    const child = await launch('stop-during-start', 'postgres', databaseUrl, { ERP_RUNTIME_STOP_DURING_START: 'true' });
    assert.equal(child.state, 'stopped-before-start', child.logs());
    assert.equal(child.loadedLegacy, false); assert.equal(child.loadedAI, false);
    assert.equal((await child.stop()).code, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='manage3d-erp' AND datname=current_database()")).rows[0].n, 1);
  });
  await t.test('missing installation refuses startup before importing legacy store or initializing SQLite', async () => {
    const row = (await pool.query('DELETE FROM erp.installation RETURNING *')).rows[0];
    try {
      const child = await launch('missing-installation', 'postgres', databaseUrl);
      assert.equal(child.state, 'failed'); assert.equal(child.code, 'ERP_STORAGE_INCOMPLETE');
      assert.equal(child.loadedLegacy, false); assert.equal(child.loadedAI, false); assert.equal(child.agentFile, false);
      await child.stop();
      assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, before);
    } finally { await pool.query('INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode,version) VALUES($1,$2,$3,$4,$5,$6)', [row.id, row.server_id, row.organization_name, row.initialized_at, row.storage_mode, row.version]); }
  });
  await t.test('corrupt migration history rejects startup without initializing old data or AI', async () => {
    const original = (await pool.query('SELECT sha256 FROM erp.schema_migrations WHERE version=1')).rows[0].sha256;
    await pool.query("UPDATE erp.schema_migrations SET sha256=$1 WHERE version=1", ['0'.repeat(64)]);
    try {
      const child = await launch('corrupt', 'postgres', databaseUrl);
      assert.equal(child.state, 'failed'); assert.equal(child.code, 'ERP_MIGRATION_CHANGED');
      assert.equal(child.loadedLegacy, false); assert.equal(child.loadedAI, false); assert.equal(child.agentFile, false);
      await child.stop();
      assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, before);
    } finally { await pool.query('UPDATE erp.schema_migrations SET sha256=$1 WHERE version=1', [original]); }
  });
});
