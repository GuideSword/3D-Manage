'use strict';
const { z } = require('zod');
const { createHmac } = require('node:crypto');
const v = require('../catalog/validation');
function credentialKey(jwtSecret) {
  if (typeof jwtSecret !== 'string' || !jwtSecret.trim() || Buffer.byteLength(jwtSecret, 'utf8') < 32) v.fail('认证密钥必须由服务器显式提供', 'AUTH_CONFIGURATION_INVALID', 500);
  return createHmac('sha256', jwtSecret).update('3d-manage:credential-receipts:v1').digest();
}
const credentialDigest = key => envelope => createHmac('sha256', key).update(JSON.stringify(envelope)).digest('hex');
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value, 'utf8') > 72) v.fail('密码至少需要 12 个字符且不超过 72 个 UTF-8 字节', 'PASSWORD_INVALID');
  return value;
}
function email(value) {
  const result = z.string().trim().email().max(320).safeParse(value);
  if (!result.success) v.fail('请输入有效邮箱');
  return result.data.toLowerCase();
}
function role(value) { if (!['owner', 'staff', 'viewer'].includes(value)) v.fail('用户角色无效'); return value; }
const name = value => v.string(value, { required: true, trim: true, max: 120 });
const forbidden = () => v.fail('当前账号无权管理用户', 'BUSINESS_FORBIDDEN', 403);
module.exports = { credentialKey, credentialDigest, password, email, role, name, forbidden };
