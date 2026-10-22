'use strict';

const MAX_AMOUNT_CENTS = 10n ** 20n - 1n;

function fail(code, message) {
  throw Object.assign(new Error(message), { code, status: 400 });
}

/** Parse a nonnegative decimal without passing fractional values through Number. */
function parseScaled(value, scale, maxIntegerDigits = 18) {
  if (!Number.isInteger(scale) || scale < 0 || scale > 20
      || !Number.isInteger(maxIntegerDigits) || maxIntegerDigits < 1 || maxIntegerDigits > 20) {
    throw new RangeError('十进制精度参数无效');
  }
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) {
    fail('INVALID_DECIMAL', '数值必须为十进制字符串或安全整数');
  }
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    fail('INVALID_DECIMAL', '请输入有效的非负十进制数值');
  }
  const [rawWhole, fraction = ''] = text.split('.');
  const whole = rawWhole.replace(/^0+(?=\d)/, '');
  if (whole.length > maxIntegerDigits) {
    fail('DECIMAL_OUT_OF_RANGE', '数值超出允许范围');
  }
  if (fraction.length > scale) {
    fail('DECIMAL_PRECISION_EXCEEDED', `数值最多允许 ${scale} 位小数`);
  }
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
}

function formatCents(cents) {
  if (cents > MAX_AMOUNT_CENTS) fail('DECIMAL_OUT_OF_RANGE', '金额超出允许范围');
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

/** numeric(18,3) quantity × numeric(20,6) price, rounded half-up to numeric(20,2). */
function multiplyToCents(quantity, unitPrice) {
  const product = parseScaled(quantity, 3, 15) * parseScaled(unitPrice, 6, 14);
  return formatCents((product + 5_000_000n) / 10_000_000n);
}

function sumCents(amounts) {
  if (!Array.isArray(amounts)) fail('INVALID_DECIMAL', '金额合计需要逐行金额列表');
  const cents = amounts.reduce((sum, amount) => sum + parseScaled(amount, 2, 18), 0n);
  return formatCents(cents);
}

module.exports = { parseScaled, multiplyToCents, sumCents };
