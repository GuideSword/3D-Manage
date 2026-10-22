'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('../../backend/node_modules/pg');
const { readPostgresSource, withReadOnlySourceClient } = require('../../backend/business-db/preflight/source');
const connectionString = process.env.ERP_BUSINESS_TEST_DATABASE_URL;

test('PostgreSQL source reader requires an explicit connection and safe identifiers', async () => {
  await assert.rejects(readPostgresSource({}), { code: 'PREFLIGHT_CONNECTION_INVALID' });
  await assert.rejects(readPostgresSource({ table: 'source; DROP TABLE users' }), { code: 'PREFLIGHT_SOURCE_CONFIG_INVALID' });
});

test('actual PostgreSQL source extraction is exact and enforced read-only', { skip: !connectionString }, async () => {
  assert.equal(new URL(connectionString).pathname, '/erp_02a_verify');
  const client = new Client({ connectionString });
  let created = false;
  await client.connect();
  try {
    assert.equal((await client.query("SELECT to_regclass('public.erp_preflight_source') AS name")).rows[0].name, null);
    await client.query('CREATE TABLE public.erp_preflight_source(id text PRIMARY KEY,data jsonb NOT NULL)');
    created = true;
    const raw = '{"total":9007199254740993.01,"zero":0.30000000000000004}';
    await client.query('INSERT INTO public.erp_preflight_source VALUES($1,$2::jsonb)', ['fixture', raw]);
    const before = (await client.query('SELECT data::text AS raw FROM public.erp_preflight_source')).rows[0].raw;
    const source = await readPostgresSource({ connectionString, table: 'erp_preflight_source', storeId: 'fixture' });
    assert.equal(source.raw, before);
    assert.equal(source.data.total, '9007199254740993.01');
    assert.equal(source.data.zero, '0.30000000000000004');
    await assert.rejects(withReadOnlySourceClient({ connectionString }, async tx => {
      assert.equal((await tx.query('SHOW transaction_read_only')).rows[0].transaction_read_only, 'on');
      assert.equal((await tx.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'repeatable read');
      await tx.query("UPDATE public.erp_preflight_source SET data='{}'::jsonb");
    }), { code: '25006' });
    assert.equal((await client.query('SELECT data::text AS raw FROM public.erp_preflight_source')).rows[0].raw, before);
    await assert.rejects(readPostgresSource({ connectionString, table: 'erp_preflight_source', storeId: 'absent' }), { code: 'PREFLIGHT_SOURCE_MISSING' });
  } finally {
    if (created) await client.query('DROP TABLE public.erp_preflight_source');
    await client.end();
  }
});
