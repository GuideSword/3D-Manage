'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSource, assertSourceHash } = require('../../backend/business-db/preflight/source');

test('source parsing preserves numeric lexemes and refuses changed source hashes', () => {
  const raw = '{"total":9007199254740993.01,"small":0.30000000000000004,"flag":true}';
  const source = parseSource(raw);
  assert.equal(source.raw, raw);
  assert.equal(source.data.total, '9007199254740993.01');
  assert.equal(source.data.small, '0.30000000000000004');
  assert.equal(source.data.flag, true);
  assertSourceHash(source, source.sha256);
  assert.throws(() => assertSourceHash(source, '0'.repeat(64)), { code: 'PREFLIGHT_SOURCE_CHANGED' });
  assert.throws(() => parseSource(Buffer.from([0xff])), { code: 'PREFLIGHT_SOURCE_INVALID' });
  assert.throws(() => parseSource('[]'), { code: 'PREFLIGHT_SOURCE_INVALID' });
});
