'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const archive = path.join(root, '.tmp/release-package/3d-manage-1.0.0.tar.gz');
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const originalHash = hash();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'output/android-artifact-20260929.json')));
const testManifest = path.join(root, '.tmp/invalid-android-artifact.json');
const file = '../output/' + manifest.file;
try {
  for (const candidate of [{ ...manifest, file, apkSha256: '0'.repeat(64) }, { ...manifest, file, supportedAbis: [] }, { ...manifest, file, version: 'invalid' }]) {
    fs.writeFileSync(testManifest, JSON.stringify(candidate));
    const result = spawnSync(process.execPath, ['deploy/package-release.mjs', '--android-manifest', testManifest], { cwd: root, encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'Invalid client artifact must be rejected');
    assert.equal(hash(), originalHash, 'Invalid manifest must not erase an existing release archive');
  }
  console.log('Package identity/hash/ABI guards passed; existing release archive retained.');
} finally { fs.unlinkSync(testManifest); }
