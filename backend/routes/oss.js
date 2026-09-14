const express = require('express');
const router = express.Router();
const {
  testConnection,
  generateUploadUrl,
  generateDownloadUrl,
  completeUpload,
  deleteObject,
} = require('../config/oss');
const { requireRoles } = require('../middleware/auth');
const { z } = require('zod');
const { parseRequest } = require('../utils/validation');
const { randomUUID } = require('node:crypto');
const { withData, appendAudit, now } = require('../utils/store');
const { publicErrorMessage } = require('../utils/publicError');

const sensitiveFields = ['config', 'accessKeyId', 'accessKeySecret', 'secretAccessKey'];

const rejectSensitiveConfig = (req, res) => {
  const supplied = sensitiveFields.filter((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key));
  if (supplied.length === 0) return false;
  res.status(400).json({
    code: 'SENSITIVE_CONFIG_NOT_ACCEPTED',
    error: '对象存储凭证只能在服务器端配置',
  });
  return true;
};

const objectKeySchema = z.string().trim().min(1).max(1024);
const uploadUrlSchema = z.object({
  purpose: z.enum(['model-file', 'model-image', 'order-attachment']),
  entityId: z.string().trim().min(1).max(200),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(Number.parseInt(process.env.MAX_UPLOAD_BYTES, 10) || 100 * 1024 * 1024),
  expire: z.number().int().min(1).max(600).default(600),
}).strict();
const downloadUrlSchema = z.object({
  objectKey: objectKeySchema,
  expire: z.number().int().min(1).max(3600).default(3600),
}).strict();
const completeSchema = z.object({ uploadId: z.string().uuid() }).strict();
const objectSchema = z.object({ objectKey: objectKeySchema }).strict();
const emptySchema = z.object({}).strict();

const sanitizeObjectName = (value) => String(value)
  .replace(/[^a-zA-Z0-9._-]/g, '_')
  .replace(/^\.+/, '')
  .slice(0, 180) || 'file';

const findEntity = (data, purpose, entityId) => {
  if (purpose === 'model-file' || purpose === 'model-image') {
    return data.models.find((item) => item.id === String(entityId));
  }
  return data.orders.find((item) => item.id === String(entityId));
};

const isRegisteredObject = (data, objectKey) => {
  if (data.objectUploads.some((item) => item.objectKey === objectKey && item.status === 'completed')) {
    return true;
  }
  if (data.models.some((model) => [
    ...(model.files || []),
    ...(model.images || []),
  ].some((file) => file.fileKey === objectKey))) {
    return true;
  }
  return data.orders.some((order) => (order.attachments || []).some((file) => file.fileKey === objectKey));
};

router.post('/test-connection', requireRoles('owner'), async (req, res) => {
  if (rejectSensitiveConfig(req, res)) return undefined;
  const input = parseRequest(emptySchema, req.body || {}, res);
  if (!input) return undefined;
  try {
    const result = await testConnection({
      skipNetwork: process.env.NODE_ENV === 'test' && process.env.OSS_TEST_SKIP_NETWORK === 'true',
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: publicErrorMessage(error, '对象存储连接测试失败') });
  }
});

router.post('/upload-url', requireRoles('owner', 'staff'), async (req, res) => {
  if (rejectSensitiveConfig(req, res)) return undefined;
  const input = parseRequest(uploadUrlSchema, req.body, res);
  if (!input) return undefined;
  try {
    const pending = await withData((data) => {
      if (!findEntity(data, input.purpose, input.entityId)) {
        return null;
      }
      const uploadId = randomUUID();
      const objectKey = [
        'uploads',
        input.purpose,
        String(input.entityId),
        `${uploadId}-${sanitizeObjectName(input.fileName)}`,
      ].join('/');
      const upload = {
        id: uploadId,
        objectKey,
        purpose: input.purpose,
        entityId: String(input.entityId),
        fileName: input.fileName,
        contentType: input.contentType,
        size: input.size,
        status: 'pending',
        createdBy: String(req.user.id),
        createdAt: now(),
        completedAt: null,
      };
      data.objectUploads.push(upload);
      appendAudit(data, {
        actorId: String(req.user.id),
        entity: 'objectUploads',
        entityId: upload.id,
        action: 'sign.upload',
        diff: { objectKey, purpose: input.purpose, entityId: input.entityId, size: input.size },
      });
      return upload;
    });
    if (!pending) {
      return res.status(404).json({ code: 'UPLOAD_ENTITY_NOT_FOUND', error: '上传目标不存在' });
    }
    const result = await generateUploadUrl(pending.objectKey, input.expire);
    return res.json({ ...result, uploadId: pending.id });
  } catch (error) {
    return res.status(400).json({ code: error.code || 'OSS_UPLOAD_SIGN_FAILED', error: publicErrorMessage(error, '生成上传地址失败') });
  }
});

