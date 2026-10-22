'use strict';
const v = require('../catalog/validation');
const COLUMNS = 'id,email,name,role,active,version,created_at,updated_at,last_login_at';
function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, role: row.role, active: row.active, version: row.version,
    createdAt: v.iso(row.created_at), updatedAt: v.iso(row.updated_at), lastLoginAt: v.iso(row.last_login_at) };
}
async function get(tx, id) {
  const row = (await tx.query(`SELECT ${COLUMNS} FROM erp.users WHERE id=$1`, [v.id(id)])).rows[0];
  if (!row) v.fail('用户不存在', 'ENTITY_NOT_FOUND', 404);
  return publicUser(row);
}
async function privateUser(tx, id) {
  const row = (await tx.query(`SELECT ${COLUMNS},password_hash,token_version FROM erp.users WHERE id=$1 FOR UPDATE`, [v.id(id)])).rows[0];
  if (!row) v.fail('用户不存在', 'ENTITY_NOT_FOUND', 404);
  return row;
}
module.exports = { COLUMNS, publicUser, get, privateUser };
