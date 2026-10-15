'use strict';
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { inspectBusinessStorage } = require('../../business-db/storageMode');
const { withBusinessTransaction } = require('../../business-db/transaction');
const { createVersionedUpdater, versionString } = require('../../business-db/versioned');
const { lockUserWrites } = require('../../business-db/userGuard');
const { readBusinessWriteState } = require('../../business-db/maintenance');
const v = require('../catalog/validation');
const u = require('./validation');
const repo = require('./repository');
const update = createVersionedUpdater({ 'erp.users': ['password_hash', 'token_version', 'active'] }, { touchUpdatedAt: true });

function target(input, fields) {
  v.fields(input, fields, fields);
  if (typeof input.expectedServerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.expectedServerId)) {
    v.fail('请明确指定恢复服务器身份', 'OWNER_RECOVERY_ARGUMENTS_INVALID');
  }
  v.id(input.userId);
}
async function identity(tx, expectedServerId) {
  const row = (await tx.query("SELECT server_id,storage_mode FROM erp.installation WHERE id='default'")).rows[0];
  if (!row || row.server_id.toLowerCase() !== expectedServerId.toLowerCase()) v.fail('恢复目标服务器身份不一致', 'ERP_STORAGE_IDENTITY_MISMATCH', 409);
  if (row.storage_mode !== 'relational') v.fail('主机恢复仅适用于已启用的关系存储', 'OWNER_RECOVERY_REQUIRES_RELATIONAL', 409);
  return row.server_id;
}
function requireOwner(row) {
  if (!row) v.fail('用户不存在', 'ENTITY_NOT_FOUND', 404);
  if (row.role !== 'owner') v.fail('主机恢复只能处理已有 Owner 账号', 'OWNER_RECOVERY_OWNER_REQUIRED', 409);
}
function createHostOwnerRecovery(pool) {
  async function inspect(expectedServerId) {
    if ((await inspectBusinessStorage(pool, { expectedServerId })).mode !== 'relational') {
      v.fail('主机恢复仅适用于已启用的关系存储', 'OWNER_RECOVERY_REQUIRES_RELATIONAL', 409);
    }
  }
  return {
    async status(input) {
      target(input, ['expectedServerId', 'userId']);
      await inspect(input.expectedServerId);
      return withBusinessTransaction(pool, async tx => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const serverId = await identity(tx, input.expectedServerId);
        const row = (await tx.query(`SELECT ${repo.COLUMNS} FROM erp.users WHERE id=$1`, [input.userId])).rows[0];
        requireOwner(row);
        return { serverId, state: await readBusinessWriteState(tx), user: repo.publicUser(row) };
      });
    },
    async reset(input) {
      target(input, ['expectedServerId', 'userId', 'expectedVersion', 'reason', 'newPassword']);
      const version = versionString(input.expectedVersion);
      const reason = v.string(input.reason, { required: true, trim: true, max: 1000 });
      u.password(input.newPassword);
      await inspect(input.expectedServerId);
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      return withBusinessTransaction(pool, async tx => {
        // Same lock order as all user writes. Holding this lock also fences maintenance exit.
        await tx.query('SELECT pg_advisory_xact_lock_shared($1,$2)', [17042026, 3]);
        const serverId = await identity(tx, input.expectedServerId);
        if (await readBusinessWriteState(tx) !== 'maintenance') v.fail('请先从主机进入维护状态，再恢复 Owner', 'OWNER_RECOVERY_REQUIRES_MAINTENANCE', 409);
        await lockUserWrites(tx);
        const row = await repo.privateUser(tx, input.userId);
        requireOwner(row);
        if (row.version !== version) v.fail('账号已被修改，请重新读取版本', 'VERSION_CONFLICT', 409);
        const tokenVersion = versionString(row.token_version);
        if (BigInt(tokenVersion) >= 9223372036854775806n) v.fail('账号会话版本已达上限，请先维护核对', 'OWNER_RECOVERY_VERSION_EXHAUSTED', 409);
        await update(tx, { table: 'erp.users', id: row.id, expectedVersion: version,
          changes: { password_hash: passwordHash, token_version: String(BigInt(tokenVersion) + 1n), active: true } });
        await tx.query("INSERT INTO erp.audit_logs(id,actor_id,entity,entity_id,action,diff) VALUES($1,NULL,'users',$2,'owner.recover',$3)",
          [randomUUID(), row.id, JSON.stringify({ source: 'host', serverId, reason, sessionsRevoked: true, reactivated: !row.active })]);
        return { serverId, user: await repo.get(tx, row.id), sessionsRevoked: true };
      });
    },
  };
}
module.exports = { createHostOwnerRecovery };
