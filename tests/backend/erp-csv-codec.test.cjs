'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, writeCsv } = require('../../backend/modules/adapters/csvCodec');

test('CSV preserves BOM, quoted delimiters, embedded line breaks, quotes and exact decimals', () => {
  const rows = [{ name: '零件,"A"', notes: '第一行\r\n第二行\n第三行', amount: '9007199254740993.01' },
    { name: '', notes: '', amount: '0.000001' }];
  assert.deepEqual(parseCsv(writeCsv(['name', 'notes', 'amount'], rows)), rows);
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x","y"\r\n'), [{ a: 'x', b: 'y' }]);
});
test('CSV rejects malformed quotes, ragged rows, duplicate/empty headers and excess input', () => {
  for (const input of ['a,a\n1,2', 'a,\n1,2', 'a,b\n1', 'a\n"x', 'a\nx"y', 'a\n"x"y', '']) {
    assert.throws(() => parseCsv(input), { code: 'CSV_INVALID' }, input);
  }
  assert.throws(() => parseCsv('a\n1\n2', { maxRows: 1 }), { code: 'CSV_INVALID' });
  assert.throws(() => parseCsv('a\n123', { maxBytes: 4 }), { code: 'CSV_INVALID' });
  assert.throws(() => parseCsv('bad', { allowedHeaders: ['a'] }), { code: 'CSV_INVALID' });
});
test('CSV uses safe own properties and refuses lossy writer input', () => {
  const row = parseCsv('__proto__,constructor\nx,y')[0];
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.equal(Object.hasOwn(row, '__proto__'), true);
  assert.equal(row.__proto__, 'x');
  assert.throws(() => writeCsv(['a'], [{ a: 9007199254740992 }]), { code: 'CSV_INVALID' });
  assert.throws(() => writeCsv(['a'], [{ a: { value: 1 } }]), { code: 'CSV_INVALID' });
});
