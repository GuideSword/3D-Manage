'use strict';
const { parseScaled } = require('../../business-db/decimal');
const v = require('../catalog/validation');
const MAX_MG = 9223372036854775807n;
function parseGrams(value) {
  try {
    const result = parseScaled(value, 3, 16);
    if (result > MAX_MG) throw Error('overflow');
    return result;
  } catch (_) { v.fail('数量必须是非负克数，最多三位小数且不能超出库存范围', 'INVALID_QUANTITY'); }
}
function formatGrams(value) {
  if (value == null) return null;
  const mg = BigInt(value);
  const abs = mg < 0n ? -mg : mg;
  const fraction = String(abs % 1000n).padStart(3, '0').replace(/0+$/, '');
  return `${mg < 0n ? '-' : ''}${abs / 1000n}${fraction ? `.${fraction}` : ''}`;
}
function readQuantity(payload, fallback) {
  if (payload.unit !== undefined && payload.unit !== 'g') v.fail('库存数量单位必须为 g', 'INVALID_UNIT');
  const value = Object.hasOwn(payload, 'qty') ? payload.qty : Object.hasOwn(payload, 'qty_g') ? payload.qty_g : fallback;
  const mg = parseGrams(value);
  if (Object.hasOwn(payload, 'qty') && Object.hasOwn(payload, 'qty_g') && parseGrams(payload.qty_g) !== mg) v.fail('数量字段不一致', 'INVALID_QUANTITY');
  return mg;
}
module.exports = { MAX_MG, parseGrams, formatGrams, readQuantity };
