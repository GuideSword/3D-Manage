'use strict';
const { fail } = require('../catalog/validation');
const invalid = message => fail(message, 'CSV_INVALID');

// RFC4180 fields are text. Never infer numeric types from a spreadsheet cell.
function parseCsv(input, { maxRows = 1000, maxBytes = 10 * 1024 * 1024, allowedHeaders, requiredHeaders = [] } = {}) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > maxBytes) invalid('CSV 文件为空或超过允许大小');
  const text = input.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', state = 'start', ended = false;
  function cell() {
    row.push(field); field = ''; state = 'start';
    if (row.length > 128) invalid('CSV 列数超过允许范围');
  }
  function line() {
    cell(); rows.push(row); row = [];
    if (rows.length > maxRows + 1) invalid(`CSV 最多允许 ${maxRows} 条数据`);
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    ended = false;
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else field += char;
      continue;
    }
    if (char === ',') { cell(); continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      line(); ended = true; continue;
    }
    if (state === 'closed') invalid('CSV 引号闭合后存在多余字符');
    if (char === '"') {
      if (state !== 'start') invalid('CSV 字段中的引号必须成对转义');
      state = 'quoted';
    } else { state = 'plain'; field += char; }
  }
  if (state === 'quoted') invalid('CSV 引号未闭合');
  if (!ended && text.length) line();
  if (!rows.length) invalid('CSV 缺少表头');
  const headers = rows.shift();
  if (headers.some(x => !x || x.trim() !== x) || new Set(headers).size !== headers.length) invalid('CSV 表头为空、重复或带有首尾空格');
  if ((allowedHeaders && headers.some(x => !allowedHeaders.includes(x))) || requiredHeaders.some(x => !headers.includes(x))) invalid('CSV 含有不支持的列或缺少必填列');
  return rows.map((values, index) => {
    if (values.length !== headers.length) invalid(`CSV 第 ${index + 2} 行列数与表头不一致`);
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}
function writeCsv(headers, rows) {
  if (!Array.isArray(headers) || !headers.length || headers.some(x => typeof x !== 'string' || !x || x.trim() !== x)
      || new Set(headers).size !== headers.length) invalid('CSV 导出表头无效');
  const encode = value => {
    if (value == null) return '';
    if (!['string', 'number', 'boolean', 'bigint'].includes(typeof value)
        || (typeof value === 'number' && !Number.isSafeInteger(value))) invalid('CSV 导出值必须是文本或精确整数');
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return '\uFEFF' + [headers.map(encode).join(','), ...rows.map(row => headers.map(key => encode(row[key])).join(','))].join('\r\n') + '\r\n';
}
module.exports = { parseCsv, writeCsv };
