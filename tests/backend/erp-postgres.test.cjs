'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBusinessPool, closeBusinessPool, assertBusinessDatabaseVersion } = require('../../backend/business-db/connection');
const { migrateBusinessDatabase, loadMigrations } = require('../../backend/business-db/migrator');
const { multiplyToCents } = require('../../backend/business-db/decimal');
const { withBusinessTransaction } = require('../../backend/business-db/transaction');
const { createVersionedUpdater } = require('../../backend/business-db/versioned');
const updateVersioned = createVersionedUpdater({ 'erp.transaction_probe': ['value'] });
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

test('unsupported PostgreSQL major versions are rejected', async () => {
  for (const version of [150000, 170000]) {
    await assert.rejects(assertBusinessDatabaseVersion({ query: async () => ({ rows: [{ version }] }) }),
      { code: 'ERP_DATABASE_VERSION_UNSUPPORTED' });
  }
});

test('transaction commits once, preserves callback failures, and discards a connection when rollback fails', async () => {
  const queries = [];
  const releases = [];
  const client = { query: async sql => { queries.push(sql); }, release: error => releases.push(error) };
  const pool = { connect: async () => client };
  assert.equal(await withBusinessTransaction(pool, async tx => { assert.equal(tx, client); return 'result'; }), 'result');
  assert.deepEqual(queries, ['BEGIN', 'COMMIT']);
  assert.deepEqual(releases, [undefined]);
  queries.length = 0;
  releases.length = 0;
  const original = new Error('business failed');
  const rollback = new Error('rollback failed');
  client.query = async sql => { queries.push(sql); if (sql === 'ROLLBACK') throw rollback; };
  await assert.rejects(withBusinessTransaction(pool, async () => { throw original; }), error => error === original);
  assert.equal(original.rollbackError, rollback);
  assert.deepEqual(queries, ['BEGIN', 'ROLLBACK']);
  assert.deepEqual(releases, [rollback]);
});

const databaseUrl = process.env.ERP_BUSINESS_TEST_DATABASE_URL;
test('versioned writes reject invalid versions and unregistered identifiers before issuing SQL', async () => {
  const tx = { query: async () => { throw new Error('SQL must not run'); } };
  const valid = { table: 'erp.transaction_probe', id: 'p1', expectedVersion: 1, changes: { value: 'next' } };
  for (const expectedVersion of [undefined, null, 0, -1, 1.1, false, '0', '-1', '1e2', '1.5', '9223372036854775807', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(updateVersioned(tx, { ...valid, expectedVersion }), { code: 'VERSION_INVALID', status: 400 });
  }
  for (const changes of [{ version: 9 }, { created_at: 'today' }, { unknown: 'value' }, {}, null, []]) {
    await assert.rejects(updateVersioned(tx, { ...valid, changes }), { code: 'VERSION_FIELDS_INVALID', status: 400 });
  }
  await assert.rejects(updateVersioned(tx, { ...valid, table: 'erp.transaction_probe;DROP SCHEMA erp CASCADE' }),
    { code: 'VERSION_TARGET_INVALID', status: 400 });
  assert.throws(() => createVersionedUpdater({ 'public.users': ['value'] }), { code: 'ERP_VERSION_TARGET_INVALID' });
  assert.throws(() => createVersionedUpdater({ 'erp.anything': ['version'] }), { code: 'ERP_VERSION_TARGET_INVALID' });
});

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

  await t.test('business, audit, and receipt writes share one transaction and roll back together', async () => {
    await pool.query('CREATE TABLE erp.transaction_probe(id text PRIMARY KEY, value text NOT NULL, version bigint NOT NULL CHECK(version>0))');
    try {
      const insert = (tx, id) => tx.query('INSERT INTO erp.transaction_probe VALUES($1,$2,1)', [id, 'saved']);
      await assert.rejects(withBusinessTransaction(pool, async tx => {
        await insert(tx, 'business');
        await insert(tx, 'audit');
        await insert(tx, 'business');
      }), { code: '23505' });
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.transaction_probe')).rows[0].n, 0);
      const returned = await withBusinessTransaction(pool, async tx => {
        await insert(tx, 'business');
        const nested = async sameTx => (await sameTx.query('SELECT id FROM erp.transaction_probe')).rows;
        assert.deepEqual(await nested(tx), [{ id: 'business' }]);
        await insert(tx, 'audit');
        await insert(tx, 'receipt');
        return 'committed';
      });
      assert.equal(returned, 'committed');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM erp.transaction_probe')).rows[0].n, 3);
    } finally { await pool.query('DROP TABLE erp.transaction_probe'); }
  });

  await t.test('concurrent version updates choose one winner and audit failure rolls back its update', async () => {
    await pool.query('CREATE TABLE erp.transaction_probe(id text PRIMARY KEY, value text NOT NULL, version bigint NOT NULL CHECK(version>0))');
    const change = (tx, value, id = 'p1', expectedVersion = 1) => updateVersioned(tx, {
      table: 'erp.transaction_probe', id, expectedVersion, changes: { value },
    });
    try {
      await pool.query("INSERT INTO erp.transaction_probe VALUES('p1','original',1)");
      const results = await Promise.allSettled(['first', 'second'].map(value => withBusinessTransaction(pool, tx => change(tx, value))));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const conflict = results.find(result => result.status === 'rejected').reason;
      assert.equal(conflict.code, 'VERSION_CONFLICT');
      assert.equal(conflict.status, 409);
      const winner = (await pool.query("SELECT * FROM erp.transaction_probe WHERE id='p1'")).rows[0];
      assert.equal(winner.version, '2');
      await assert.rejects(withBusinessTransaction(pool, tx => change(tx, 'missing', 'absent')), { code: 'ENTITY_NOT_FOUND', status: 404 });
      await assert.rejects(withBusinessTransaction(pool, async tx => {
        await change(tx, 'should roll back', 'p1', 2);
        await tx.query("INSERT INTO erp.transaction_probe VALUES('p1','audit collision',1)");
      }), { code: '23505' });
      assert.deepEqual((await pool.query("SELECT * FROM erp.transaction_probe WHERE id='p1'")).rows[0], winner);
      const value = "'; DROP TABLE erp.transaction_probe; --";
      const updated = await withBusinessTransaction(pool, tx => change(tx, value, 'p1', '2'));
      assert.equal(updated.value, value);
      await pool.query("INSERT INTO erp.transaction_probe VALUES('large','before',9007199254740993)");
      const large = await withBusinessTransaction(pool, tx => change(tx, 'after', 'large', '9007199254740993'));
      assert.equal(large.version, '9007199254740994');
    } finally { await pool.query('DROP TABLE erp.transaction_probe'); }
  });
});
