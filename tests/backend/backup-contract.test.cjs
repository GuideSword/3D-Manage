'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateManifest, verifyBackup, compareMetadata } = require('../../deploy/backup-contract.cjs');
const counts = { users: 1, orders: 1, models: 1, materials: 1, stockLots: 1, inventoryTxns: 1, auditLogs: 1, commandReceipts: 2, objectUploads: 1 };
const fixture = (version = 3) => ({ status: 'complete', serverId: 'fixture', storeSchemaVersion: version, postgresMajor: 16, apiVersion: '1', encryptionKeyId: '0123456789abcdef', collectionCounts: { ...counts } });
test('schema 2 backups remain restorable; schema 3 includes receipts and uploads', () => {
  for (const version of [2, 3]) assert.equal(validateManifest(fixture(version), 'fixture').storeSchemaVersion, version);
  assert.throws(() => validateManifest(fixture(4), 'fixture'), /incompatible/);
  for (const value of [undefined, null, '3', -1, 1.5]) assert.throws(() => validateManifest({ ...fixture(), storeSchemaVersion: value }, 'fixture'), /incompatible/);
});
test('restore refuses wrong identity, incomplete backups and invalid collection counts', () => {
  assert.throws(() => validateManifest(fixture(), 'other'), /unconfirmed/);
  assert.throws(() => validateManifest({ ...fixture(), status: 'incomplete' }, 'fixture'), /unconfirmed/);
  for (const collectionCounts of [{}, { ...counts, orders: -1 }, { ...counts, auditLogs: null }]) assert.throws(() => validateManifest({ ...fixture(), collectionCounts }, 'fixture'), /counts/);
});
test('restored store schema and all recorded collections must match', () => {
  const actual = { serverId: 'fixture', storeSchemaVersion: 3, collectionCounts: { ...counts } };
  compareMetadata(fixture(), actual);
  assert.throws(() => compareMetadata(fixture(), { ...actual, storeSchemaVersion: 2 }), /schema/);
  assert.throws(() => compareMetadata(fixture(), { ...actual, collectionCounts: { ...counts, commandReceipts: 0 } }), /commandReceipts/);
  assert.throws(() => compareMetadata(fixture(), { ...actual, collectionCounts: { ...counts, objectUploads: 0 } }), /objectUploads/);
});
test('verifies actual dump and archive hashes before restoration', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-backup-contract-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifest = fixture();
  manifest.hashes = {};
  for (const [file, key] of [['database.dump', 'databaseDumpSha256'], ['files.tar.gz', 'filesArchiveSha256']]) {
    fs.writeFileSync(path.join(directory, file), file);
    manifest.hashes[key] = crypto.createHash('sha256').update(file).digest('hex');
  }
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  assert.equal(verifyBackup(directory, 'fixture').serverId, 'fixture');
  fs.appendFileSync(path.join(directory, 'database.dump'), 'damage');
  assert.throws(() => verifyBackup(directory, 'fixture'), /hash mismatch/);
});
