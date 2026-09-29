const invalidQuantity = () => Object.assign(new Error('数量必须是非负克数，最多三位小数且不能超出安全范围'), {
  status: 400, code: 'INVALID_QUANTITY',
});

// Parse decimal grams without floating point arithmetic. Never round bad input.
const gramsToMg = (value) => {
  if (!['number', 'string'].includes(typeof value)) throw invalidQuantity();
  const text = String(value).trim();
  if (text.length > 32 || !/^\d+(?:\.\d{1,3})?$/.test(text)) throw invalidQuantity();
  const [whole, fraction = ''] = text.split('.');
  const mg = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (mg > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidQuantity();
  return Number(mg);
};

const mgToGrams = (value) => value / 1000;

module.exports = { gramsToMg, mgToGrams };