router.post('/download-url', requireRoles('owner', 'staff', 'viewer'), async (req, res) => {
  if (rejectSensitiveConfig(req, res)) return undefined;
  const input = parseRequest(downloadUrlSchema, req.body, res);
  if (!input) return undefined;
  try {
    const registered = await withData((data) => isRegisteredObject(data, input.objectKey), { write: false });
    if (!registered) {
      return res.status(404).json({ code: 'OBJECT_NOT_REGISTERED', error: '对象尚未登记' });
    }
    const result = await generateDownloadUrl(input.objectKey, input.expire);
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ code: error.code || 'OSS_DOWNLOAD_SIGN_FAILED', error: publicErrorMessage(error, '生成下载地址失败') });
  }
});

router.post('/complete-upload', requireRoles('owner', 'staff'), async (req, res) => {
  if (rejectSensitiveConfig(req, res)) return undefined;
  const input = parseRequest(completeSchema, req.body, res);
  if (!input) return undefined;
  try {
    const pending = await withData((data) => data.objectUploads.find((item) => item.id === input.uploadId), { write: false });
    if (!pending || pending.status !== 'pending') {
      return res.status(404).json({ code: 'PENDING_UPLOAD_NOT_FOUND', error: '待完成的上传记录不存在' });
    }
    if (pending.createdBy !== String(req.user.id) && req.user.role !== 'owner') {
      return res.status(403).json({ code: 'UPLOAD_OWNER_MISMATCH', error: '该上传记录属于其他用户' });
    }
    const result = await completeUpload(pending.objectKey, {
      skipNetwork: process.env.NODE_ENV === 'test' && process.env.OSS_TEST_SKIP_NETWORK === 'true',
      size: pending.size,
      contentType: pending.contentType,
    });
    if (result.size !== pending.size || result.contentType !== pending.contentType) {
      return res.status(409).json({ code: 'UPLOAD_METADATA_MISMATCH', error: '已上传对象信息与待上传记录不一致' });
    }
    const completed = await withData((data) => {
      const upload = data.objectUploads.find((item) => item.id === input.uploadId);
      if (!upload || upload.status !== 'pending') return null;
      upload.status = 'completed';
      upload.completedAt = now();
      upload.etag = result.etag;
      appendAudit(data, {
        actorId: String(req.user.id),
        entity: 'objectUploads',
        entityId: upload.id,
        action: 'complete',
        diff: { objectKey: upload.objectKey, size: upload.size, contentType: upload.contentType },
      });
      return upload;
    });
    if (!completed) {
      return res.status(409).json({ code: 'UPLOAD_ALREADY_COMPLETED', error: '该上传已完成' });
    }
    return res.json({ ...result, uploadId: completed.id });
  } catch (error) {
    return res.status(400).json({ code: error.code || 'OSS_UPLOAD_COMPLETE_FAILED', error: publicErrorMessage(error, '确认上传失败') });
  }
});

router.delete('/object', requireRoles('owner'), async (req, res) => {
  if (rejectSensitiveConfig(req, res)) return undefined;
  const input = parseRequest(objectSchema, req.body, res);
  if (!input) return undefined;
  try {
    const registered = await withData((data) => isRegisteredObject(data, input.objectKey), { write: false });
    if (!registered) {
      return res.status(404).json({ code: 'OBJECT_NOT_REGISTERED', error: '对象尚未登记' });
    }
    const result = await deleteObject(input.objectKey);
    await withData((data) => {
      data.objectUploads = data.objectUploads.filter((item) => item.objectKey !== input.objectKey);
      appendAudit(data, {
        actorId: String(req.user.id),
        entity: 'objectUploads',
        entityId: input.objectKey,
        action: 'delete',
        diff: { objectKey: input.objectKey },
      });
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ code: error.code || 'OSS_DELETE_FAILED', error: publicErrorMessage(error, '删除对象失败') });
  }
});

module.exports = router;
