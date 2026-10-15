'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes, randomUUID } = require('node:crypto');
const { withBusinessTransaction } = require('../../business-db/transaction');
const { lockUserWrites } = require('../../business-db/userGuard');
const { TOKEN_AUDIENCE } = require('../../utils/authTokens');
const v = require('../catalog/validation');
const { credentialKey } = require('./validation');
const repo = require('./repository');
const invalid = () => v.fail('账号或密码错误', 'AUTHENTICATION_FAILED', 401);
const issuer = serverId => `3d-manage:${serverId}`;
function createUserAuthentication(pool, { jwtSecret, expiresIn = '7d' } = {}) {
  credentialKey(jwtSecret);
  if (!(Number.isSafeInteger(expiresIn) && expiresIn > 0) && !(typeof expiresIn === 'string' && /^[1-9]\d{0,7}[smhd]$/.test(expiresIn))) {
    v.fail('登录有效期配置无效', 'AUTH_CONFIGURATION_INVALID', 500);
  }
  let dummyHash;
  const getDummy = () => dummyHash ||= bcrypt.hash(randomBytes(32).toString('hex'), 12);
  async function installation(tx) { return (await tx.query("SELECT server_id,initialized_at FROM erp.installation WHERE id='default'")).rows[0]; }
  return {
    async login(input) {
      if (!input || typeof input.email !== 'string' || input.email.length > 320 || typeof input.password !== 'string'
          || !input.password || Buffer.byteLength(input.password, 'utf8') > 72) invalid();
      const email = input.email.trim().toLowerCase();
      const password = input.password;
      const initial = await installation(pool);
      if (!initial?.initialized_at) v.fail('系统尚未初始化', 'SYSTEM_NOT_INITIALIZED', 409);
      const candidate = (await pool.query('SELECT id,password_hash FROM erp.users WHERE lower(email)=$1', [email])).rows[0];
      const validHash = candidate && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(candidate.password_hash);
      const hash = validHash ? candidate.password_hash : await getDummy();
      const matches = await bcrypt.compare(password, hash);
      if (!validHash || !matches) invalid();
      return withBusinessTransaction(pool, async tx => {
        await lockUserWrites(tx);
        const system = await installation(tx);
        if (!system?.initialized_at || system.server_id !== initial.server_id) v.fail('系统身份已变化，请重新连接', 'SERVER_ID_CHANGED', 409);
        let row;
        try { row = await repo.privateUser(tx, candidate.id); }
        catch (error) { if (error.code === 'ENTITY_NOT_FOUND') invalid(); throw error; }
        if (!row.active || row.password_hash !== candidate.password_hash) invalid();
        const token = jwt.sign({ sub: row.id, email: row.email, role: row.role, ver: row.token_version }, jwtSecret,
          { algorithm: 'HS256', audience: TOKEN_AUDIENCE, issuer: issuer(system.server_id), expiresIn });
        await tx.query('UPDATE erp.users SET last_login_at=clock_timestamp() WHERE id=$1', [row.id]);
        await tx.query("INSERT INTO erp.audit_logs(id,actor_id,entity,entity_id,action,diff) VALUES($1,$2,'users',$2,'login',$3)",
          [randomUUID(), row.id, JSON.stringify({ email: row.email })]);
        return { token, user: await repo.get(tx, row.id) };
      });
    },
    async authenticate(token) {
      if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) return null;
      return withBusinessTransaction(pool, async tx => {
        await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const system = await installation(tx);
        if (!system?.initialized_at) return null;
        let payload;
        try { payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'], audience: TOKEN_AUDIENCE, issuer: issuer(system.server_id) }); }
        catch (error) { if (['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error.name)) return null; throw error; }
        if (typeof payload.sub !== 'string' || !payload.sub || !['string', 'number'].includes(typeof payload.ver)
            || (typeof payload.ver === 'number' && !Number.isSafeInteger(payload.ver)) || !/^[1-9]\d{0,18}$/.test(String(payload.ver))) return null;
        const row = (await tx.query(`SELECT ${repo.COLUMNS},token_version FROM erp.users WHERE id=$1`, [payload.sub])).rows[0];
        if (!row || !row.active || row.token_version !== String(payload.ver)) return null;
        return { actorId: row.id, tokenVersion: row.token_version, user: repo.publicUser(row) };
      });
    },
  };
}
module.exports = { createUserAuthentication };
