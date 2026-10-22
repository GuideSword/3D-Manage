'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseScaled, multiplyToCents, sumCents } = require('../../backend/business-db/decimal');

test('scaled decimals retain exact digits beyond JavaScript safe integer precision', () => {
  assert.equal(parseScaled('1.235', 3), 1235n);
  assert.equal(parseScaled(' 0001.20 ', 3), 1200n);
  assert.equal(parseScaled(2, 3), 2000n);
  assert.equal(parseScaled('9007199254740993', 0), 9007199254740993n);
  assert.equal(parseScaled('999999999999999.999', 3, 15), 999999999999999999n);
});

test('invalid text and floating point numbers cannot enter exact decimal arithmetic', () => {
  for (const value of ['', ' ', '1e3', '-1', '+1', '.5', '1.', '1,000', '1 2', '1x', 'NaN', '１２',
    0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, undefined, {}, true]) {
    assert.throws(() => parseScaled(value, 3), { code: 'INVALID_DECIMAL' }, String(value));
  }
  assert.throws(() => parseScaled('1.0001', 3), { code: 'DECIMAL_PRECISION_EXCEEDED' });
  assert.throws(() => parseScaled('1000000000000000', 3, 15), { code: 'DECIMAL_OUT_OF_RANGE' });
});

test('quantity times price rounds once at the line level using decimal half-up', () => {
  assert.equal(multiplyToCents('0.333', '3.000001'), '1.00');
  assert.equal(multiplyToCents('2.000', '0.005000'), '0.01');
  assert.equal(multiplyToCents('1', '0.004999'), '0.00');
  assert.equal(multiplyToCents('1', '0.005000'), '0.01');
  assert.equal(multiplyToCents('0.001', '0.000001'), '0.00');
  assert.equal(multiplyToCents('3', '0.100000'), '0.30');
  assert.equal(multiplyToCents('999999999999999.999', '0.000001'), '1000000000.00');
});

test('quantity, price, and resulting amount each enforce their PostgreSQL numeric range', () => {
  assert.throws(() => multiplyToCents('1.0001', '1'), { code: 'DECIMAL_PRECISION_EXCEEDED' });
  assert.throws(() => multiplyToCents('1', '0.0000001'), { code: 'DECIMAL_PRECISION_EXCEEDED' });
  assert.throws(() => multiplyToCents('1000000000000000', '1'), { code: 'DECIMAL_OUT_OF_RANGE' });
  assert.throws(() => multiplyToCents('1', '100000000000000'), { code: 'DECIMAL_OUT_OF_RANGE' });
  assert.throws(() => multiplyToCents('999999999999999.999', '99999999999999.999999'),
    { code: 'DECIMAL_OUT_OF_RANGE' });
});

test('totals add already rounded line amounts without floating point or a second rounding', () => {
  assert.equal(sumCents(['0.01', '0.02']), '0.03');
  assert.equal(sumCents([multiplyToCents('1', '0.005000'), multiplyToCents('1', '0.005000')]), '0.02');
  assert.equal(sumCents(['900719925474099.91', '0.02']), '900719925474099.93');
  assert.equal(sumCents(['999999999999999999.98', '0.01']), '999999999999999999.99');
  assert.equal(sumCents([]), '0.00');
  assert.throws(() => sumCents(['999999999999999999.99', '0.01']), { code: 'DECIMAL_OUT_OF_RANGE' });
  assert.throws(() => sumCents(['0.005']), { code: 'DECIMAL_PRECISION_EXCEEDED' });
  assert.throws(() => sumCents('0.01'), { code: 'INVALID_DECIMAL' });
});
