'use strict';
// The same dependency-free arithmetic is used by the server; no database code is imported.
const { parseScaled, multiplyToCents, sumCents } = require('../backend/business-db/decimal');
const { recordVersion } = require('./masterDataCore.cjs');
const fail = (message, code = 'ORDER_FORM_INVALID') => { throw Object.assign(new Error(message), { code, status: 400 }); };
const commercialEditable = record => !record || (['draft', 'pending_review'].includes(record.status) && record.commercialEditable !== false);
const string = (value, max = 10000) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) fail('订单文本字段无效或过长');
  return value;
};
const newLine = () => ({ modelId: '', modelName: '', materialType: '', color: '', quantity: '', unitPrice: '', layerHeightMm: '', externalFileUrl: '', notes: '' });
const LINE_TEXT = { modelId: 500, modelName: 500, materialType: 240, color: 240, layerHeightMm: 100, externalFileUrl: 2000, notes: 10000 };
function orderToForm(record) {
  return { customerId: record?.customerId || '', notes: record?.notes || '', dueDate: record?.dueDate || '', currency: 'CNY', status: record?.status || 'pending_review',
    items: record ? (record.items || []).map(item => ({ ...Object.fromEntries(Object.keys(LINE_TEXT).map(key => [key, item[key] == null ? '' : String(item[key])])),
      id: item.id, quantity: String(item.quantity), unitPrice: String(item.unitPrice) })) : [newLine()] };
}
function decimal(value, scale, digits, positive = false) {
  if (parseScaled(value, scale, digits) === 0n && positive) fail('订单数量必须大于零');
  return String(value).trim();
}
function date(value) {
  if (value == null || value === '') return null;
  const input = string(value, 30);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(input) || !Number.isFinite(Date.parse(input))
      || new Date(input).toISOString().slice(0, 10) !== input.slice(0, 10)) fail('交期日期无效');
  return input;
}
function normalizedLines(items, record) {
  if (!Array.isArray(items) || items.length > 1000 || (!record && !items.length)) fail('订单需要 1 至 1000 个项目');
  const existing = new Map((record?.items || []).map(item => [item.id, item]));
  const used = new Set();
  return items.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('订单项目格式无效');
    const old = record && item.id ? existing.get(item.id) : null;
    const output = Object.fromEntries(Object.entries(LINE_TEXT).map(([key, max]) => [key,
      old && item[key] === old[key] ? item[key] ?? '' : string(item[key], max)]));
    if (record && item.id !== undefined) {
      if (typeof item.id !== 'string' || !existing.has(item.id) || used.has(item.id)) fail('订单行标识无效，请重新加载');
      output.id = item.id; used.add(item.id);
    }
    if (!output.modelId && !output.id) fail('请为新增项目选择模型');
    output.quantity = decimal(item.quantity, 3, 15, true);
    output.unitPrice = decimal(item.unitPrice, 6, 14);
    if (output.layerHeightMm && output.layerHeightMm !== old?.layerHeightMm) decimal(output.layerHeightMm, 6, 6, true);
    return output;
  });
}
function samePricing(a, b) {
  return parseScaled(a.quantity, 3, 15) === parseScaled(b.quantity, 3, 15)
    && parseScaled(a.unitPrice, 6, 14) === parseScaled(b.unitPrice, 6, 14);
}
function sameCommercialLine(a, b) {
  return a.id === b.id && samePricing(a, b) && Object.keys(LINE_TEXT).filter(key => key !== 'notes' && !(key === 'modelName' && a.modelId))
    .every(key => a[key] === (b[key] == null ? '' : String(b[key])));
}
function orderPayload(form, record) {
  if (!form || typeof form !== 'object') fail('订单表单无效');
  const customerId = string(form.customerId, 500);
  if (!customerId.trim()) fail('请从客户档案中选择客户', 'CUSTOMER_SELECTION_REQUIRED');
  if (form.currency !== 'CNY') fail('当前只支持人民币订单');
  const items = normalizedLines(form.items, record);
  if (!record) {
    if (!['draft', 'pending_review'].includes(form.status)) fail('新订单只能保存为草稿或待审核');
    return { customerId, items, currency: 'CNY', status: form.status, notes: string(form.notes), dueDate: date(form.dueDate) };
  }
  const changes = {};
  if (form.notes !== record.notes) changes.notes = string(form.notes);
  if ((form.dueDate || null) !== (record.dueDate || null)) changes.dueDate = date(form.dueDate);
  const changedCustomer = customerId !== record.customerId;
  const previous = record.items || [];
  const commercialChange = items.length !== previous.length || items.some((item, index) => !sameCommercialLine(item, previous[index]));
  if ((commercialChange || changedCustomer) && !commercialEditable(record)) fail('订单已进入执行，只能修改交期和说明', 'ORDER_COMMERCIAL_LOCKED');
  if (changedCustomer) changes.customerId = customerId;
  if (commercialChange) changes.items = items.map(item => {
    const old = previous.find(row => row.id === item.id);
    if (!old) return item;
    const patch = { id: item.id, quantity: item.quantity, unitPrice: item.unitPrice };
    for (const key of Object.keys(LINE_TEXT)) {
      if (key === 'modelName' && item.modelId) continue;
      if (item[key] !== (old[key] == null ? '' : String(old[key]))) patch[key] = item[key];
    }
    return patch;
  });
  else if (items.some((item, index) => item.notes !== (previous[index].notes || ''))) {
    changes.items = items.map((item, index) => ({ id: item.id, ...(item.notes !== (previous[index].notes || '') ? { notes: item.notes } : {}) }));
  }
  return { version: recordVersion(record.version), changes };
}
function previewTotal(items, record) {
  const previous = new Map((record?.items || []).map(item => [item.id, item]));
  const used = new Set();
  let changed = items.length !== previous.size;
  const amounts = items.map(item => {
    const old = previous.get(item.id);
    const same = old && !used.has(item.id) && samePricing(item, old);
    used.add(item.id);
    changed ||= !same;
    return same ? old.subtotal : multiplyToCents(item.quantity, item.unitPrice);
  });
  return record && !changed ? record.total : sumCents(amounts);
}
module.exports = { newLine, orderToForm, orderPayload, previewTotal, commercialEditable };
