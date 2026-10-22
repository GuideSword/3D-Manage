'use strict';
const { multiplyToCents } = require('../backend/business-db/decimal');
function amount(value) {
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  }
  // Legacy API1 records already contain Number values. New numeric strings never take this path.
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';
}
function unitPrice(value) {
  return typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? value
    : typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}
function lineAmount(item) {
  if (item.subtotal !== undefined && item.subtotal !== null && item.subtotal !== '') return amount(item.subtotal);
  const quantity = item.quantity ?? item.qty, price = item.unitPrice ?? item.unit_price;
  try { return multiplyToCents(quantity, price); }
  catch (_) { return typeof quantity === 'number' && typeof price === 'number' ? amount(quantity * price) : '—'; }
}
module.exports = { amount, unitPrice, lineAmount };
