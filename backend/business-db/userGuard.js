'use strict';
async function lockUserWrites(tx) {
  const row = (await tx.query("SELECT id FROM erp.user_write_guard WHERE id='default' FOR UPDATE")).rows[0];
  if (!row) throw Object.assign(new Error('用户管理保护尚未初始化'), { code: 'ERP_USER_GUARD_MISSING', status: 500 });
}
module.exports = { lockUserWrites };
