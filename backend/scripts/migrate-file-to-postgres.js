'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { migrateData } = require('../utils/store');

const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const source = valueOf('--source');
const dryRun = args.includes('--dry-run');
if (!source || !path.isAbsolute(source)) throw new Error('--source must be an absolute store.json path');

const raw = fs.readFileSync(source, 'utf8');
const { data } = migrateData(JSON.parse(raw));
const counts = Object.fromEntries(['users', 'orders', 'models', 'materials', 'stockLots', 'inventoryTxns', 'auditLogs', 'objectUploads']
  .map((key) => [key, data[key].length]));
const materialIds = new Set(data.materials.map((item) => String(item.id)));
const referenceErrors = data.stockLots
  .filter((lot) => !materialIds.has(String(lot.materialId || lot.material_id)))
  .map((lot) => `stock lot ${lot.id} references missing material`);
console.log(JSON.stringify({ schemaVersion: data.schemaVersion, serverId: data.system.serverId, counts, referenceErrors }, null, 2));
if (referenceErrors.length) throw new Error('Source contains reference errors');
if (dryRun) process.exit(0);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for migration');

const tableName = process.env.STORE_TABLE || 'app_store';
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) throw new Error('Invalid STORE_TABLE');
const storeId = process.env.STORE_ID || 'default';
const table = `"${tableName}"`;
const main = async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    const existing = await client.query(`SELECT id FROM ${table} LIMIT 1 FOR UPDATE`);
    if (existing.rowCount) throw new Error('Target PostgreSQL store is not empty; refusing to merge or overwrite');
    const backup = `${source}.pre-postgres-${Date.now()}.bak`;
    fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);
    await client.query(`INSERT INTO ${table} (id, data) VALUES ($1, $2::jsonb)`, [storeId, JSON.stringify(data)]);
    await client.query('COMMIT');
    console.log(`Migration complete; source backup: ${backup}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error) => { console.error(error); process.exitCode = 1; });
