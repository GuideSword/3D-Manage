'use strict';
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { createBusinessCommands, createAccountCommands } = require('../../business-db/commands');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { createVersionedUpdater, createVersionedDeleter } = require('../../business-db/versioned');
const v = require('../catalog/validation');
const u = require('./validation');
const repo = require('./repository');
const update = createVersionedUpdater({ 'erp.users': ['name', 'role', 'active', 'password_hash', 'token_version'] }, { touchUpdatedAt: true });
const remove = createVersionedDeleter(['erp.users']);
const nextTokenVersion = row => String(BigInt(row.token_version) + 1n);
function createInput(payload) {
  v.fields(payload, ['name', 'email', 'role', 'password'], ['name', 'email', 'role', 'password']);
  return { name: u.name(payload.name), email: u.email(payload.email), role: u.role(payload.role), password: u.password(payload.password) };
}
async function ownerRemains(tx) {
  if (!(await tx.query("SELECT 1 FROM erp.users WHERE role='owner' AND active LIMIT 1")).rows.length) v.fail('至少需要保留一个有效 Owner', 'LAST_OWNER_PROTECTED', 409);
}
function createUserService(pool, { jwtSecret } = {}) {
  const payloadDigest = u.credentialDigest(u.credentialKey(jwtSecret));
  const protect = definition => ({ roles: ['owner'], lockUsers: true, payloadDigest, ...definition });
  const definitions = {
    'user.create': protect({ async prepare(tx, { payload }) {
      const input = createInput(payload);
      return { passwordHash: await bcrypt.hash(input.password, 12) };
    }, async handle(tx, { payload, prepared, audit }) {
      const input = createInput(payload);
      const id = randomUUID();
      await tx.query('INSERT INTO erp.users(id,name,email,role,password_hash) VALUES($1,$2,$3,$4,$5)', [id, input.name, input.email, input.role, prepared.passwordHash]);
      const item = await repo.get(tx, id);
      await audit({ entity: 'users', entityId: id, action: 'create', diff: item });
      return { status: 201, body: item };
    } }),
    'user.update': protect({ async handle(tx, { payload, audit }) {
      v.fields(payload, ['id', 'version', 'changes'], ['id', 'version', 'changes']);
      v.fields(payload.changes, ['name', 'role', 'active']);
      if (!Object.keys(payload.changes).length) v.fail('至少填写一个修改字段');
      const row = await repo.privateUser(tx, payload.id);
      const changes = {};
      if (Object.hasOwn(payload.changes, 'name')) changes.name = u.name(payload.changes.name);
      if (Object.hasOwn(payload.changes, 'role')) changes.role = u.role(payload.changes.role);
      if (Object.hasOwn(payload.changes, 'active')) changes.active = v.boolean(payload.changes.active);
      if ((changes.role !== undefined && changes.role !== row.role) || (changes.active !== undefined && changes.active !== row.active)) changes.token_version = nextTokenVersion(row);
      await update(tx, { table: 'erp.users', id: payload.id, expectedVersion: payload.version, changes });
      await ownerRemains(tx);
      const item = await repo.get(tx, payload.id);
      await audit({ entity: 'users', entityId: item.id, action: 'update', diff: { before: repo.publicUser(row), after: item } });
      return { status: 200, body: item };
    } }),
    'user.delete': protect({ async handle(tx, { payload, actor, audit }) {
      v.fields(payload, ['id', 'version'], ['id', 'version']);
      let before;
      await remove(tx, { table: 'erp.users', id: payload.id, expectedVersion: payload.version, beforeDelete: async (client, row) => {
        if (row.role === 'owner' && row.active && (await client.query("SELECT count(*)::int AS n FROM erp.users WHERE role='owner' AND active")).rows[0].n <= 1) {
          v.fail('至少需要保留一个有效 Owner', 'LAST_OWNER_PROTECTED', 409);
        }
        if (row.id === actor.id) v.fail('不能删除当前登录账号', 'CURRENT_USER_PROTECTED', 409);
        if (row.last_login_at !== null || Object.keys(row.legacy_payload || {}).length) {
          v.fail('账号已有登录或迁移历史，请停用而非删除', 'ENTITY_REFERENCED', 409);
        }
        before = repo.publicUser(row);
      } });
      await audit({ entity: 'users', entityId: payload.id, action: 'delete', diff: { before } });
      return { status: 200, body: { success: true } };
    } }),
    'user.resetPassword': protect({ async prepare(tx, { payload }) {
      v.fields(payload, ['id', 'version', 'password'], ['id', 'version', 'password']);
      u.password(payload.password);
      const target = (await tx.query('SELECT role FROM erp.users WHERE id=$1', [v.id(payload.id)])).rows[0];
      if (!target) v.fail('用户不存在', 'ENTITY_NOT_FOUND', 404);
      if (target.role === 'owner') v.fail('Owner 请使用本人改密或主机恢复', 'OWNER_MANAGED_SEPARATELY', 409);
      return { passwordHash: await bcrypt.hash(payload.password, 12) };
    }, async handle(tx, { payload, prepared, audit }) {
      const row = await repo.privateUser(tx, payload.id);
      if (row.role === 'owner') v.fail('Owner 请使用本人改密或主机恢复', 'OWNER_MANAGED_SEPARATELY', 409);
      await update(tx, { table: 'erp.users', id: row.id, expectedVersion: payload.version, changes: { password_hash: prepared.passwordHash, token_version: nextTokenVersion(row) } });
      const item = await repo.get(tx, row.id);
      await audit({ entity: 'users', entityId: row.id, action: 'password.reset', diff: { sessionsRevoked: true } });
      return { status: 200, body: { success: true, user: item } };
    } }),
  };
  const execute = createBusinessCommands(pool, definitions);
  const ownPassword = createAccountCommands(pool, { 'account.changePassword': { roles: ['owner', 'staff', 'viewer'], lockUsers: true, payloadDigest,
    async prepare(tx, { payload, actor }) {
      v.fields(payload, ['version', 'currentPassword', 'newPassword'], ['version', 'currentPassword', 'newPassword']);
      const current = v.string(payload.currentPassword, { required: true, max: 72 });
      if (Buffer.byteLength(current, 'utf8') > 72) v.fail('当前密码错误', 'CURRENT_PASSWORD_INVALID', 403);
      u.password(payload.newPassword);
      const row = (await tx.query('SELECT password_hash FROM erp.users WHERE id=$1', [actor.id])).rows[0];
      if (!row || !await bcrypt.compare(current, row.password_hash)) v.fail('当前密码错误', 'CURRENT_PASSWORD_INVALID', 403);
      return { expectedHash: row.password_hash, passwordHash: await bcrypt.hash(payload.newPassword, 12) };
    }, async handle(tx, { payload, actor, prepared, audit }) {
      const row = await repo.privateUser(tx, actor.id);
      if (row.password_hash !== prepared.expectedHash) v.fail('密码已被修改，请重新登录后再操作', 'CURRENT_PASSWORD_CHANGED', 409);
      await update(tx, { table: 'erp.users', id: actor.id, expectedVersion: payload.version, changes: { password_hash: prepared.passwordHash, token_version: nextTokenVersion(row) } });
      await audit({ entity: 'users', entityId: actor.id, action: 'password.change', diff: { sessionsRevoked: true } });
      return { status: 200, body: { success: true } };
    },
  } });
  return { execute, changeOwnPassword: request => ownPassword({ ...request, operation: 'account.changePassword' }),
    me: session => withAuthenticatedRead(pool, session, (tx, actor) => repo.get(tx, actor.id)),
    get: (session, id) => withAuthenticatedRead(pool, session, (tx, actor) => { if (actor.role !== 'owner') u.forbidden(); return repo.get(tx, id); }),
    list: (session, query = {}) => withAuthenticatedRead(pool, session, async (tx, actor) => {
      if (actor.role !== 'owner') u.forbidden();
      const { search, active, limit, offset } = v.page(query, ['role']);
      const role = query.role == null || query.role === 'all' ? null : u.role(query.role);
      const where = "($1::text='' OR position(lower($1) in lower(concat_ws(' ',name,email)))>0) AND ($2::boolean IS NULL OR active=$2) AND ($3::text IS NULL OR role=$3)";
      const params = [search, active, role];
      const total = (await tx.query(`SELECT count(*)::int AS n FROM erp.users WHERE ${where}`, params)).rows[0].n;
      const rows = (await tx.query(`SELECT ${repo.COLUMNS} FROM erp.users WHERE ${where} ORDER BY created_at,id LIMIT $4 OFFSET $5`, [...params, limit, offset])).rows;
      return { items: rows.map(repo.publicUser), total };
    }),
  };
}
module.exports = { createUserService };
