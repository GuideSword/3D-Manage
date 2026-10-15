'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBusinessPool, closeBusinessPool } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase, loadMigrations } = require('../../backend/business-db/migrator');
const { multiplyToCents } = require('../../backend/business-db/decimal');
const migrationDirectory = path.resolve(__dirname, '../../backend/business-db/migrations');

async function temporaryMigrations(t, files) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'manage3d-02a-migrations-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (const [name, contents] of Object.entries(files)) await fs.writeFile(path.join(directory, name), contents);
  return directory;
}

test('business connections require an explicit PostgreSQL URL and never use daily DATABASE_URL', async () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://localhost:1/do_not_connect';
  try {
    await assert.rejects(createBusinessPool(), { code: 'ERP_DATABASE_URL_REQUIRED' });
    await assert.rejects(createBusinessPool({ connectionString: 'file:///daily.db' }), { code: 'ERP_DATABASE_URL_INVALID' });
    await assert.rejects(createBusinessPool({ connectionString: 'postgresql://localhost' }), { code: 'ERP_DATABASE_URL_INVALID' });
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('migration files reject duplicate versions, sequence gaps, and invalid SQL filenames', async t => {
  for (const files of [
    { '0001_a.sql': 'SELECT 1;', '0001_b.sql': 'SELECT 2;' },
    { '0001_a.sql': 'SELECT 1;', '0003_b.sql': 'SELECT 2;' },
    { 'not_numbered.sql': 'SELECT 1;' },
  ]) {
    const directory = await temporaryMigrations(t, files);
    await assert.rejects(loadMigrations(directory), { code: 'ERP_MIGRATION_FILES_INVALID' });
  }
});

const databaseUrl = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
test('isolated PostgreSQL 16 foundation', { skip: !databaseUrl }, async t => {
  const target = new URL(databaseUrl);
  assert.equal(target.pathname, '/erp_02a_verify', 'Tests require the dedicated empty fixture database');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  const pool = await createBusinessPool({ connectionString: databaseUrl });
  t.after(() => closeBusinessPool(pool));
  assert.equal((await pool.query("SELECT to_regnamespace('erp') AS name")).rows[0].name, null);

  await t.test('concurrent first migration runs apply the same SQL exactly once', async () => {
    const results = await Promise.all([migrateBusinessDatabase(pool), migrateBusinessDatabase(pool)]);
    assert.deepEqual(results.map(r => r.applied.length).sort(), [0, 1]);
    const files = await loadMigrations(migrationDirectory);
    const rows = (await pool.query('SELECT version, filename, sha256 FROM erp.schema_migrations')).rows;
    assert.deepEqual(rows, [{ version: 1, filename: files[0].filename, sha256: files[0].sha256 }]);
    assert.deepEqual((await migrateBusinessDatabase(pool)).applied, []);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.installation')).rows[0].n, 0);
  });

  await t.test('changed applied SQL, unknown future versions, and broken history are rejected', async () => {
    const original = await fs.readFile(path.join(migrationDirectory, '0001_foundation.sql'), 'utf8');
    const changed = await temporaryMigrations(t, { '0001_foundation.sql': original + '\n-- modified\n' });
    await assert.rejects(migrateBusinessDatabase(pool, { migrationsDirectory: changed }), { code: 'ERP_MIGRATION_CHANGED' });
    await pool.query("INSERT INTO erp.schema_migrations(version,filename,sha256) VALUES(2,'0002_future.sql',$1)", ['0'.repeat(64)]);
    await assert.rejects(migrateBusinessDatabase(pool), { code: 'ERP_MIGRATION_FUTURE' });
    await pool.query('DELETE FROM erp.schema_migrations WHERE version=2');
    await pool.query("INSERT INTO erp.schema_migrations(version,filename,sha256) VALUES(3,'0003_gap.sql',$1)", ['0'.repeat(64)]);
    const three = await temporaryMigrations(t, { '0001_foundation.sql': original, '0002_next.sql': 'SELECT 1;', '0003_gap.sql': 'SELECT 1;' });
    await assert.rejects(migrateBusinessDatabase(pool, { migrationsDirectory: three }), { code: 'ERP_MIGRATION_HISTORY_INVALID' });
    await pool.query('DELETE FROM erp.schema_migrations WHERE version=3');
  });

  await t.test('a failed later migration rolls back the whole unapplied batch', async () => {
    const original = await fs.readFile(path.join(migrationDirectory, '0001_foundation.sql'), 'utf8');
    const directory = await temporaryMigrations(t, {
      '0001_foundation.sql': original,
      '0002_probe.sql': 'CREATE TABLE erp.atomic_migration_probe(id text PRIMARY KEY);',
      '0003_failure.sql': 'THIS IS NOT SQL;',
    });
    await assert.rejects(migrateBusinessDatabase(pool, { migrationsDirectory: directory }));
    assert.equal((await pool.query("SELECT to_regclass('erp.atomic_migration_probe') AS name")).rows[0].name, null);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.schema_migrations')).rows[0].n, 1);
  });

  await t.test('exact line amounts agree with PostgreSQL numeric arithmetic', async () => {
    for (const [quantity, price] of [['0.333', '3.000001'], ['2', '0.005000'], ['999999999999999.999', '0.000001']]) {
      const { rows } = await pool.query('SELECT round($1::numeric(18,3)*$2::numeric(20,6),2)::text AS amount', [quantity, price]);
      assert.equal(multiplyToCents(quantity, price), rows[0].amount);
    }
  });
});
