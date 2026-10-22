const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
test('model handoff release manifest and web card use the same immutable release asset', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tools/model-handoff/release-manifest.json'), 'utf8'));
  const card = fs.readFileSync(path.join(root, 'components/ModelHandoffInstallCard.js'), 'utf8');
  assert.match(manifest.downloadUrl, new RegExp(`releases/download/${manifest.releaseTag}/${manifest.asset}$`));
  assert.match(manifest.checksumUrl, new RegExp(`releases/download/${manifest.releaseTag}/${manifest.checksumAsset}$`));
  assert.match(card, new RegExp(manifest.version.replaceAll('.', '\\.'), 'g'));
  assert.match(card, new RegExp(manifest.downloadUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(card, new RegExp(manifest.checksumUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
