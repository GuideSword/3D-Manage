'use strict';
const { createRelationalRequest } = require('./masterDataCore.cjs');
const fail = message => { throw Object.assign(new Error(message), { status: 400, code: 'CSV_CLIENT_INVALID' }); };
const definitions = Object.freeze({
  orders: Object.freeze({ label: '订单', canImport: true, header: 'order_id,customer_id,model_name,quantity,unit_price,notes,line_notes',
    hint: 'customer_id填写已有客户ID；同一order_id的多行合并为一张新订单。数量和单价保持文本，客户ID不按姓名猜测。' }),
  models: Object.freeze({ label: '模型', canImport: true, header: 'name,description,source', hint: 'name为模型名；source填写original、remix或imported。CSV不包含模型文件和图片。' }),
  materials: Object.freeze({ label: '耗材', canImport: true, header: 'type,brand,color,unit_price,notes', hint: 'type、brand、color和unit_price必填；单价最多6位小数，不填写千位分隔符。' }),
  lots: Object.freeze({ label: '库存批次', canImport: true, header: 'material_id,lot_no,serial_no,location,qty_g,notes', hint: 'material_id填写已有耗材ID；qty_g单位为克，最多3位小数。正数期初库存生成流水，不能导入未核对历史余额。' }),
  transactions: Object.freeze({ label: '库存流水', canImport: false, header: '', hint: '库存历史流水仅允许导出，不能通过CSV改写。' }),
});
function csvDefinition(kind) {
  if (!Object.hasOwn(definitions, kind)) fail('不支持的CSV模块');
  return definitions[kind];
}
function fields(input, allowed, required = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(input, key))) fail('CSV参数无效');
}
function csvImportPayload(input) {
  fields(input, ['csv'], ['csv']);
  if (typeof input.csv !== 'string' || !input.csv.trim()) fail('请粘贴CSV内容或选择CSV文件');
  let bytes = 0;
  for (const char of input.csv) {
    const code = char.codePointAt(0);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes > 10 * 1024 * 1024) fail('CSV文件不能超过10MiB');
  }
  return { csv: input.csv };
}
function validateCsvExport(file) {
  if (!file || typeof file !== 'object' || typeof file.filename !== 'string' || file.filename.length > 240
    || !file.filename || /[\\/\x00-\x1f]/.test(file.filename) || !/\.csv$/i.test(file.filename)
    || typeof file.contentType !== 'string' || !/^text\/csv(?:\s*;|$)/i.test(file.contentType)
    || typeof file.content !== 'string' || !file.content || !Number.isSafeInteger(file.count) || file.count < 0) {
    throw Object.assign(new Error('服务器返回的CSV文件无效，请重试导出'), { code: 'CSV_EXPORT_INVALID' });
  }
  return file;
}
function validateCsvImportResult(result) {
  if (!result || !Number.isSafeInteger(result.imported) || result.imported < 1 || result.imported > 1000) {
    throw Object.assign(new Error('导入结果未能确认，请重试原操作'), { code: 'CSV_IMPORT_RESULT_INVALID' });
  }
  return result;
}
function createRelationalCsvApi(dependencies) {
  const call = createRelationalRequest(dependencies);
  return Object.freeze({
    importRecords(kind, input, key) {
      if (!csvDefinition(kind).canImport) fail('库存流水只允许导出');
      return Promise.resolve(call(`/csv/${kind}`, 'POST', csvImportPayload(input), key)).then(validateCsvImportResult);
    },
    exportRecords(kind, query = {}) {
      csvDefinition(kind); fields(query, ['search', 'active']);
      if (query.search !== undefined && typeof query.search !== 'string' || query.active !== undefined && typeof query.active !== 'boolean') fail('CSV导出筛选无效');
      if (kind === 'transactions' && query.active !== undefined) fail('历史流水不支持启用状态筛选');
      const parameters = kind === 'lots' || kind === 'transactions' ? [['type', kind]] : [];
      parameters.push(...Object.entries(query).filter(([, value]) => value !== undefined && value !== ''));
      const queryText = parameters.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
      const root = kind === 'lots' || kind === 'transactions' ? '/stock/export' : `/${kind}/export`;
      return Promise.resolve(call(root + (queryText ? '?' + queryText : ''))).then(validateCsvExport);
    },
  });
}
module.exports = { csvDefinition, csvImportPayload, validateCsvExport, createRelationalCsvApi };
