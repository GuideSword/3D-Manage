'use strict';
const { parseScaled } = require('../decimal');
const MAX_BIGINT = 9223372036854775807n;
function exactText(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value.trim())) throw Error('Invalid decimal');
  const [whole, fraction = ''] = value.trim().split('.');
  const reduced = fraction.replace(/0+$/, '');
  return whole + (reduced ? `.${reduced}` : '');
}
const scaled = (value, scale, digits) => parseScaled(exactText(value), scale, digits);
function integer(value, signed = false) {
  if (typeof value !== 'string' || !(signed ? /^-?\d+$/ : /^\d+$/).test(value)) throw Error('Invalid integer');
  const result = BigInt(value);
  if (result > MAX_BIGINT || result < -MAX_BIGINT - 1n) throw Error('Integer out of range');
  return result;
}
function grams(value) {
  const result = scaled(value, 3, 16);
  if (result > MAX_BIGINT) throw Error('Quantity out of range');
  return result;
}
const identifier = value => typeof value === 'string' && value.trim() ? value : null;
module.exports = { exactText, scaled, integer, grams, identifier };
