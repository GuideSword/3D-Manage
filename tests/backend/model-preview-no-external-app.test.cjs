'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Exercise Windows production behavior without ever invoking an OS thumbnail handler.
function load(filename, overrides = {}) {
  const resolved = path.resolve(filename), nativeRequire = createRequire(resolved);
  const sandbox = { module: { exports: {} }, Buffer,
    process: { platform: 'win32', pid: process.pid, env: { NODE_ENV: 'production' } },
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : nativeRequire(name) };
  vm.runInNewContext(fs.readFileSync(resolved, 'utf8'), sandbox, { filename: resolved });
  return sandbox.module.exports;
}
const emptyZip = () => { const bytes = Buffer.alloc(22); bytes.writeUInt32LE(0x06054b50); return bytes; };

for (const name of ['model.stl', 'no-preview.3mf']) {
  test(`legacy preview of ${name} cannot launch a thumbnail provider`, async () => {
    const calls = [];
    const { createModelPreview } = load('backend/utils/modelPreview.js', {
      child_process: { execFile: (...args) => {
        calls.push(args[0]); args.at(-1)(new Error('OS execution intercepted'));
      } },
    });
    assert.equal(await createModelPreview({ originalName: name, fileBuffer: emptyZip(), fullPath: path.join(os.tmpdir(), name) }), null);
    assert.deepEqual(calls, [], 'Previewing a file must not execute any external process');
  });
  test(`relational preview of ${name} cannot fall back to the Windows shell`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-preview-no-launch-'));
    assert.equal(path.dirname(root), os.tmpdir());
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'models'));
    fs.writeFileSync(path.join(root, 'models', name), emptyZip());
    let calls = 0;
    const { createAutoPreviewPublisher } = load('backend/modules/models/preview.js', {
      '../../utils/modelPreview': { createModelPreview: async () => { calls++; return null; } },
    });
    const result = await createAutoPreviewPublisher({ uploadDirectory: root })({ id: 'source', fileKey: `models/${name}` });
    assert.equal(result.file, null);
    assert.equal(calls, 0, 'Missing embedded preview must not invoke the system thumbnail provider');
  });
}
