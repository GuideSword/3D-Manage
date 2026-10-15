'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { withBusinessTransaction } = require('./transaction');
const { lockUserWrites } = require('./userGuard');

function businessError(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function fail(code, message, status) { throw businessError(code, message, status); }
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function canonical(value, ancestors = new Set(), depth = 0) {
  if (depth > 64) fail('COMMAND_JSON_INVALID', '操作内容嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)
      || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
    fail('COMMAND_JSON_INVALID', '操作内容必须是有效 JSON，精确大数请使用字符串');
  }
  ancestors.add(value);
  let result;
  if (Array.isArray(value)) {
    result = Array.from({ length: value.length }, (_, i) => canonical(value[i], ancestors, depth + 1));
  } else {
    result = Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], ancestors, depth + 1)]));
  }
  ancestors.delete(value);
  return result;
}

function translateDatabaseError(error) {
  if (error.code === '23514' && error.constraint === 'users_last_owner') {
    return Object.assign(businessError('LAST_OWNER_PROTECTED', '至少需要保留一个有效 Owner', 409), { cause: error });
  }
  const mapping = {
    '23503': ['ENTITY_REFERENCED', '记录存在引用或关联记录已变化，请刷新后重试', 409],
    '23505': ['ENTITY_CONFLICT', '编号或记录已存在，请核对后重试', 409],
    '23514': ['BUSINESS_DATA_INVALID', '业务数据不符合约束，请检查填写内容', 400],
    '23502': ['BUSINESS_DATA_INVALID', '缺少必需的业务数据', 400],
    '22003': ['BUSINESS_DATA_INVALID', '数值超出允许范围', 400],
    '22P02': ['BUSINESS_DATA_INVALID', '业务数据格式无效', 400],
    '40001': ['CONCURRENT_MODIFICATION', '记录正在被修改，请重新加载后再提交', 409],
    '40P01': ['CONCURRENT_MODIFICATION', '记录正在被修改，请重新加载后再提交', 409],
  };
  const info = mapping[error.code];
  if (!info) return error;
  return Object.assign(businessError(...info), { cause: error });
}

/** Register trusted domain handlers at server startup, never from request input.
 * Handlers must await audit calls and restrict effects to the provided transaction.
 */
