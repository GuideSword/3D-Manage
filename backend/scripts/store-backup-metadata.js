'use strict';

// Read the source store without running application migrations or creating data.
const { Client } = require('pg');
const { CURRENT_SCHEMA_VERSION } = require('../config/runtime');

async function main() {
  const table = process.env.STORE_TABLE || 'app_store';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error('Invalid STORE_TABLE');
  const connection = new URL(process.env.DATABASE_URL);
  const database = process.argv.slice(2).find((arg) => arg !== '--allow-empty');
  const allowEmpty = process.argv.includes('--allow-empty');
  if (database) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(database)) throw new Error('Invalid database name');
    connection.pathname = '/' + database;
  }
  const client = new Client({ connectionString: connection.toString() });
  await client.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const exists = await client.query('SELECT to_regclass($1) AS name', [table]);
    if (!exists.rows[0].name && allowEmpty) {
      const tables = await client.query("SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') LIMIT 1");
      if (tables.rows.length) throw new Error('Configured store missing from a nonempty target database');
      console.log(JSON.stringify({ serverId: null }));
      await client.query('COMMIT'); return;
    }
    const { rows } = await client.query(`SELECT data FROM "${table}" WHERE id = $1`, [process.env.STORE_ID || 'default']);
    if (rows.length === 0 && allowEmpty) {
      const populated = await client.query(`SELECT 1 FROM "${table}" LIMIT 1`);
      if (populated.rows.length) throw new Error('Target store identity is ambiguous');
      const otherTables = await client.query("SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') AND NOT (schemaname = 'public' AND tablename = $1) LIMIT 1", [table]);
      if (otherTables.rows.length) throw new Error('Target database contains unrelated tables');
      console.log(JSON.stringify({ serverId: null }));
      await client.query('COMMIT'); return;
    }
    if (rows.length !== 1) throw new Error('Business store missing');
    const data = rows[0].data;
    const version = data.schemaVersion == null ? 1 : data.schemaVersion;
    if (!Number.isInteger(version) || version < 1 || version > CURRENT_SCHEMA_VERSION) throw new Error('Unsupported source schema');
    if (!data.system?.serverId) throw new Error('Business store serverId missing');
    const collectionCounts = Object.fromEntries(Object.entries(data).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]));
    await client.query('COMMIT');
    console.log(JSON.stringify({ serverId: data.system.serverId, storeSchemaVersion: version, collectionCounts }));
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
