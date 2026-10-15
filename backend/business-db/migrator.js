'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { assertBusinessDatabaseVersion } = require('./connection');

function migrationError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function loadMigrations(directory) {
  const filenames = (await fs.readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  if (!filenames.length) throw migrationError('ERP_MIGRATION_FILES_INVALID', '没有可用的 ERP 迁移文件');
  const migrations = [];
  for (const filename of filenames) {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(filename);
    const version = match ? Number(match[1]) : 0;
    if (version !== migrations.length + 1) {
      throw migrationError('ERP_MIGRATION_FILES_INVALID', 'ERP 迁移编号重复、不连续或文件名无效');
    }
    const bytes = await fs.readFile(path.join(directory, filename));
    migrations.push({ version, filename, sql: bytes.toString('utf8'),
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return migrations;
}

async function migrateBusinessDatabase(pool, { migrationsDirectory = path.join(__dirname, 'migrations') } = {}) {
  const migrations = await loadMigrations(migrationsDirectory);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertBusinessDatabaseVersion(client);
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [17042026, 2]);
    await client.query('CREATE SCHEMA IF NOT EXISTS erp');
    await client.query(`CREATE TABLE IF NOT EXISTS erp.schema_migrations (
      version integer PRIMARY KEY, filename text NOT NULL, sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT version, filename, sha256 FROM erp.schema_migrations ORDER BY version');
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const source = migrations[row.version - 1];
      if (!source) throw migrationError('ERP_MIGRATION_FUTURE', '数据库迁移版本高于当前程序，请先升级');
      if (row.version !== index + 1) throw migrationError('ERP_MIGRATION_HISTORY_INVALID', '数据库迁移登记不连续');
      if (row.filename !== source.filename || row.sha256 !== source.sha256) {
        throw migrationError('ERP_MIGRATION_CHANGED', '已执行的迁移文件被修改，拒绝继续迁移');
      }
    }
    const applied = [];
    for (const migration of migrations.slice(rows.length)) {
      await client.query(migration.sql);
      await client.query('INSERT INTO erp.schema_migrations(version,filename,sha256) VALUES($1,$2,$3)',
        [migration.version, migration.filename, migration.sha256]);
      applied.push(migration.version);
    }
    await client.query('COMMIT');
    return { applied, version: migrations.at(-1).version };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (rollbackError) { error.rollbackError = rollbackError; }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { loadMigrations, migrateBusinessDatabase };
