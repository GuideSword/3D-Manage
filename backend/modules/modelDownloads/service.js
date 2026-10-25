'use strict';
const { randomBytes, createHash } = require('node:crypto');
const bcrypt = require('bcryptjs');
const fail = (code, message, status = 403) => { throw Object.assign(new Error(message), { code, status }); };
const digest = value => createHash('sha256').update(value).digest('hex');
function fileKey(value) {
  if (typeof value !== 'string' || value.length > 1600 || !value || /[\\%?#\x00-\x1f]/.test(value)
      || value.startsWith('/') || value.split('/').some(x => !x || x === '.' || x === '..')) fail('FILE_KEY_INVALID', '无权访问该文件', 403);
  return value;
}
function fields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) fail('DOWNLOAD_INPUT_INVALID', '下载授权参数无效', 400);
}
const publicPolicy = policy => ({ enabled: policy.enabled, version: String(policy.version) });
const tokenHash = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? digest(value) : null;

// Repository transactions serialize policy changes, ticket redemption and grant validation.
// Errors that must retain failure counters are returned from the transaction, then thrown.
function createModelDownloadService(repository, { now = Date.now, grantMs = 300000, ticketMs = 60000 } = {}) {
  const run = async (fn, options) => {
    const result = await repository.transaction(fn, options);
    if (result?.failure) fail(...result.failure);
    return result;
  };
  async function actor(tx, session) {
    if (!session?.actorId || session.tokenVersion === undefined) fail('AUTHENTICATION_REQUIRED', '请重新登录', 401);
    const user = await tx.actor(session.actorId);
    if (!user?.active || String(user.tokenVersion) !== String(session.tokenVersion)) fail('AUTHENTICATION_REQUIRED', '登录状态已失效，请重新登录', 401);
    return user;
  }
  async function mint(tx, user, policy, resource, purpose, lifetime) {
    const token = randomBytes(32).toString('base64url');
    await tx.insertGrant({ hash: digest(token), actorId: user.id, tokenVersion: String(user.tokenVersion),
      policyVersion: String(policy.version), fileKey: resource?.key || null, purpose, expiresAt: now() + lifetime, consumed: false });
    return token;
  }
  async function validGrant(tx, token, purpose, key, user) {
    const hash = tokenHash(token), grant = hash && await tx.grant(hash), policy = await tx.policy();
    if (!grant || grant.purpose !== purpose || grant.consumed || grant.expiresAt <= now()
        || String(grant.policyVersion) !== String(policy.version) || (key && grant.fileKey !== key)
        || (user && (grant.actorId !== user.id || String(grant.tokenVersion) !== String(user.tokenVersion)))) {
      fail('MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED', '请重新验证模型下载密码', 403);
    }
    const current = await actor(tx, { actorId: grant.actorId, tokenVersion: grant.tokenVersion });
    return { grant, policy, current };
  }
  return {
    status: (session, key) => run(async tx => {
      await actor(tx, session); const policy = await tx.policy();
      if (key === undefined) return publicPolicy(policy);
      const resource = await tx.resource(fileKey(key));
      return { ...publicPolicy(policy), protected: !resource || resource.protected, requiresPassword: policy.enabled && (!resource || resource.protected) };
    }, { readOnly: true }),
    configure: (session, input) => run(async tx => {
      fields(input, ['enabled', 'version', 'password']);
      const user = await actor(tx, session);
      if (user.role !== 'owner') fail('BUSINESS_FORBIDDEN', '只有管理员可以设置下载保护');
      const policy = await tx.policy();
      if (String(input.version) !== String(policy.version)) fail('VERSION_CONFLICT', '下载保护设置已变化，请刷新后重试', 409);
      if (typeof input.enabled !== 'boolean') fail('DOWNLOAD_INPUT_INVALID', '请选择是否启用下载保护', 400);
      if (input.enabled && tx.assertCanEnable) await tx.assertCanEnable();
      let hash = policy.passwordHash;
      if (input.password !== undefined) {
        if (typeof input.password !== 'string' || input.password.length < 12 || Buffer.byteLength(input.password, 'utf8') > 72) fail('DOWNLOAD_PASSWORD_INVALID', '下载密码至少12个字符，最多72个UTF-8字节', 400);
        hash = await bcrypt.hash(input.password, 12);
      }
      if (input.enabled && !hash) fail('DOWNLOAD_PASSWORD_INVALID', '启用保护前请设置下载密码', 400);
      const next = { enabled: input.enabled, passwordHash: hash, version: String(BigInt(policy.version) + 1n) };
      await tx.savePolicy(next);
      await tx.audit(user.id, 'policy.update', { enabled: next.enabled, version: next.version });
      return publicPolicy(next);
    }),
    authorize: (session, input) => run(async tx => {
      fields(input, ['key', 'password', 'purpose', 'consent']);
      const user = await actor(tx, session);
      if (input.purpose === 'model-import') {
        if (input.consent !== true) fail('DOWNLOAD_CONSENT_REQUIRED', '请确认导入模型', 400);
        const policy = await tx.policy(); const token = await mint(tx, user, policy, null, 'model-import', 300000);
        return { token, expiresIn: 300 };
      }
      const key = fileKey(input.key);
      if (input.consent !== true || !['download', 'handoff'].includes(input.purpose)) fail('DOWNLOAD_CONSENT_REQUIRED', '请确认将模型数据拉取到当前设备', 400);
      const resource = await tx.resource(key), policy = await tx.policy();
      if (!resource) fail('FILE_NOT_FOUND', '文件不存在或尚未登记', 404);
      const attempts = await tx.attempts(user.id);
      if (attempts && attempts.until > now() && attempts.count >= 5) fail('RATE_LIMITED', '下载密码验证失败次数过多，请稍后重试', 429);
      if (policy.enabled && resource.protected && (typeof input.password !== 'string' || Buffer.byteLength(input.password, 'utf8') > 72 || !await bcrypt.compare(input.password, policy.passwordHash))) {
        await tx.saveAttempts(user.id, { count: attempts && attempts.until > now() ? attempts.count + 1 : 1, until: attempts && attempts.until > now() ? attempts.until : now() + 60000 });
        await tx.audit(user.id, 'authorization.denied', { key, reason: 'password' });
        return { failure: ['MODEL_DOWNLOAD_PASSWORD_INVALID', '模型下载密码错误', 403] };
      }
      await tx.saveAttempts(user.id, { count: 0, until: now() });
      await tx.prune(now());
      const token = await mint(tx, user, policy, resource, input.purpose, input.purpose === 'handoff' ? ticketMs : grantMs);
      await tx.audit(user.id, 'authorization.issued', { key, purpose: input.purpose, policyVersion: policy.version });
      return { token, expiresIn: input.purpose === 'handoff' ? ticketMs / 1000 : grantMs / 1000 };
    }),
    check: async (session, key, token) => {
      const disabled = await run(async tx => { await actor(tx, session); fileKey(key); return !(await tx.policy()).enabled; }, { readOnly: true });
      if (disabled) return true;
      return run(async tx => {
      const user = await actor(tx, session), normalized = fileKey(key), resource = await tx.resource(normalized), policy = await tx.policy();
      // Unknown objects are protected too; old unregistered paths cannot bypass the policy.
      if (policy.enabled && (!resource || resource.protected)) await validGrant(tx, token, 'download', normalized, user);
      if (policy.enabled && resource?.protected) await tx.audit(user.id, 'download.requested', { key: normalized });
      return true;
      });
    },
    redeem: ticket => run(async tx => {
      const { grant, current, policy } = await validGrant(tx, ticket, 'handoff');
      const resource = await tx.resource(grant.fileKey);
      if (!resource || !/^[a-f0-9]{64}$/.test(resource.sha256 || '') || !Number.isSafeInteger(resource.size) || resource.size < 1) fail('FILE_IDENTITY_UNAVAILABLE', '文件缺少完整校验信息，请先补全模型文件', 409);
      await tx.consumeGrant(grant.hash);
      const token = await mint(tx, current, policy, resource, 'transfer', grantMs);
      await tx.audit(current.id, 'handoff.redeemed', { key: grant.fileKey });
      return { token, file: { key: grant.fileKey, name: resource.name, size: resource.size, sha256: resource.sha256 }, expiresIn: grantMs / 1000 };
    }),
    redeemImport: ticket => run(async tx => {
      const { grant, current } = await validGrant(tx, ticket, 'model-import');
      await tx.consumeGrant(grant.hash);
      return { actorId: current.id, serverId: (await tx.policy()).version, purpose: 'model-import' };
    }),
    transfer: token => run(async tx => {
      const { grant, current } = await validGrant(tx, token, 'transfer');
      await tx.audit(current.id, 'handoff.read', { key: grant.fileKey });
      return { key: grant.fileKey, session: { actorId: current.id, tokenVersion: current.tokenVersion } };
    }),
  };
}
module.exports = { createModelDownloadService, fileKey };
