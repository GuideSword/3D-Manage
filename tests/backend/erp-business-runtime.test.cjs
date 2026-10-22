'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('../../backend/node_modules/express');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase } = require('../../backend/business-db/migrator');
const { createRelationalRouter } = require('../../backend/modules/adapters/http');
const { createBusinessRuntime } = require('../../backend/application/businessRuntime');
const databaseUrl = process.env.ERP_BUSINESS_TEST_DATABASE_URL;

test('file runtime selects one lazy factory and closes it exactly once', async () => {
  let opened = 0, closed = 0, handled = 0;
  const runtime = await createBusinessRuntime({ driver: 'file', connectionString: 'invalid-not-used',
    factories: {
      legacy: async ({ pool, installation }) => { assert.equal(pool, undefined); assert.equal(installation, null); opened++;
        return { router: () => { handled++; }, close: async () => { closed++; } }; },
      relational: () => { throw Error('Must not initialize relational storage'); },
    } });
  assert.equal(runtime.mode, 'legacy');
  await runtime.router({}, {}, error => { throw error; });
  assert.equal(handled, 1);
  await Promise.all([runtime.close(), runtime.close()]);
  assert.equal(opened, 1); assert.equal(closed, 1);
  let failure;
  await runtime.router({}, {}, error => { failure = error; });
  assert.equal(failure.code, 'BUSINESS_RUNTIME_CLOSED'); assert.equal(failure.status, 503);
  assert.equal(handled, 1);
});

test('configuration and asynchronous factory/router failures never select an alternative source', async () => {
  const original = Error('Factory failure');
  let alternate = 0;
  const factories = { legacy: async () => { throw original; }, relational: async () => { alternate++; } };
  for (const driver of [undefined, '', 'sqlite', 'bogus']) await assert.rejects(createBusinessRuntime({ driver, factories }), { code: 'BUSINESS_RUNTIME_CONFIGURATION_INVALID' });
  await assert.rejects(createBusinessRuntime({ driver: 'file', factories: {} }), { code: 'BUSINESS_RUNTIME_CONFIGURATION_INVALID' });
  await assert.rejects(createBusinessRuntime({ driver: 'file', factories }), error => error === original);
  const runtime = await createBusinessRuntime({ driver: 'file', factories: { ...factories,
    legacy: async () => ({ router: async () => { throw original; } }) } });
  let forwarded;
  await runtime.router({}, {}, error => { forwarded = error; });
  assert.equal(forwarded.cause, original); assert.equal(forwarded.status, 503);
  await runtime.close(); assert.equal(alternate, 0);
});

