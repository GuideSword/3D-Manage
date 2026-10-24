'use strict';
const { randomUUID } = require('node:crypto');
const { withBusinessTransaction } = require('./transaction');
const { inspectBusinessStorage } = require('./storageMode');
const { versionString, createVersionedUpdater } = require('./versioned');
const MAINTENANCE_LOCK = Object.freeze([17042026, 3]);
const fail = (code, message, status = 503) => { throw Object.assign(new Error(message), { code, status }); };
const invalidState = () => fail('MAINTENANCE_STATE_INVALID', '服务器维护状态不可用，请稍后重试');

async function controlRow(tx) {
  let row;
  try { row = (await tx.query("SELECT id,state,reason,version,updated_at FROM erp.runtime_control WHERE id='default'")).rows[0]; }
  catch (error) { if (error.code === '42P01') invalidState(); throw error; }
  if (!row || !['open', 'maintenance'].includes(row.state)) invalidState();
  return row;
}
async function assertBusinessWritesAllowed(tx) {
  await tx.query('SELECT pg_advisory_xact_lock_shared($1,$2)', MAINTENANCE_LOCK);
  const row = await controlRow(tx);
  if (row.state === 'maintenance') fail('BUSINESS_MAINTENANCE', '服务器正在维护，暂时不能保存修改');
}
const readBusinessWriteState = async tx => (await controlRow(tx)).state;
const argumentsInvalid = () => fail('MAINTENANCE_ARGUMENTS_INVALID', '请明确指定维护目标、状态、版本和原因', 400);
function validateTarget(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))
    || typeof input.expectedServerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.expectedServerId)) argumentsInvalid();
}
async function readStatus(tx, expectedServerId) {
  const installation = (await tx.query("SELECT server_id,storage_mode FROM erp.installation WHERE id='default'")).rows[0];
  if (!installation || installation.server_id.toLowerCase() !== expectedServerId.toLowerCase()) fail('ERP_STORAGE_IDENTITY_MISMATCH', '关系数据库与预期服务器身份不一致', 409);
  if (installation.storage_mode !== 'relational') fail('MAINTENANCE_REQUIRES_RELATIONAL', '当前服务器尚未启用关系模式，请使用停机备份流程');
  const row = await controlRow(tx);
  if (!(row.updated_at instanceof Date) || !Number.isFinite(row.updated_at.getTime()) || typeof row.reason !== 'string') invalidState();
  return { serverId: installation.server_id, state: row.state, reason: row.reason, version: row.version, updatedAt: row.updated_at.toISOString() };
}
function createMaintenanceService(pool) {
  const update = createVersionedUpdater({ 'erp.runtime_control': ['state', 'reason'] }, { touchUpdatedAt: true });
  const inspect = async expectedServerId => {
    const state = await inspectBusinessStorage(pool, { expectedServerId });
    if (state.mode !== 'relational') fail('MAINTENANCE_REQUIRES_RELATIONAL', '当前服务器尚未启用关系模式，请使用停机备份流程');
  };
  return {
    async status(input) {
      validateTarget(input, ['expectedServerId']);
      const { expectedServerId } = input;
      await inspect(expectedServerId);
      return withBusinessTransaction(pool, async tx => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        return readStatus(tx, expectedServerId);
      });
    },
    async setState(input) {
      validateTarget(input, ['expectedServerId', 'expectedVersion', 'state', 'reason']);
      if (!['open', 'maintenance'].includes(input.state) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 1000) argumentsInvalid();
      const { expectedServerId, state } = input;
      const expectedVersion = versionString(input.expectedVersion), reason = input.reason.trim();
      await inspect(expectedServerId);
      return withBusinessTransaction(pool, async tx => {
        await tx.query('SELECT pg_advisory_xact_lock($1,$2)', MAINTENANCE_LOCK);
        const before = await readStatus(tx, expectedServerId);
        if (before.version !== expectedVersion) fail('VERSION_CONFLICT', '维护状态已变化，请重新读取后再操作', 409);
        if (before.state === state) return before;
        await update(tx, { table: 'erp.runtime_control', id: 'default', expectedVersion, changes: { state, reason } });
        await tx.query("INSERT INTO erp.audit_logs(id,actor_id,entity,entity_id,action,diff) VALUES($1,NULL,'system',$2,$3,$4)",
          [randomUUID(), expectedServerId, state === 'maintenance' ? 'maintenance.enter' : 'maintenance.leave',
            JSON.stringify({ source: 'host', from: before.state, to: state, reason })]);
        return readStatus(tx, expectedServerId);
      });
    },
  };
}
module.exports = { assertBusinessWritesAllowed, readBusinessWriteState, createMaintenanceService };
