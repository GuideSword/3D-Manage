'use strict';

function fail(code, message, status = 400) {
  throw Object.assign(new Error(message), { code, status });
}

function versionString(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^[1-9]\d{0,18}$/.test(text) || BigInt(text) >= 9223372036854775807n) {
    fail('VERSION_INVALID', '请提供有效的记录版本');
  }
  return text;
}

/** Configure trusted tables in domain code, never from an HTTP request. */
function createVersionedUpdater(targets) {
  const registry = new Map();
  const reserved = new Set(['id', 'version', 'created_at', 'created_by', 'updated_at']);
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
    fail('ERP_VERSION_TARGET_INVALID', '版本更新需要预先声明目标表与字段');
  }
  for (const [table, columns] of Object.entries(targets)) {
    if (!/^erp\.[a-z][a-z0-9_]*$/.test(table) || !Array.isArray(columns) || !columns.length
        || columns.some(column => typeof column !== 'string' || !/^[a-z][a-z0-9_]*$/.test(column) || reserved.has(column))) {
      fail('ERP_VERSION_TARGET_INVALID', '版本更新目标表或字段无效');
    }
    registry.set(table, { sql: table.split('.').map(part => `"${part}"`).join('.'), columns: new Set(columns) });
  }
  return async function updateVersioned(tx, { table, id, expectedVersion, changes }) {
    const target = registry.get(table);
    if (!target) fail('VERSION_TARGET_INVALID', '不允许更新该数据表');
    const version = versionString(expectedVersion);
    if (typeof id !== 'string' || !id.trim()) fail('ENTITY_ID_INVALID', '记录标识无效');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      fail('VERSION_FIELDS_INVALID', '修改字段无效');
    }
    const columns = Object.keys(changes);
    if (!columns.length || columns.some(column => !target.columns.has(column))) {
      fail('VERSION_FIELDS_INVALID', '修改字段未被允许');
    }
    const assignments = columns.map((column, index) => `"${column}"=$${index + 2}`);
    const values = [id, ...columns.map(column => changes[column]), version];
    const { rows } = await tx.query(`UPDATE ${target.sql} SET ${assignments.join(', ')}, "version"="version"+1
      WHERE "id"=$1 AND "version"=$${values.length} RETURNING *`, values);
    if (rows.length) return rows[0];
    const existing = await tx.query(`SELECT 1 FROM ${target.sql} WHERE "id"=$1`, [id]);
    if (!existing.rows.length) fail('ENTITY_NOT_FOUND', '记录不存在', 404);
    fail('VERSION_CONFLICT', '记录已被其他人修改，请重新加载后再保存', 409);
  };
}

module.exports = { createVersionedUpdater };
