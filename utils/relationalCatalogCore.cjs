'use strict';
const { parseScaled } = require('../backend/business-db/decimal');
const { recordVersion, createRelationalRequest } = require('./masterDataCore.cjs');
const fail = message => { throw Object.assign(new Error(message), { code: 'CATALOG_FORM_INVALID', status: 400 }); };
const FIELDS = Object.freeze({ models: ['name', 'description', 'source'],
  materials: ['code', 'name', 'type', 'brand', 'color', 'diameter', 'density', 'unit', 'unitPrice', 'notes'] });
function kindFields(kind) {
  if (!Object.hasOwn(FIELDS, kind)) fail('资料类型无效');
  return FIELDS[kind];
}
function identifier(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 500) fail('资料标识无效');
  return encodeURIComponent(id);
}
function version(value) {
  const result = recordVersion(value);
  if (BigInt(result) >= 9223372036854775807n) fail('记录版本无效，请重新加载');
  return result;
}
function catalogChanges(kind, input, { creating = false } = {}) {
  const allowed = kindFields(kind);
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.keys(input).length
    || Object.keys(input).some(key => !allowed.includes(key))) fail('资料字段无效');
  const required = kind === 'models' ? ['name', 'source'] : ['type', 'brand', 'color', 'unitPrice'];
  if (creating && (kind === 'models' ? ['name'] : required).some(key => !Object.hasOwn(input, key))) fail('请填写必填资料');
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (kind === 'materials' && ['unitPrice', 'diameter', 'density'].includes(key)) {
      if (key !== 'unitPrice' && (value === '' || value == null)) return [key, null];
      const parsed = parseScaled(value, 6, key === 'unitPrice' ? 14 : 6);
      if (key !== 'unitPrice' && parsed === 0n) fail('直径和密度必须大于零');
      return [key, String(value).trim()];
    }
    if (value == null && !required.includes(key)) return [key, key === 'code' ? null : ''];
    if (typeof value !== 'string') fail('资料字段必须为文本');
    const result = ['description', 'notes'].includes(key) ? value : value.trim();
    const max = kind === 'models' ? (key === 'description' ? 20000 : 500)
      : key === 'notes' ? 10000 : key === 'code' ? 120 : key === 'unit' ? 30 : 240;
    if (result.length > max || ((required.includes(key) || key === 'unit') && !result.trim())) fail('资料字段为空或过长');
    if (kind === 'models' && key === 'source' && !['original', 'remix', 'imported'].includes(result)) fail('模型来源无效');
    return [key, key === 'code' && !result ? null : result];
  }));
}
function catalogPayload(kind, form, record) {
  const changes = catalogChanges(kind, form, { creating: !record });
  if (!record) return changes;
  identifier(record.id);
  return { id: record.id, version: version(record.version), changes };
}
function createRelationalCatalogApi(dependencies) {
  const call = createRelationalRequest(dependencies);
  return Object.freeze(Object.fromEntries(Object.keys(FIELDS).map(kind => {
    const root = '/' + kind;
    return [kind, Object.freeze({
      getById: id => call(`${root}/${identifier(id)}`),
      create: (input, key) => call(root, 'POST', catalogChanges(kind, input, { creating: true }), key),
      update: (id, input, key) => {
        if (!input || Object.keys(input).some(field => !['version', 'changes'].includes(field))) fail('资料修改字段无效');
        return call(`${root}/${identifier(id)}`, 'PATCH', { version: version(input.version), changes: catalogChanges(kind, input.changes) }, key);
      },
      delete: (id, expectedVersion, key) => call(`${root}/${identifier(id)}`, 'DELETE', { version: version(expectedVersion) }, key),
    })];
  })));
}
module.exports = { catalogChanges, catalogPayload, createRelationalCatalogApi };
