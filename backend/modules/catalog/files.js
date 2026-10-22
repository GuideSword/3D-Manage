'use strict';
const { randomUUID } = require('node:crypto');
const { auditFileReferences } = require('../../business-db/preflight/files');
const v = require('./validation');

async function verifyUploadedFile(file, uploadDirectory) {
  if (!file || typeof file !== 'object' || Array.isArray(file)
      || ['id', 'createdAt', 'position', 'modelId', 'file_key', 'file_url', 'url', 'filePath'].some(key => Object.hasOwn(file, key))) {
    v.fail('请提供上传后的文件资料，文件标识由服务器生成');
  }
  const fileKey = v.string(file.fileKey, { required: true, max: 2000 });
  if (!uploadDirectory) v.fail('文件存储目录尚未配置', 'FILE_STORAGE_UNAVAILABLE', 500);
  const issues = [];
  const records = await auditFileReferences([{ ...file, ...(typeof file.size === 'number' ? { size: String(file.size) } : {}), fileKey,
    collection: 'files', entityId: 'registration', field: 'fileKey' }], uploadDirectory,
  (severity, code) => issues.push({ severity, code }));
  if (issues.length || records.length !== 1 || records[0].error) v.fail('文件路径、内容或校验值不一致，请重新上传', 'FILE_REFERENCE_INVALID');
  const record = records[0];
  return { ...file, id: randomUUID(), fileKey: record.key,
    fileUrl: `/api/files/${record.key.split('/').map(encodeURIComponent).join('/')}`,
    size: record.size, sha256: record.sha256, createdAt: new Date().toISOString() };
}
function fileMetadata(raw) {
  const metadata = v.legacy(raw);
  if (typeof metadata.size === 'string' && /^\d+$/.test(metadata.size) && Number.isSafeInteger(Number(metadata.size))) metadata.size = Number(metadata.size);
  return metadata;
}
module.exports = { verifyUploadedFile, fileMetadata };
