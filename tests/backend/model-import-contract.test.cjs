const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeItem, isSupportedExtension, nextState } = require('../../backend/modules/modelImport/contract');

test('normalizes supported metadata and rejects traversal paths', () => {
  assert.equal(isSupportedExtension('part.STL'), true);
  assert.equal(normalizeItem({ itemId: 'i-1', relativePath: 'a\\part.stl', originalName: 'part.stl', size: 12, sha256: 'a'.repeat(64) }).relativePath, 'a/part.stl');
  assert.throws(() => normalizeItem({ itemId: 'i-1', relativePath: '../part.stl', originalName: 'part.stl', size: 12, sha256: 'a'.repeat(64) }), /路径/);
});

test('allows only legal item transitions', () => {
  assert.equal(nextState('uploading', 'verified'), 'completed');
  assert.throws(() => nextState('completed', 'uploading'), /状态/);
});