function createCommandEngine(pool, definitions, accountOnly = false) {
  const invalid = () => fail('ERP_COMMAND_REGISTRY_INVALID', '业务命令必须由服务器预先注册');
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions) || !Object.keys(definitions).length) invalid();
  const registry = new Map();
  for (const [operation, descriptor] of Object.entries(definitions)) {
    if (!/^[a-z][A-Za-z0-9_.-]{0,127}$/.test(operation) || !descriptor || !Array.isArray(descriptor.roles)
        || !descriptor.roles.length || descriptor.roles.some(role => !(accountOnly ? ['owner', 'staff', 'viewer'] : ['owner', 'staff']).includes(role))
        || typeof descriptor.handle !== 'function' || (descriptor.authorize !== undefined && typeof descriptor.authorize !== 'function')
        || (descriptor.lockUsers !== undefined && typeof descriptor.lockUsers !== 'boolean')
        || (descriptor.prepare !== undefined && typeof descriptor.prepare !== 'function')
        || (descriptor.payloadDigest !== undefined && typeof descriptor.payloadDigest !== 'function')) invalid();
    const scope = descriptor.scope ?? (accountOnly ? 'account' : 'business');
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(scope)) invalid();
    if (accountOnly && (!operation.startsWith('account.') || scope !== 'account' || descriptor.lockUsers !== true || !descriptor.payloadDigest)) invalid();
    registry.set(operation, { roles: new Set(descriptor.roles), handle: descriptor.handle, authorize: descriptor.authorize, scope,
      lockUsers: descriptor.lockUsers === true, payloadDigest: descriptor.payloadDigest, prepare: descriptor.prepare });
  }

  return async function execute({ operation, actorId, tokenVersion, key, payload } = {}) {
    const definition = registry.get(operation);
    if (!definition) fail('COMMAND_UNKNOWN', '不支持的业务操作');
    if (!nonempty(actorId) || !['string', 'number'].includes(typeof tokenVersion)
        || (typeof tokenVersion === 'number' && !Number.isSafeInteger(tokenVersion))
        || !/^[1-9]\d{0,18}$/.test(String(tokenVersion))) fail('AUTHENTICATION_REQUIRED', '登录凭证已失效，请重新登录', 401);
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
      fail('IDEMPOTENCY_KEY_REQUIRED', '请提供有效的操作标识，并使用同一标识重试');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('COMMAND_JSON_INVALID', '操作内容必须是 JSON 对象');
    // Clone before awaiting anything; caller mutations cannot alter the signed command.
    const normalizedPayload = canonical(payload);
    const envelope = canonical({ operation, payload: normalizedPayload });
    const digest = definition.payloadDigest ? definition.payloadDigest(envelope) : createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) fail('ERP_COMMAND_DIGEST_INVALID', '操作摘要配置无效', 500);
    try {
      return await withBusinessTransaction(pool, async tx => {
        // Serialize a key before locking its actor, so same-key account updates
        // cannot deadlock with a replay waiting while holding FOR SHARE.
        const identity = JSON.stringify([definition.scope, actorId, key]);
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [identity]);
        const authenticateActor = async lock => {
          const row = (await tx.query(`SELECT id,name,role,active,token_version FROM erp.users WHERE id=$1${lock ? ' FOR SHARE' : ''}`, [actorId])).rows[0];
          if (!row || !row.active || row.token_version !== String(tokenVersion)) fail('AUTHENTICATION_REQUIRED', '登录凭证已失效，请重新登录', 401);
          const actor = Object.freeze({ id: row.id, name: row.name, role: row.role, tokenVersion: row.token_version });
          if (!definition.roles.has(actor.role) || (definition.authorize && !await definition.authorize(actor, normalizedPayload))) {
            fail('BUSINESS_FORBIDDEN', '当前账号无权执行该业务操作', 403);
          }
          return actor;
        };
        let prepared;
        if (definition.prepare) {
          const candidate = await authenticateActor(false);
          const prior = await tx.query('SELECT 1 FROM erp.command_receipts WHERE scope=$1 AND actor_id=$2 AND key=$3', [definition.scope, actorId, key]);
          if (!prior.rows.length) prepared = await definition.prepare(tx, { actor: candidate, payload: normalizedPayload });
        }
        // Expensive read-only preparation holds no user row/guard lock. Always
        // revalidate current identity after serializing user writes.
        if (definition.lockUsers) await lockUserWrites(tx);
        const actor = await authenticateActor(true);
        const previous = (await tx.query('SELECT payload_hash,result FROM erp.command_receipts WHERE scope=$1 AND actor_id=$2 AND key=$3',
          [definition.scope, actorId, key])).rows[0];
        if (previous) {
          if (previous.payload_hash !== digest) fail('IDEMPOTENCY_CONFLICT', '操作标识已用于不同内容，请核对原操作', 409);
          return previous.result;
        }
        let auditCount = 0;
        const audit = async ({ entity, entityId, action, diff } = {}) => {
          if (!nonempty(entity) || !nonempty(action) || (entityId != null && typeof entityId !== 'string')) {
            fail('ERP_COMMAND_AUDIT_INVALID', '业务审计内容无效', 500);
          }
          const normalizedDiff = canonical(diff ?? null);
          await tx.query('INSERT INTO erp.audit_logs(id,actor_id,entity,entity_id,action,diff) VALUES($1,$2,$3,$4,$5,$6)',
            [randomUUID(), actor.id, entity, entityId ?? '', action, JSON.stringify(normalizedDiff)]);
          auditCount += 1;
        };
        const result = await definition.handle(tx, { actor, payload: normalizedPayload, audit, prepared });
        if (!auditCount) fail('ERP_COMMAND_AUDIT_REQUIRED', '业务操作缺少审计，修改已撤销', 500);
        if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status > 299
            || !Object.hasOwn(result, 'body')) fail('ERP_COMMAND_RESULT_INVALID', '业务操作结果无效，修改已撤销', 500);
        const normalizedResult = canonical({ status: result.status, body: result.body });
        await tx.query('INSERT INTO erp.command_receipts(id,scope,actor_id,key,payload_hash,status_code,result) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [randomUUID(), definition.scope, actorId, key, digest, normalizedResult.status, JSON.stringify(normalizedResult)]);
        return normalizedResult;
      });
    } catch (error) { throw translateDatabaseError(error); }
  };
}

const createBusinessCommands = (pool, definitions) => createCommandEngine(pool, definitions);
const createAccountCommands = (pool, definitions) => createCommandEngine(pool, definitions, true);
module.exports = { createBusinessCommands, createAccountCommands };
