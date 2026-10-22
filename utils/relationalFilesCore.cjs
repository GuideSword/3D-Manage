'use strict';
const { supportsMasterData, createRelationalRequest, recordVersion } = require('./masterDataCore.cjs');
const fail = (message, code = 'FILE_CLIENT_INVALID') => { throw Object.assign(new Error(message), { code, ...(code === 'FILE_CLIENT_INVALID' ? { status: 400 } : {}) }); };
const TYPES = Object.freeze({ models: ['stl', 'obj', '3mf', 'step', 'stp', 'zip'], images: ['png', 'jpg', 'jpeg', 'webp'], attachments: ['png', 'jpg', 'jpeg', 'pdf'] });
function namespace(value) {
  if (!Object.hasOwn(TYPES, value)) fail('文件用途无效');
  return value;
}
function extension(name) { return typeof name === 'string' ? name.split('.').pop().toLowerCase() : ''; }
function filename(name) { return typeof name === 'string' && name.length > 0 && name.length <= 1000 && !/[\\/\x00-\x1f\x7f]/.test(name); }
function validateFileAsset(kind, file) {
  namespace(kind);
  if (!file || !filename(file.name) || !TYPES[kind].includes(extension(file.name))) fail('文件格式不支持，请重新选择');
  const blob = typeof Blob !== 'undefined' && file instanceof Blob;
  if (!blob && (typeof file.uri !== 'string' || !file.uri)) fail('文件无法读取，请重新选择');
  const limit = (kind === 'models' ? 500 : kind === 'images' ? 25 : 50) * 1024 * 1024;
  if (file.size != null && (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > limit)) fail('文件为空或超过上传大小限制');
  return file;
}
function validateUploadedFile(kind, value) {
  namespace(kind);
  const invalid = () => fail('上传结果未能确认，请重试原文件', 'FILE_UPLOAD_RESULT_INVALID');
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ['id', 'createdAt', 'position', 'modelId', 'url', 'filePath', 'file_key', 'file_url'].some(key => Object.hasOwn(value, key))
      || typeof value.uploadId !== 'string' || !value.uploadId || !filename(value.originalName) || value.name !== value.originalName
      || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
      || typeof value.size !== 'string' || !/^[1-9]\d*$/.test(value.size)
      || !TYPES[kind].includes(value.fileType) || value.fileType !== extension(value.originalName)
      || value.fileKey !== `${kind}/${value.sha256}.${value.fileType}` || value.fileUrl !== `/api/files/${value.fileKey}`
      || typeof value.mimeType !== 'string' || !value.mimeType) invalid();
  return value;
}
function fields(input, allowed, required) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(input, key))) fail('文件操作参数无效');
}
function identity(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 500) fail('记录标识无效');
  return encodeURIComponent(id);
}
function expectedVersion(value) {
  const version = recordVersion(value);
  if (version === '9223372036854775807') fail('记录版本无效，请重新加载');
  return version;
}
function association(entity, child) {
  if (entity === 'models' && ['files', 'images'].includes(child)) return child === 'files' ? 'models' : 'images';
  if (entity === 'orders' && child === 'attachments') return 'attachments';
  fail('文件关联用途无效');
}
function createRelationalFilesApi({ request, getRuntime, createMultipart = file => { const body = new FormData(); if (typeof Blob !== 'undefined' && file instanceof Blob) body.append('file', file, file.name); else body.append('file', file); return body; } }) {
  const call = createRelationalRequest({ request, getRuntime });
  return Object.freeze({
    upload(kind, file, key) {
      if (!supportsMasterData(getRuntime())) fail('当前服务器尚未启用文件维护', 'MASTER_DATA_UNAVAILABLE');
      namespace(kind); validateFileAsset(kind, file);
      if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) fail('缺少有效的操作标识');
      return Promise.resolve(request(`/uploads/${kind}`, { method: 'POST', headers: { 'X-Business-Rules-Version': '2', 'Idempotency-Key': key }, body: createMultipart(file), timeoutMs: 10 * 60 * 1000 }))
        .then(result => validateUploadedFile(kind, result));
    },
    add(entity, id, child, input, key) {
      const kind = association(entity, child); fields(input, ['version', 'file'], ['version', 'file']);
      validateUploadedFile(kind, input.file);
      return call(`/${entity}/${identity(id)}/${child}/add`, 'POST', { version: expectedVersion(input.version), file: input.file }, key);
    },
    remove(entity, id, child, input, key) {
      association(entity, child);
      const field = entity === 'orders' ? 'position' : 'childId';
      fields(input, ['version', field], ['version', field]);
      if (field === 'position') { if (!Number.isSafeInteger(input.position) || input.position < 0) fail('附件位置无效'); }
      else identity(input.childId);
      return call(`/${entity}/${identity(id)}/${child}/remove`, 'POST', { version: expectedVersion(input.version), [field]: input[field] }, key);
    },
  });
}
module.exports = { validateFileAsset, validateUploadedFile, createRelationalFilesApi };
