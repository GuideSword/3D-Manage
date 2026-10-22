'use strict';
const { createInventoryCommandController } = require('./inventoryCommandCore.cjs');
const fail = (message, code = 'MASTER_DATA_INPUT_INVALID') => { throw Object.assign(new Error(message), { code, status: code === 'MASTER_DATA_UNAVAILABLE' ? 503 : 400 }); };
const PARTNER_FIELDS = Object.freeze([
  { key: 'code', label: '编号', max: 120, required: true },
  { key: 'name', label: '名称', max: 240, required: true },
  { key: 'contactName', label: '联系人', max: 240 },
  { key: 'email', label: '邮箱', max: 320 },
  { key: 'phone', label: '电话', max: 120 },
  { key: 'address', label: '地址', max: 2000 },
  { key: 'notes', label: '备注', max: 10000 },
].map(Object.freeze));
const supportsMasterData = server => Boolean(server?.serverKey && server?.apiBaseUrl
  && server.capabilities?.businessRulesVersion === 2 && server.capabilities?.relationalBusiness === true);
function partnerKind(kind) {
  if (!['customers', 'suppliers'].includes(kind)) fail('资料类型无效');
  return kind;
}
function partnerToForm(record = {}) {
  return Object.fromEntries(PARTNER_FIELDS.map(({ key }) => [key, record[key] == null ? '' : String(record[key])]));
}
function formToPartner(form, { partial = false } = {}) {
  if (!form || typeof form !== 'object' || Array.isArray(form) || Object.keys(form).some(key => !PARTNER_FIELDS.some(field => field.key === key))) fail('资料字段无效');
  const fields = partial ? PARTNER_FIELDS.filter(({ key }) => Object.hasOwn(form, key)) : PARTNER_FIELDS;
  if (!fields.length) fail('至少填写一个修改字段');
  return Object.fromEntries(fields.map(({ key, label, max, required }) => {
    if (form[key] != null && typeof form[key] !== 'string') fail(`${label}必须为文本`);
    const value = key === 'notes' ? form[key] ?? '' : (form[key] ?? '').trim();
    if ((required && !value) || value.length > max) fail(`${label}${required && !value ? '不能为空' : `不能超过 ${max} 个字符`}`);
    return [key, value];
  }));
}
function recordVersion(value) {
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isSafeInteger(value))) fail('缺少有效记录版本，请重新加载');
  const text = String(value);
  if (!/^[1-9]\d{0,18}$/.test(text) || (text.length === 19 && text > '9223372036854775807')) fail('记录版本无效，请重新加载');
  return text;
}
function createBusinessCommandController(createKey, { reusable = false } = {}) {
  let controller = createInventoryCommandController(createKey);
  return { async run(operation, payload, scope, send) {
    if (!scope?.serverKey || !scope?.userId || !Number.isSafeInteger(scope.sessionEpoch)) fail('当前会话不可用，请重新打开页面', 'BUSINESS_SESSION_REQUIRED');
    try {
      const result = await controller.run(operation, payload, scope, send);
      if (reusable && result !== null) controller = createInventoryCommandController(createKey);
      return result;
    } catch (error) {
      if (error.code === 'INVENTORY_RETRY_PENDING') fail('上次操作结果尚未确认，请恢复原内容并重试；切换账号或服务器后请重新打开页面', 'BUSINESS_RETRY_PENDING');
      throw error;
    }
  } };
}
function createRelationalRequest({ request, getRuntime }) {
  return (path, method = 'GET', payload, key) => {
    if (!supportsMasterData(getRuntime())) fail('当前服务器尚未启用资料维护', 'MASTER_DATA_UNAVAILABLE');
    const headers = {};
    if (method !== 'GET') {
      if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) fail('缺少操作标识，请重新打开页面');
      headers['X-Business-Rules-Version'] = '2'; headers['Idempotency-Key'] = key;
    }
    return request(path, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  };
}
function createMasterDataApi(dependencies) {
  const call = createRelationalRequest(dependencies);
  const identifier = value => {
    if (typeof value !== 'string' || !value.trim() || value.length > 500) fail('资料标识无效');
    return encodeURIComponent(value);
  };
  const queryString = query => {
    const params = Object.entries(query).filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
    return params ? `?${params}` : '';
  };
  return Object.freeze({
    partners(kind) {
      const root = '/' + partnerKind(kind);
      return Object.freeze({
        getPage: (query = {}) => call(root + queryString(query)),
        getById: id => call(`${root}/${identifier(id)}`),
        create: (payload, key) => call(root, 'POST', formToPartner(payload), key),
        update: (id, { version, changes }, key) => call(`${root}/${identifier(id)}`, 'PATCH', { version: recordVersion(version), changes: formToPartner(changes, { partial: true }) }, key),
        setActive: (id, { version, active }, key) => {
          if (typeof active !== 'boolean') fail('启用状态无效');
          return call(`${root}/${identifier(id)}/active`, 'POST', { version: recordVersion(version), active }, key);
        },
        delete: (id, version, key) => call(`${root}/${identifier(id)}`, 'DELETE', { version: recordVersion(version) }, key),
      });
    },
    warehouses: Object.freeze({
      getDefault: () => call('/warehouses/default'),
      update: ({ id, version, name }, key) => {
        identifier(id);
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 240) fail('仓库名称不能为空且不能超过 240 个字符');
        return call('/warehouses/default', 'PATCH', { id, version: recordVersion(version), changes: { name: name.trim() } }, key);
      },
    }),
  });
}
module.exports = { PARTNER_FIELDS, supportsMasterData, partnerKind, partnerToForm, formToPartner, recordVersion, createBusinessCommandController, createMasterDataApi, createRelationalRequest };
