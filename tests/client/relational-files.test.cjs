'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRelationalFilesApi, validateFileAsset, validateUploadedFile } = require('../../utils/relationalFilesCore.cjs');
const runtime = { serverKey: 'files', apiBaseUrl: 'http://127.0.0.1/api', capabilities: { relationalBusiness: true, businessRulesVersion: 2 } };
const hash = 'a'.repeat(64);
const uploaded = { uploadId: 'upload-1', fileKey: `models/${hash}.stl`, fileUrl: `/api/files/models/${hash}.stl`, name: '零件.stl', originalName: '零件.stl', size: '21', sha256: hash, fileType: 'stl', mimeType: 'application/sla' };
const image = { ...uploaded, fileKey: `images/${hash}.png`, fileUrl: `/api/files/images/${hash}.png`, name: 'cover.png', originalName: 'cover.png', fileType: 'png', mimeType: 'image/png' };
const attachment = { ...uploaded, fileKey: `attachments/${hash}.pdf`, fileUrl: `/api/files/attachments/${hash}.pdf`, name: 'order.pdf', originalName: 'order.pdf', fileType: 'pdf', mimeType: 'application/pdf' };
const file = Object.assign(new Blob(['solid fixture\nendsolid']), { name: '零件.stl' });
function fixture() {
  const calls = []; let active = runtime;
  const api = createRelationalFilesApi({ getRuntime: () => active, request: async (path, options) => { calls.push({ path, ...options }); return path.startsWith('/uploads/') ? uploaded : { id: 'parent', version: '8' }; } });
  return { api, calls, setRuntime: value => { active = value; } };
}
test('multipart uses a real file and fixed business headers without JSON content type', async () => {
  const { api, calls } = fixture();
  assert.deepEqual(await api.upload('models', file, 'upload-key'), uploaded);
  assert.equal(calls[0].path, '/uploads/models'); assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].headers, { 'X-Business-Rules-Version': '2', 'Idempotency-Key': 'upload-key' });
  assert.ok(calls[0].body instanceof FormData); const parts = [...calls[0].body.entries()];
  assert.equal(parts.length, 1); assert.equal(parts[0][0], 'file'); assert.equal(parts[0][1].name, file.name);
  assert.equal(await parts[0][1].text(), await file.text());
});
test('upload validates local extensions, empty/oversized bytes and keys before transport', async () => {
  const { api, calls } = fixture();
  for (const args of [['models', { name: 'bad.exe', uri: 'file:///x', size: 1 }, 'k'], ['images', file, 'k'], ['unknown', file, 'k'], ['models', file, ''], ['models', file, 'bad key']]) assert.throws(() => api.upload(...args));
  for (const size of [0, -1, NaN, 1.5, 501 * 1024 * 1024]) assert.throws(() => validateFileAsset('models', { name: 'a.stl', uri: 'file:///x', size }));
  assert.throws(() => validateFileAsset('attachments', { name: 'x.pdf', uri: 'file:///x', size: 51 * 1024 * 1024 }));
  assert.equal(calls.length, 0);
});
test('native picker file, uppercase extensions and omitted provider size stay supported', () => {
  assert.equal(validateFileAsset('models', { name: '装配.STEP', uri: 'content://picker/file/1', type: 'application/octet-stream' }).name, '装配.STEP');
  assert.equal(validateFileAsset('images', { name: '封面.WebP', uri: 'file:///cache/a', size: 1 }).size, 1);
  assert.throws(() => validateFileAsset('models', { name: 'a.stl' }));
  assert.throws(() => validateFileAsset('models', { name: '../a.stl', uri: 'file:///x' }));
});
test('untrusted upload responses cannot register local paths, foreign URLs or invalid hashes', () => {
  assert.deepEqual(validateUploadedFile('models', uploaded), uploaded);
  for (const change of [{ id: 'forged' }, { createdAt: 'now' }, { sha256: 'bad' }, { size: '0' }, { fileKey: '../a.stl' }, { fileUrl: 'https://elsewhere/a' }, { fileKey: `images/${hash}.stl` }, { sha256: 'b'.repeat(64) }]) assert.throws(() => validateUploadedFile('models', { ...uploaded, ...change }));
});
test('registration and removal carry exact page version and server generated child identity', async () => {
  const { api, calls } = fixture();
  await api.add('models', 'm/1', 'files', { version: '9007199254740993', file: uploaded }, 'register-key');
  await api.add('models', 'm/1', 'images', { version: '8', file: { ...image, type: 'auto_preview', sourceFileId: 'source-1' } }, 'image-key');
  await api.remove('models', 'm/1', 'files', { version: '9', childId: 'child-1' }, 'remove-key');
  await api.add('orders', 'o/1', 'attachments', { version: '10', file: attachment }, 'attachment-key');
  await api.remove('orders', 'o/1', 'attachments', { version: '11', position: 3 }, 'detach-key');
  assert.deepEqual(calls.map(call => call.path), ['/models/m%2F1/files/add', '/models/m%2F1/images/add', '/models/m%2F1/files/remove', '/orders/o%2F1/attachments/add', '/orders/o%2F1/attachments/remove']);
  assert.equal(JSON.parse(calls[0].body).version, '9007199254740993');
  assert.deepEqual(JSON.parse(calls[2].body), { version: '9', childId: 'child-1' });
  assert.deepEqual(JSON.parse(calls[4].body), { version: '11', position: 3 });
  assert.equal(calls[1].headers['Idempotency-Key'], 'image-key');
});
test('invalid association input cannot guess latest version or fall back to legacy transport', () => {
  const { api, calls, setRuntime } = fixture();
  for (const args of [['models', 'm', 'attachments', { version: '1', file: uploaded }], ['orders', 'o', 'files', { version: '1', file: uploaded }], ['models', 'm', 'files', { version: undefined, file: uploaded }], ['models', 'm', 'files', { version: 9007199254740992, file: uploaded }], ['models', 'm', 'files', { version: '1', file: uploaded, id: 'wrong' }]]) assert.throws(() => api.add(...args, 'k'));
  assert.throws(() => api.remove('orders', 'o', 'attachments', { version: '1', position: -1 }, 'k'));
  setRuntime({ ...runtime, capabilities: {} });
  assert.throws(() => api.upload('models', file, 'k'), { code: 'MASTER_DATA_UNAVAILABLE' });
  assert.equal(calls.length, 0);
});
test('ambiguous upload retry reuses original bytes/key and invalid result is not reported as success', async () => {
  let attempt = 0; const sent = [];
  const api = createRelationalFilesApi({ getRuntime: () => runtime, request: async (path, options) => { sent.push(options); if (++attempt === 1) throw Object.assign(new Error('timeout'), { status: 503 }); return uploaded; } });
  await assert.rejects(api.upload('models', file, 'same-key'));
  await api.upload('models', file, 'same-key');
  assert.deepEqual(sent[0].headers, sent[1].headers);
  assert.equal(await sent[0].body.get('file').text(), await sent[1].body.get('file').text());
  const invalid = createRelationalFilesApi({ getRuntime: () => runtime, request: async () => ({ success: true }) });
  await assert.rejects(invalid.upload('models', file, 'key'), { code: 'FILE_UPLOAD_RESULT_INVALID' });
});
