'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CURRENT_SCHEMA_VERSION, API_VERSION } = require('../backend/config/runtime');
const requiredCollections = ['users', 'orders', 'models', 'materials', 'stockLots', 'inventoryTxns', 'auditLogs'];
function validateManifest(manifest, confirmedServerId) {
  if (manifest.status !== 'complete' || !manifest.serverId || manifest.serverId !== confirmedServerId) throw new Error('Incompatible or unconfirmed backup');
  if (!Number.isInteger(manifest.storeSchemaVersion) || manifest.storeSchemaVersion < 1 || manifest.storeSchemaVersion > CURRENT_SCHEMA_VERSION || manifest.postgresMajor !== 16 || manifest.apiVersion !== API_VERSION) throw new Error('Backup schema, API or PostgreSQL major is incompatible');
  const counts = manifest.collectionCounts;
  if (!counts || Array.isArray(counts) || requiredCollections.some((key) => !Object.hasOwn(counts, key)) || Object.values(counts).some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error('Invalid backup collection counts');
  if (!/^[a-f0-9]{16}$/.test(manifest.encryptionKeyId || '')) throw new Error('Invalid backup encryption key identity');
  return manifest;
}
function verifyBackup(directory, confirmedServerId) {
  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')), confirmedServerId);
  for (const [file, key] of [['database.dump', 'databaseDumpSha256'], ['files.tar.gz', 'filesArchiveSha256']]) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex');
    if (actual !== manifest.hashes?.[key]) throw new Error(file + ' hash mismatch');
  }
  return manifest;
}
function compareMetadata(manifest, actual) {
  if (actual.serverId !== manifest.serverId || actual.storeSchemaVersion !== manifest.storeSchemaVersion) throw new Error('Isolated restore identity or schema mismatch');
  for (const [key, count] of Object.entries(manifest.collectionCounts)) {
    if (actual.collectionCounts?.[key] !== count) throw new Error('Isolated restore count mismatch: ' + key);
  }
}
module.exports = { validateManifest, verifyBackup, compareMetadata };
if (require.main === module) {
  try {
    const [, , command, directory, serverId, metadata] = process.argv;
    const manifest = verifyBackup(directory, serverId);
    if (command === 'compare') compareMetadata(manifest, JSON.parse(metadata));
    else if (command !== 'verify') throw new Error('Unknown backup verification command');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
