'use strict';
const { parseScaled } = require('../../business-db/decimal');
const { parseSource } = require('../../business-db/preflight/source');

function fail(message, code = 'BUSINESS_INPUT_INVALID', status = 400) { throw Object.assign(new Error(message), { code, status }); }
function fields(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))
      || required.some(key => !Object.hasOwn(value, key))) fail('填写字段不完整或含有不允许修改的字段');
  return value;
}
function string(value, { required = false, trim = false, max = 10000 } = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') fail('文本字段格式无效');
  const result = trim ? value.trim() : value;
  if (result.length > max || (required && !result.trim())) fail('文本字段为空或超出长度限制');
  return result;
}
function id(value) { return string(value, { required: true, max: 500 }); }
function decimal(value, { nullable = false, positive = false, scale = 6, digits = 14 } = {}) {
  if (nullable && (value == null || value === '')) return null;
  const scaled = parseScaled(value, scale, digits);
  if (positive && scaled === 0n) fail('数值必须大于零');
  return String(value).trim();
}
function boolean(value) { if (typeof value !== 'boolean') fail('启用状态必须是布尔值'); return value; }
function page(query = {}, extra = []) {
  fields(query, ['search', 'active', 'limit', 'offset', ...extra]);
  const search = query.search === undefined ? '' : string(query.search, { trim: true, max: 500 });
  const active = query.active === undefined || query.active === 'all' ? null
    : query.active === true || query.active === 'true' ? true : query.active === false || query.active === 'false' ? false : undefined;
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;
  if (active === undefined || !Number.isSafeInteger(limit) || limit < 1 || limit > 200
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647) fail('分页或筛选参数无效');
  return { search, active, limit, offset };
}
function batch(payload) {
  fields(payload, ['items'], ['items']);
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 1000) fail('一次导入需要 1 至 1000 条记录');
  return payload.items;
}
const legacy = raw => parseSource(raw || '{}').data;
const iso = value => value instanceof Date ? value.toISOString() : value;
module.exports = { fields, string, id, decimal, boolean, page, batch, legacy, iso, fail };