test('PostgreSQL runtime binds one source and fences later requests when database configuration changes', { skip: !databaseUrl }, async t => {
  const target = new URL(databaseUrl);
  assert.equal(target.pathname, '/erp_02a_verify');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  const pool = await createBusinessPool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const serverId = '11111111-1111-4111-8111-111111111111';
  const secret = 'runtime-fixture-secret-32-characters-minimum';
  const configuration = factories => ({ driver: 'postgres', connectionString: databaseUrl, factories });
  async function serve(runtime) {
    const app = express(); app.use('/api', runtime.router);
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code, error: error.message }));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    return { base: `http://127.0.0.1:${server.address().port}/api`, close: () => new Promise(resolve => server.close(resolve)) };
  }
  await pool.query('CREATE TABLE public.app_store(id text PRIMARY KEY,data jsonb NOT NULL)');
  await pool.query("INSERT INTO public.app_store VALUES('default','{\"proof\":9007199254740993.01}')");
  const before = (await pool.query('SELECT data::text AS raw FROM public.app_store')).rows;
  await t.test('legacy binding does not initialize a relational router and refuses live schema changes', async () => {
    let handled = 0, alternate = 0;
    const runtime = await createBusinessRuntime(configuration({
      legacy: async ({ pool: selected }) => ({ router: async (_req, res) => {
        handled++; const raw = (await selected.query('SELECT data::text AS raw FROM public.app_store')).rows[0].raw;
        res.json({ mode: 'legacy', raw });
      } }), relational: () => { alternate++; throw Error('Wrong factory'); },
    }));
    const http = await serve(runtime);
    try {
      const response = await fetch(http.base + '/probe'); assert.equal(response.status, 200);
      assert.equal((await response.json()).raw, before[0].raw); assert.equal(handled, 1);
      await pool.query('CREATE SCHEMA erp');
      assert.equal((await fetch(http.base + '/probe')).status, 503);
      assert.equal(handled, 1); assert.equal(alternate, 0);
    } finally { await http.close(); await runtime.close(); await pool.query('DROP SCHEMA erp'); }
  });
  await migrateBusinessDatabase(pool);
  await pool.query("INSERT INTO erp.installation(id,server_id,organization_name,initialized_at,storage_mode) VALUES('default',$1,'运行测试',now(),'relational')", [serverId]);
  await pool.query("INSERT INTO erp.users(id,email,name,role,password_hash) VALUES('owner','owner@runtime.example.test','Owner','owner',$1)", [await bcrypt.hash('Runtime-Fixture-Only-2026!', 12)]);
  await t.test('relational HTTP login, authenticated reads and list queries never touch legacy JSONB', async () => {
    let legacyLoaded = 0, relationalLoaded = 0;
    const runtime = await createBusinessRuntime({ ...configuration({
      legacy: () => { legacyLoaded++; throw Error('Legacy must not initialize'); },
      relational: async ({ pool: selected, installation }) => { relationalLoaded++; assert.equal(installation.serverId, serverId);
        return { router: createRelationalRouter(selected, { jwtSecret: secret }) }; },
    }), expectedServerId: serverId });
    const http = await serve(runtime);
    try {
      const discovery = await (await fetch(http.base + '/system/info')).json();
      assert.equal(discovery.serverId, serverId); assert.equal(discovery.capabilities.businessRulesVersion, 2);
      const response = await fetch(http.base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@runtime.example.test', password: 'Runtime-Fixture-Only-2026!' }) });
      assert.equal(response.status, 200); const login = await response.json();
      const read = await fetch(http.base + '/customers?_=1792080896260', { headers: { Authorization: `Bearer ${login.token}` } });
      assert.equal(read.status, 200); assert.equal((await read.json()).total, 0);
      assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, before);
      assert.equal(legacyLoaded, 0); assert.equal(relationalLoaded, 1);
    } finally { await http.close(); await runtime.close(); }
  });
  await t.test('mode, identity and migration hash changes return 503 without calling the bound router', async () => {
    let handled = 0, alternate = 0;
    const runtime = await createBusinessRuntime(configuration({ legacy: () => { alternate++; },
      relational: async () => ({ router: (_req, res) => { handled++; res.json({ ok: true }); } }),
    }));
    const http = await serve(runtime);
    const history = (await pool.query('SELECT sha256 FROM erp.schema_migrations WHERE version=1')).rows[0];
    try {
      assert.equal((await fetch(http.base + '/probe')).status, 200);
      await pool.query("UPDATE erp.installation SET storage_mode='legacy'");
      assert.equal((await fetch(http.base + '/probe')).status, 503);
      await pool.query("UPDATE erp.installation SET storage_mode='relational',server_id='22222222-2222-4222-8222-222222222222'");
      assert.equal((await fetch(http.base + '/probe')).status, 503);
      await pool.query('UPDATE erp.installation SET server_id=$1', [serverId]);
      await pool.query("UPDATE erp.schema_migrations SET sha256=$1 WHERE version=1", ['0'.repeat(64)]);
      assert.equal((await fetch(http.base + '/probe')).status, 503);
      assert.equal(handled, 1); assert.equal(alternate, 0);
    } finally {
      await pool.query("UPDATE erp.installation SET storage_mode='relational',server_id=$1", [serverId]);
      await pool.query('UPDATE erp.schema_migrations SET sha256=$1 WHERE version=1', [history.sha256]);
      await http.close(); await runtime.close();
    }
  });
  await t.test('wrong startup identity or factory failure closes the owned pool and does not initialize another source', async () => {
    let initialized = 0;
    const factories = { legacy: () => { initialized++; }, relational: () => { initialized++; } };
    await assert.rejects(createBusinessRuntime({ ...configuration(factories), expectedServerId: '22222222-2222-4222-8222-222222222222' }), { code: 'ERP_STORAGE_IDENTITY_MISMATCH' });
    assert.equal(initialized, 0);
    const original = Error('Relational initialization failed');
    await assert.rejects(createBusinessRuntime(configuration({ ...factories, relational: () => { throw original; } })), error => error === original);
    await assert.rejects(createBusinessRuntime(configuration({ ...factories, relational: () => ({ router: null }) })), { code: 'BUSINESS_RUNTIME_CONFIGURATION_INVALID' });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='manage3d-erp' AND datname=current_database()")).rows[0].n, 1);
  });
  await t.test('cleanup errors still close the owned pool and repeated close returns the same rejection', async () => {
    let closed = 0;
    const failure = Error('Factory close failed');
    const runtime = await createBusinessRuntime(configuration({ legacy: () => { throw Error('Wrong mode'); },
      relational: async () => ({ router: (_req, res) => res.end(), close: async () => { closed++; throw failure; } }),
    }));
    const first = runtime.close(); assert.equal(runtime.close(), first);
    await assert.rejects(first, error => error === failure); assert.equal(closed, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='manage3d-erp' AND datname=current_database()")).rows[0].n, 1);
  });
  await t.test('a request waiting on PostgreSQL cannot enter its router after shutdown begins', async () => {
    let handled = 0, forwarded;
    const runtime = await createBusinessRuntime(configuration({ legacy: () => { throw Error('Wrong mode'); },
      relational: async () => ({ router: () => { handled++; } }),
    }));
    const blocker = await pool.connect();
    let pending;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE erp.installation IN ACCESS EXCLUSIVE MODE');
      pending = runtime.router({}, {}, error => { forwarded = error; });
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='manage3d-erp' AND wait_event_type='Lock' AND query LIKE 'SELECT id,server_id,%' LIMIT 1");
        if (result.rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, 'Request must actually be waiting inside the read-only inspection');
      const closing = runtime.close();
      await blocker.query('COMMIT');
      await pending; await closing;
      assert.equal(forwarded.code, 'BUSINESS_RUNTIME_CLOSED'); assert.equal(handled, 0);
    } finally {
      await blocker.query('ROLLBACK'); blocker.release();
      await pending; await runtime.close();
    }
  });
  assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, before);
  assert.equal(Object.keys(require.cache).some(filename => /backend[\\/]utils[\\/]store\.js$/.test(filename)), false);
  assert.equal(Object.keys(require.cache).some(filename => /backend[\\/]db[\\/]agent\.js$/.test(filename)), false);
});
