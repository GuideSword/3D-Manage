'use strict';
const { withBusinessTransaction } = require('./transaction');
const authError = () => Object.assign(new Error('登录凭证已失效，请重新登录'), { code: 'AUTHENTICATION_REQUIRED', status: 401 });

async function withAuthenticatedRead(pool, session, callback) {
  const { actorId, tokenVersion } = session || {};
  if (typeof actorId !== 'string' || !actorId.trim() || !['string', 'number'].includes(typeof tokenVersion)
      || (typeof tokenVersion === 'number' && !Number.isSafeInteger(tokenVersion))
      || !/^[1-9]\d{0,18}$/.test(String(tokenVersion))) throw authError();
  return withBusinessTransaction(pool, async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const row = (await tx.query('SELECT id,name,email,role,active,token_version FROM erp.users WHERE id=$1', [actorId])).rows[0];
    if (!row || !row.active || row.token_version !== String(tokenVersion)) throw authError();
    const actor = Object.freeze({ id: row.id, name: row.name, email: row.email, role: row.role });
    return callback(tx, actor);
  });
}

module.exports = { withAuthenticatedRead };
