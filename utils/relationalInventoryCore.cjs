'use strict';
const { parseScaled } = require('../backend/business-db/decimal');
const { recordVersion, createRelationalRequest } = require('./masterDataCore.cjs');
const MAX_MG = 9223372036854775807n;
const fail = message => { throw Object.assign(new Error(message), { code: 'INVENTORY_FORM_INVALID', status: 400 }); };
function parseGrams(value) {
  const mg = parseScaled(value, 3, 16);
  if (mg > MAX_MG) fail('数量超出库存允许范围');
  return mg;
}
function formatGrams(value) {
  const mg = BigInt(value), abs = mg < 0n ? -mg : mg;
  const fraction = String(abs % 1000n).padStart(3, '0').replace(/0+$/, '');
  return `${mg < 0n ? '-' : ''}${abs / 1000n}${fraction ? '.' + fraction : ''}`;
}
function compareGrams(a, b) { const difference = parseGrams(a) - parseGrams(b); return difference < 0n ? -1 : difference > 0n ? 1 : 0; }
function validateSummary(rows) {
  if (!Array.isArray(rows)) fail('库存汇总格式无效');
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row.materialId !== 'string' || !row.materialId || seen.has(row.materialId)
      || !Number.isSafeInteger(row.lotCount) || row.lotCount < 0 || typeof row.balanceIncomplete !== 'boolean' || typeof row.legacyUnverified !== 'boolean'
      || ![row.totalQtyMg, row.availableQtyMg].every(value => typeof value === 'string' && /^\d{1,40}$/.test(value))
      || BigInt(row.availableQtyMg) > BigInt(row.totalQtyMg)
      || formatGrams(row.totalQtyMg) !== row.totalQty || formatGrams(row.availableQtyMg) !== row.availableQty) fail('库存汇总数值无效，请重新加载');
    seen.add(row.materialId);
  }
  return rows;
}
function summarizeInventory(rows) {
  validateSummary(rows);
  const total = rows.reduce((sum, row) => sum + BigInt(row.totalQtyMg), 0n);
  const available = rows.reduce((sum, row) => sum + BigInt(row.availableQtyMg), 0n);
  const lotCount = rows.reduce((sum, row) => sum + row.lotCount, 0);
  if (!Number.isSafeInteger(lotCount)) fail('库存批次数超出范围');
  return { materialCount: rows.length, lotCount, totalQty: formatGrams(total), availableQty: formatGrams(available),
    balanceIncomplete: rows.some(row => row.balanceIncomplete), legacyUnverified: rows.some(row => row.legacyUnverified) };
}
function fields(input, allowed, required = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(input, key))) fail('库存请求字段无效');
  return input;
}
function identifier(value) { if (typeof value !== 'string' || !value.trim() || value.length > 500) fail('库存关联标识无效'); return encodeURIComponent(value); }
function version(value) { const result = recordVersion(value); if (BigInt(result) >= MAX_MG) fail('库存版本无效'); return result; }
function quantity(value, allowZero = true) { if (!allowZero && parseGrams(value) === 0n) fail('操作数量必须大于零'); parseGrams(value); return String(value).trim(); }
function text(value, max = 10000) { if (value == null) return ''; if (typeof value !== 'string' || value.length > max) fail('库存文本字段无效'); return value; }
const INFO = ['lotNo', 'serialNo', 'location', 'notes', 'photoKey'];
function info(input) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => {
    if (key === 'active') { if (typeof value !== 'boolean') fail('批次启用状态无效'); return [key, value]; }
    return [key, text(value)];
  }));
}
function createRelationalInventoryApi(dependencies) {
  const call = createRelationalRequest(dependencies);
  const query = (input, extra) => {
    fields(input, ['search', 'active', 'limit', 'offset', ...extra]);
    if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200)
      || input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 2147483647)) fail('库存分页参数无效');
    const encoded = Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
    return encoded ? '?' + encoded : '';
  };
  const lotPath = id => '/inventory/lots/' + identifier(id);
  const api = {
    getLotsPage: (input = {}) => call('/inventory/lots' + query(input, ['materialId', 'warehouseId', 'state', 'balanceStatus'])),
    getLotById: id => call(lotPath(id)),
    getTransactionsPage: (input = {}) => call('/inventory/transactions' + query(input, ['lotId', 'materialId', 'type', 'orderId'])),
    getSummary: (input = {}) => {
      fields(input, ['materialId', 'materialType', 'lowStockOnly']);
      return call('/inventory/summary' + query(input, ['materialId', 'materialType', 'lowStockOnly'])).then(validateSummary);
    },
    createLot(input, key) {
      fields(input, ['materialId', 'warehouseId', 'qty', 'unit', 'state', ...INFO], ['materialId', 'qty']); identifier(input.materialId);
      if (input.unit !== undefined && input.unit !== 'g') fail('库存单位必须为克');
      const { qty, ...rest } = input;
      return call('/inventory/lots', 'POST', { ...rest, qty: quantity(qty), unit: 'g' }, key);
    },
    updateLot(id, input, key) {
      fields(input, ['version', 'changes'], ['version', 'changes']); fields(input.changes, [...INFO, 'active']);
      if (!Object.keys(input.changes).length) fail('请填写批次资料修改');
      return call(lotPath(id), 'PATCH', { version: version(input.version), changes: info(input.changes) }, key);
    },
    setState(id, input, key) {
      fields(input, ['version', 'state'], ['version', 'state']);
      if (!['in_stock', 'frozen', 'scrapped'].includes(input.state)) fail('批次状态无效');
      return call(lotPath(id) + '/state', 'POST', { version: version(input.version), state: input.state }, key);
    },
    archiveLot: (id, expectedVersion, key) => call(lotPath(id) + '/archive', 'POST', { version: version(expectedVersion) }, key),
    deleteLot: (id, expectedVersion, key) => call(lotPath(id), 'DELETE', { version: version(expectedVersion) }, key),
    post(input, key) {
      fields(input, ['lotId', 'version', 'type', 'qty', 'unit', 'notes', 'reason', 'orderId'], ['lotId', 'version', 'type', 'qty']); identifier(input.lotId);
      if (!['in', 'out', 'adjust', 'scrap'].includes(input.type) || input.unit !== undefined && input.unit !== 'g') fail('库存操作类型或单位无效');
      if (input.orderId !== undefined && input.orderId !== null && input.orderId !== '') identifier(input.orderId);
      return call('/inventory/transactions', 'POST', { ...input, version: version(input.version), qty: quantity(input.qty, input.type === 'adjust'), unit: 'g',
        ...(input.notes !== undefined ? { notes: text(input.notes) } : {}), ...(input.reason !== undefined ? { reason: text(input.reason) } : {}) }, key);
    },
  };
  return Object.freeze(api);
}
module.exports = { parseGrams, formatGrams, compareGrams, validateSummary, summarizeInventory, createRelationalInventoryApi };
