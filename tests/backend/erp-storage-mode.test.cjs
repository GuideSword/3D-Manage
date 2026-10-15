'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase, loadMigrations } = require('../../backend/business-db/migrator');
const { inspectBusinessStorage } = require('../../backend/business-db/storageMode');
const databaseUrl = process.env.ERP_BUSINESS_TEST_DATABASE_URL;

test('storage mode inspection is read-only and never falls back from damaged relational state', { skip: !databaseUrl }, async t => {
  const target = new URL(databaseUrl);
  assert.equal(target.pathname, '/erp_02a_verify');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  const pool = await createBusinessPool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  const legacy = { mode: 'legacy', schemaVersion: 0, installation: null };
  const serverId = '11111111-1111-4111-8111-111111111111';
  const migrationFiles = await loadMigrations(require('node:path').resolve(__dirname, '../../backend/business-db/migrations'));
  const version = migrationFiles.at(-1).version;
  let legacyRows;
  async function snapshot() {
    return {
      legacy: (await pool.query('SELECT data::text AS raw FROM public.app_store ORDER BY id')).rows,
      installation: (await pool.query('SELECT * FROM erp.installation ORDER BY id')).rows,
      history: (await pool.query('SELECT * FROM erp.schema_migrations ORDER BY version')).rows,
    };
  }
  async function refuses(code, options) {
    const before = await snapshot();
    await assert.rejects(inspectBusinessStorage(pool, options), { code });
    assert.deepEqual(await snapshot(), before);
  }
  await t.test('empty database remains empty and uses no migration DDL', async () => {
    const statements = [];
    let readOnlySeen = false;
    const observedPool = { connect: async () => {
      const client = await pool.connect();
      return { query: async (sql, values) => {
        statements.push(sql);
        const result = await client.query(sql, values);
        if (sql.startsWith('SET TRANSACTION')) {
          assert.equal((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
          readOnlySeen = true;
        }
        return result;
      }, release: error => client.release(error) };
    } };
    assert.deepEqual(await inspectBusinessStorage(observedPool), legacy);
    assert.equal(readOnlySeen, true);
    assert.ok(statements.every(sql => /^(BEGIN|SELECT|SET TRANSACTION|COMMIT|ROLLBACK)\b/.test(sql)));
    assert.equal((await pool.query("SELECT to_regnamespace('erp') AS name")).rows[0].name, null);
  });
  await t.test('existing legacy JSONB retains exact raw data and creates no ERP schema', async () => {
    await pool.query('CREATE TABLE public.app_store(id text PRIMARY KEY,data jsonb NOT NULL)');
    await pool.query("INSERT INTO public.app_store VALUES('default','{\"proof\":9007199254740993.01}')");
    legacyRows = (await pool.query('SELECT data::text AS raw FROM public.app_store')).rows;
    assert.deepEqual(await inspectBusinessStorage(pool), legacy);
    assert.equal((await pool.query("SELECT to_regnamespace('erp') AS name")).rows[0].name, null);
    assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, legacyRows);
  });
  await t.test('partial ERP schema is refused instead of interpreted as legacy', async () => {
    await pool.query('CREATE SCHEMA erp');
    try { await assert.rejects(inspectBusinessStorage(pool), { code: 'ERP_STORAGE_INCOMPLETE' }); }
    finally { await pool.query('DROP SCHEMA erp'); }
    assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, legacyRows);
  });
  await t.test('migrated schema without an installation cannot bootstrap or fall back implicitly', async () => {
    await migrateBusinessDatabase(pool);
    await refuses('ERP_STORAGE_INCOMPLETE');
  });
  await t.test('both explicit modes and repeated concurrent inspections retain identity and all data', async () => {
    await pool.query("INSERT INTO erp.installation VALUES('default',$1,'运行核验', $2, 'legacy')", [serverId, '2026-10-16T00:00:00Z']);
    assert.deepEqual(await inspectBusinessStorage(pool, { expectedServerId: serverId }), {
      mode: 'legacy', schemaVersion: version,
      installation: { serverId, organizationName: '运行核验', initializedAt: '2026-10-16T00:00:00.000Z' },
    });
    await pool.query("UPDATE erp.installation SET storage_mode='relational'");
    const before = await snapshot();
    const results = await Promise.all(Array.from({ length: 6 }, () => inspectBusinessStorage(pool, { expectedServerId: serverId })));
    assert.equal(results[0].mode, 'relational');
    assert.equal(results[0].schemaVersion, version);
    assert.ok(results.every(result => JSON.stringify(result) === JSON.stringify(results[0])));
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('server identity mismatch cannot reset installation or select JSONB', async () => {
    await refuses('ERP_STORAGE_IDENTITY_MISMATCH', { expectedServerId: '22222222-2222-4222-8222-222222222222' });
    await refuses('ERP_STORAGE_IDENTITY_MISMATCH', { expectedServerId: null });
  });
  await t.test('changed SQL hash and filename are refused without applying migrations', async () => {
    const file = migrationFiles[0];
    for (const [column, value] of [['sha256', '0'.repeat(64)], ['filename', '0001_changed.sql']]) {
      await pool.query(`UPDATE erp.schema_migrations SET ${column}=$1 WHERE version=1`, [value]);
      try { await refuses('ERP_MIGRATION_CHANGED'); }
      finally { await pool.query(`UPDATE erp.schema_migrations SET ${column}=$1 WHERE version=1`, [file[column]]); }
    }
  });
  await t.test('missing last migration is refused and not silently upgraded', async () => {
    const file = migrationFiles.at(-1);
    const before = (await pool.query('DELETE FROM erp.schema_migrations WHERE version=$1 RETURNING *', [file.version])).rows[0];
    try { await refuses('ERP_MIGRATION_PENDING'); }
    finally { await pool.query('INSERT INTO erp.schema_migrations VALUES($1,$2,$3,$4)', [before.version, before.filename, before.sha256, before.applied_at]); }
  });
  await t.test('future migration records are refused without falling back', async () => {
    await pool.query('INSERT INTO erp.schema_migrations(version,filename,sha256) VALUES($1,$2,$3)', [version + 1, '9999_future.sql', '0'.repeat(64)]);
    try { await refuses('ERP_MIGRATION_FUTURE'); }
    finally { await pool.query('DELETE FROM erp.schema_migrations WHERE version=$1', [version + 1]); }
  });
  await t.test('gapped migration history is refused unchanged', async () => {
    const before = (await pool.query('DELETE FROM erp.schema_migrations WHERE version=2 RETURNING *')).rows[0];
    try { await refuses('ERP_MIGRATION_HISTORY_INVALID'); }
    finally { await pool.query('INSERT INTO erp.schema_migrations VALUES($1,$2,$3,$4)', [before.version, before.filename, before.sha256, before.applied_at]); }
  });
  await t.test('unknown storage mode never selects either old or new business routes', async () => {
    await pool.query('ALTER TABLE erp.installation DROP CONSTRAINT installation_storage_mode_check');
    await pool.query("UPDATE erp.installation SET storage_mode='unknown'");
    try { await refuses('ERP_STORAGE_MODE_INVALID'); }
    finally {
      await pool.query("UPDATE erp.installation SET storage_mode='relational'");
      await pool.query("ALTER TABLE erp.installation ADD CONSTRAINT installation_storage_mode_check CHECK(storage_mode IN ('legacy','relational'))");
    }
  });
  await t.test('invalid initialization date is refused without repairing records', async () => {
    await pool.query("UPDATE erp.installation SET initialized_at='infinity'");
    try { await refuses('ERP_STORAGE_INCOMPLETE'); }
    finally { await pool.query("UPDATE erp.installation SET initialized_at='2026-10-16T00:00:00Z'"); }
  });
  await t.test('missing installation relation is refused before issuing an invalid select', async () => {
    const before = await snapshot();
    await pool.query('ALTER TABLE erp.installation RENAME TO unavailable_installation');
    try { await assert.rejects(inspectBusinessStorage(pool), { code: 'ERP_STORAGE_INCOMPLETE' }); }
    finally { await pool.query('ALTER TABLE erp.unavailable_installation RENAME TO installation'); }
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('database connection failures propagate and never become a legacy result', async () => {
    const unavailable = await createBusinessPool({ connectionString: databaseUrl });
    await unavailable.end();
    await assert.rejects(inspectBusinessStorage(unavailable), /pool after calling end/);
    assert.equal((await inspectBusinessStorage(pool)).mode, 'relational');
    assert.deepEqual((await pool.query('SELECT data::text AS raw FROM public.app_store')).rows, legacyRows);
  });
});
