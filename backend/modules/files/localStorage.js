'use strict';
const fs = require('node:fs/promises');
const { createWriteStream, constants } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const EXTENSIONS = Object.freeze({
  models: new Set(['.stl', '.obj', '.3mf', '.step', '.stp', '.zip']),
  images: new Set(['.png', '.jpg', '.jpeg', '.webp']),
  attachments: new Set(['.png', '.jpg', '.jpeg', '.pdf']),
});
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
function safeKey(input, privatePath = false) {
  if (typeof input !== 'string' || input.length > 2000 || /[\x00-\x1f:%?#]/.test(input)) fail('FILE_PATH_UNSAFE', '无权访问该文件', 403);
  const key = input.replace(/\\/g, '/'), parts = key.split('/');
  if (!key || parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)
    || /^agent$/i.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    || part.startsWith('.') && !(privatePath && part === '.staging'))) fail('FILE_PATH_UNSAFE', '无权访问该文件', 403);
  return key;
}
function parseByteRange(value, size) {
  if (!Number.isSafeInteger(size) || size < 0) fail('FILE_SIZE_INVALID', '文件大小无效', 500);
  if (value === undefined || value === null) return { start: 0, end: size - 1, length: size, partial: false };
  const invalid = () => fail('FILE_RANGE_INVALID', '请求的文件范围无效', 416);
  if (typeof value !== 'string' || value.length > 128 || !size) return invalid();
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || !match[1] && !match[2]) return invalid();
  const total = BigInt(size);
  let start, end;
  if (!match[1]) {
    const suffix = BigInt(match[2]); if (!suffix) return invalid();
    start = suffix >= total ? 0n : total - suffix; end = total - 1n;
  } else {
    start = BigInt(match[1]); end = match[2] ? BigInt(match[2]) : total - 1n;
    if (start >= total || end < start) return invalid();
    if (end >= total) end = total - 1n;
  }
  return { start: Number(start), end: Number(end), length: Number(end - start + 1n), partial: true };
}
async function createLocalFileStorage({ uploadDirectory } = {}) {
  if (typeof uploadDirectory !== 'string' || !uploadDirectory.trim() || !path.isAbsolute(uploadDirectory)) fail('FILE_STORAGE_UNAVAILABLE', '必须显式提供绝对文件目录', 500);
  await fs.mkdir(uploadDirectory, { recursive: true });
  const root = await fs.realpath(uploadDirectory), staged = new Map();
  const inside = filename => {
    const relative = path.relative(root, filename);
    return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  async function directory(name) {
    const target = path.join(root, name);
    await fs.mkdir(target, { recursive: true });
    const stat = await fs.lstat(target), actual = await fs.realpath(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || actual !== target || !inside(actual)) fail('FILE_PATH_UNSAFE', '文件目录不安全', 403);
    return target;
  }
  await directory('.staging');
  async function openVerified(key, privatePath = false) {
    const relative = safeKey(key, privatePath);
    let handle;
    try {
      const filename = await fs.realpath(path.join(root, relative));
      if (!inside(filename)) fail('FILE_PATH_UNSAFE', '无权访问该文件', 403);
      handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile()) fail('FILE_NOT_REGULAR', '该路径不是普通文件', 403);
      const actual = await fs.realpath(path.join(root, relative));
      if (!inside(actual)) fail('FILE_PATH_UNSAFE', '无权访问该文件', 403);
      const current = await fs.stat(actual, { bigint: true });
      if (current.dev !== stat.dev || current.ino !== stat.ino) fail('FILE_CHANGED', '文件已变化，请重试', 409);
      if (stat.size > BigInt(Number.MAX_SAFE_INTEGER)) fail('FILE_SIZE_INVALID', '文件大小超出支持范围', 500);
      return { handle, stat, size: Number(stat.size), filename };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error.code === 'ENOENT') fail('FILE_NOT_FOUND', '文件不存在', 404);
      if (error.code === 'ELOOP') fail('FILE_PATH_UNSAFE', '无权访问该文件', 403);
      throw error;
    }
  }
  async function hashFile(key, privatePath = false) {
    const file = await openVerified(key, privatePath);
    try {
      const digest = createHash('sha256');
      for await (const chunk of file.handle.createReadStream({ autoClose: false })) digest.update(chunk);
      const after = await file.handle.stat({ bigint: true });
      if (after.size !== file.stat.size || after.mtimeNs !== file.stat.mtimeNs) fail('FILE_CHANGED', '文件校验期间内容变化', 409);
      return { size: String(after.size), sha256: digest.digest('hex') };
    } finally { await file.handle.close(); }
  }
  function entry(token) {
    if (typeof token !== 'string' || !staged.has(token)) fail('FILE_STAGE_INVALID', '上传临时文件已失效');
    return staged.get(token);
  }
  async function removeTemporary(item) {
    await directory('.staging');
    await fs.unlink(path.join(root, item.temporaryKey)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return Object.freeze({
    root,
    async stage(stream, { namespace, originalName, maxBytes, signal } = {}) {
      if (!Object.hasOwn(EXTENSIONS, namespace) || typeof originalName !== 'string' || !originalName || originalName.length > 1000
        || /[\\/\x00-\x1f]/.test(originalName) || !EXTENSIONS[namespace].has(path.extname(originalName).toLowerCase())
        || !Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('FILE_UPLOAD_INVALID', '上传文件类型、名称或大小限制无效');
      await directory('.staging');
      const token = randomUUID(), temporaryKey = `.staging/${token}.upload`, temporary = { temporaryKey };
      const digest = createHash('sha256'); let size = 0;
      const counter = new Transform({ transform(chunk, encoding, callback) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        size += bytes.length;
        if (size > maxBytes) return callback(Object.assign(new Error('上传文件超过大小限制'), { code: 'FILE_TOO_LARGE', status: 413 }));
        digest.update(bytes); callback(null, bytes);
      } });
      try {
        await pipeline(stream, counter, createWriteStream(path.join(root, temporaryKey), { flags: 'wx', mode: 0o600 }), { signal });
        if (!size) fail('FILE_EMPTY', '上传文件不能为空');
        const item = { temporaryKey, namespace, originalName, extension: path.extname(originalName).toLowerCase(), size: String(size), sha256: digest.digest('hex') };
        staged.set(token, item);
        return Object.freeze({ token, size: item.size, sha256: item.sha256, originalName });
      } catch (error) {
        try { await removeTemporary(temporary); } catch (_) { error.cleanupError = true; }
        throw error;
      }
    },
    async inspectPrefix(token, length = 32) {
      const item = entry(token);
      if (!Number.isSafeInteger(length) || length < 1 || length > 512) fail('FILE_INSPECTION_INVALID', '文件检查长度无效');
      const file = await openVerified(item.temporaryKey, true);
      try {
        const buffer = Buffer.alloc(Math.min(length, file.size));
        const result = await file.handle.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, result.bytesRead);
      } finally { await file.handle.close(); }
    },
    describe(token) {
      const item = entry(token);
      return Object.freeze({ token, namespace: item.namespace, originalName: item.originalName, size: item.size, sha256: item.sha256 });
    },
    async publish(token) {
      const item = entry(token);
      if (item.result) return item.result;
      await directory('.staging'); await directory(item.namespace);
      const checked = await hashFile(item.temporaryKey, true);
      if (checked.size !== item.size || checked.sha256 !== item.sha256) fail('FILE_CONTENT_CONFLICT', '上传临时内容校验不一致', 409);
      const fileKey = `${item.namespace}/${item.sha256}${item.extension}`;
      let created = false;
      try { await fs.link(path.join(root, item.temporaryKey), path.join(root, fileKey)); created = true; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await hashFile(fileKey);
        if (existing.size !== item.size || existing.sha256 !== item.sha256) fail('FILE_CONTENT_CONFLICT', '已存在文件校验不一致，未覆盖原文件', 409);
      }
      item.result = Object.freeze({ fileKey, originalName: item.originalName, size: item.size, sha256: item.sha256, created });
      await removeTemporary(item);
      return item.result;
    },
    async discard(token) {
      const item = entry(token);
      await removeTemporary(item); staged.delete(token);
    },
    async open(key) {
      const file = await openVerified(key); let streaming = false;
      return { size: file.size, modifiedAt: new Date(Number(file.stat.mtimeMs)), fullPath: file.filename,
        async readAt(position, length) {
          if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || position < 0 || length < 0
              || length > 8 * 1024 * 1024 || position + length > file.size) fail('FILE_READ_RANGE_INVALID', '文件读取范围无效', 400);
          const unchanged = async () => {
            const stat = await file.handle.stat({ bigint: true });
            if (stat.size !== file.stat.size || stat.mtimeNs !== file.stat.mtimeNs) fail('FILE_CHANGED', '文件读取期间内容变化', 409);
          };
          await unchanged();
          const buffer = Buffer.alloc(length); let offset = 0;
          while (offset < length) {
            const { bytesRead } = await file.handle.read(buffer, offset, length - offset, position + offset);
            if (!bytesRead) fail('FILE_CHANGED', '文件读取期间内容变化', 409);
            offset += bytesRead;
          }
          await unchanged(); return buffer;
        },
        createReadStream(range) {
          if (streaming) fail('FILE_STREAM_USED', '文件读取流已使用', 500);
          const parsed = parseByteRange(range, file.size); streaming = true;
          if (!parsed.length) { file.handle.close(); return Readable.from([]); }
          return file.handle.createReadStream({ start: parsed.start, end: parsed.end, autoClose: true });
        },
        close: () => file.handle.close(),
      };
    },
  });
}
module.exports = { createLocalFileStorage, parseByteRange };
