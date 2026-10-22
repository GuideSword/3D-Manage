'use strict';
const { createRelationalRequest, recordVersion } = require('./masterDataCore.cjs');
const fail = message => { throw Object.assign(new Error(message), { status: 400, code: 'USER_FORM_INVALID' }); };
function fields(input, allowed, required = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(input, key))) fail('账号字段无效');
}
function utf8Length(value) {
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) fail('密码包含无效字符');
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || utf8Length(value) > 72) fail('密码至少需要12个字符且不超过72个UTF-8字节');
  return value;
}
function currentPassword(value) {
  if (typeof value !== 'string' || !value || utf8Length(value) > 72) fail('请输入当前密码');
  return value;
}
function name(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) fail('姓名不能为空且不能超过120个字符');
  return value.trim();
}
function managedRole(value) {
  if (!['staff', 'viewer'].includes(value)) fail('请选择员工或查看者角色');
  return value;
}
function userCreate(input) {
  fields(input, ['name', 'email', 'role', 'password'], ['name', 'email', 'role', 'password']);
  if (typeof input.email !== 'string' || input.email.trim().length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) fail('请输入有效邮箱');
  return { name: name(input.name), email: input.email.trim().toLowerCase(), role: managedRole(input.role), password: validatePassword(input.password) };
}
function userChanges(input) {
  fields(input, ['name', 'role', 'active']);
  if (!Object.keys(input).length) fail('至少填写一个修改字段');
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (key === 'name') return [key, name(value)];
    if (key === 'role') return [key, managedRole(value)];
    if (typeof value !== 'boolean') fail('启用状态无效');
    return [key, value];
  }));
}
function passwordCommand(input) {
  fields(input, ['version', 'currentPassword', 'newPassword'], ['version', 'currentPassword', 'newPassword']);
  return { version: recordVersion(input.version), currentPassword: currentPassword(input.currentPassword), newPassword: validatePassword(input.newPassword) };
}
function ownPasswordPayload(form, record) {
  fields(form, ['currentPassword', 'newPassword', 'confirmPassword'], ['currentPassword', 'newPassword', 'confirmPassword']);
  if (form.newPassword !== form.confirmPassword) fail('两次输入的新密码不一致');
  return passwordCommand({ version: record?.version, currentPassword: form.currentPassword, newPassword: form.newPassword });
}
function identifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) fail('账号标识无效');
  return encodeURIComponent(value);
}
function createRelationalUsersApi(dependencies) {
  const call = createRelationalRequest(dependencies);
  return Object.freeze({
    getPage(input = {}) {
      fields(input, ['search', 'active', 'role', 'limit', 'offset']);
      if (input.search !== undefined && typeof input.search !== 'string'
        || input.active !== undefined && typeof input.active !== 'boolean'
        || input.role !== undefined && !['owner', 'staff', 'viewer'].includes(input.role)
        || input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200)
        || input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0)) fail('账号分页参数无效');
      const query = Object.entries(input).filter(([, value]) => value !== undefined && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
      return call('/users' + (query ? '?' + query : ''));
    },
    getById: id => call(`/users/${identifier(id)}`),
    me: () => call('/auth/me'),
    create: (input, key) => call('/users', 'POST', userCreate(input), key),
    update(id, input, key) {
      fields(input, ['version', 'changes'], ['version', 'changes']);
      return call(`/users/${identifier(id)}`, 'PATCH', { version: recordVersion(input.version), changes: userChanges(input.changes) }, key);
    },
    delete: (id, version, key) => call(`/users/${identifier(id)}`, 'DELETE', { version: recordVersion(version) }, key),
    resetPassword(id, input, key) {
      fields(input, ['version', 'password'], ['version', 'password']);
      return call(`/users/${identifier(id)}/reset-password`, 'POST', { version: recordVersion(input.version), password: validatePassword(input.password) }, key);
    },
    changeOwnPassword: (input, key) => call('/auth/change-password', 'POST', passwordCommand(input), key),
  });
}
module.exports = { createRelationalUsersApi, userCreate, userChanges, ownPasswordPayload, validatePassword };
