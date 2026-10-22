'use strict';
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { integer } = require('./values');

function storedKey(reference) {
  const key = reference.fileKey || reference.file_key || reference.filePath;
  if (key) return String(key).replace(/\\/g, '/');
  const url = reference.fileUrl || reference.file_url || reference.url;
  if (typeof url === 'string' && url.startsWith('/api/files/')) return decodeURIComponent(url.slice('/api/files/'.length));
  return null;
}

async function auditFileReferences(references, uploadDirectory, add) {
  const cache = new Map();
  async function inspect(key) {
    const record = { key, sha256: null, size: null, referenceCount: 0 };
    if (!key || key.includes('\0') || /^[a-z]:|^\/|^[a-z]+:/i.test(key)
        || key.split('/').some(part => ['..', '.', ''].includes(part))) return { ...record, error: 'FILE_PATH_UNSAFE' };
    if (!uploadDirectory) return { ...record, error: 'UPLOAD_ROOT_REQUIRED' };
    try {
      const root = await fs.realpath(uploadDirectory);
      const filename = await fs.realpath(path.resolve(root, key));
      const relative = path.relative(root, filename);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { ...record, error: 'FILE_PATH_UNSAFE' };
      const before = await fs.stat(filename, { bigint: true });
      if (!before.isFile()) return { ...record, error: 'FILE_NOT_REGULAR' };
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(filename)) digest.update(chunk);
      const after = await fs.stat(filename, { bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) return { ...record, error: 'FILE_CHANGED_DURING_CHECK' };
      return { ...record, sha256: digest.digest('hex'), size: String(after.size) };
    } catch (error) { return { ...record, error: error.code === 'ENOENT' ? 'FILE_MISSING' : 'FILE_UNREADABLE' }; }
  }
  for (const reference of references) {
    const issue = (severity, code) => add(severity, code, reference.collection, reference.entityId, reference.field);
    let key;
    try { key = storedKey(reference); } catch (_) { issue('blocker', 'FILE_PATH_UNSAFE'); continue; }
    if (!key) {
      const url = reference.fileUrl || reference.file_url || reference.url;
      issue(typeof url === 'string' && /^https?:\/\//i.test(url) ? 'review' : 'blocker',
        typeof url === 'string' && /^https?:\/\//i.test(url) ? 'EXTERNAL_FILE_UNVERIFIED' : 'FILE_REFERENCE_EMPTY');
      continue;
    }
    if (!cache.has(key)) cache.set(key, await inspect(key));
    const record = cache.get(key);
    record.referenceCount += 1;
    if (record.error) { issue('blocker', record.error); continue; }
    if (reference.sha256 && String(reference.sha256).toLowerCase() !== record.sha256) issue('blocker', 'FILE_HASH_MISMATCH');
    if (reference.size != null) {
      try { if (integer(reference.size) !== BigInt(record.size)) throw Error('Size mismatch'); }
      catch (_) { issue('blocker', 'FILE_SIZE_MISMATCH'); }
    }
    const url = reference.fileUrl || reference.file_url;
    if (typeof url === 'string' && url.startsWith('/api/files/')) {
      try { if (decodeURIComponent(url.slice('/api/files/'.length)).replace(/\\/g, '/') !== key) issue('blocker', 'FILE_KEY_URL_MISMATCH'); }
      catch (_) { issue('blocker', 'FILE_KEY_URL_MISMATCH'); }
    }
  }
  return [...cache.values()];
}
module.exports = { auditFileReferences };
