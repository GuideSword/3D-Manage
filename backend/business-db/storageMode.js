'use strict';
const path = require('node:path');
const { loadMigrations, assertMigrationHistory } = require('./migrator');
const { withBusinessTransaction } = require('./transaction');
const { assertBusinessDatabaseVersion } = require('./connection');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// Discovery must never initialize either store or repair a partial migration.
async function inspectBusinessStorage(pool, { expectedServerId, migrationsDirectory } = {}) {
  const migrations = await loadMigrations(migrationsDirectory || path.join(__dirname, 'migrations'));
  return withBusinessTransaction(pool, async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await assertBusinessDatabaseVersion(tx);
    const schema = (await tx.query("SELECT to_regnamespace('erp') AS name")).rows[0].name;
    if (!schema) return { mode: 'legacy', schemaVersion: 0, installation: null };
    const tables = (await tx.query("SELECT to_regclass('erp.schema_migrations') AS history_table, to_regclass('erp.installation') AS installation_table")).rows[0];
    if (!tables.history_table || !tables.installation_table) fail('ERP_STORAGE_INCOMPLETE', '关系数据结构不完整，请先完成维护核对');
    const history = (await tx.query('SELECT version,filename,sha256 FROM erp.schema_migrations ORDER BY version')).rows;
    const schemaVersion = assertMigrationHistory(history, migrations, { requireCurrent: true });
    const rows = (await tx.query('SELECT id,server_id,organization_name,initialized_at,storage_mode FROM erp.installation')).rows;
    if (rows.length !== 1 || rows[0].id !== 'default') fail('ERP_STORAGE_INCOMPLETE', '缺少唯一安装记录，请先完成维护核对');
    const row = rows[0];
    if (!['legacy', 'relational'].includes(row.storage_mode)) fail('ERP_STORAGE_MODE_INVALID', '无法识别业务存储模式，拒绝启动');
    if (typeof row.server_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.server_id)
      || typeof row.organization_name !== 'string' || !(row.initialized_at instanceof Date) || !Number.isFinite(row.initialized_at.getTime())) {
      fail('ERP_STORAGE_INCOMPLETE', '安装记录无效，请先完成维护核对');
    }
    if (expectedServerId !== undefined && (typeof expectedServerId !== 'string' || expectedServerId.toLowerCase() !== row.server_id.toLowerCase())) {
      fail('ERP_STORAGE_IDENTITY_MISMATCH', '关系数据库与当前服务器身份不一致，拒绝切换');
    }
    return { mode: row.storage_mode, schemaVersion,
      installation: { serverId: row.server_id, organizationName: row.organization_name, initializedAt: row.initialized_at.toISOString() } };
  });
}
module.exports = { inspectBusinessStorage };
