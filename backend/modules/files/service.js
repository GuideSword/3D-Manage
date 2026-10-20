'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createLocalFileStorage } = require('./localStorage');
const { createBusinessCommands } = require('../../business-db/commands');
const { withAuthenticatedRead } = require('../../business-db/reads');
const { assertBusinessWritesAllowed } = require('../../business-db/maintenance');
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const MIME = Object.freeze({ '.stl': 'application/sla', '.obj': 'model/obj', '.3mf': 'model/3mf', '.step': 'model/step', '.stp': 'model/step', '.zip': 'application/zip', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf', '.csv': 'text/csv' });
async function createFileService(pool, { uploadDirectory, maxModelBytes = Number(process.env.MAX_UPLOAD_BYTES || 500 * 1024 * 1024) } = {}) {
  if (!Number.isSafeInteger(maxModelBytes) || maxModelBytes < 1) fail('FILE_CONFIGURATION_INVALID', '模型上传大小限制无效', 500);
  const storage = await createLocalFileStorage({ uploadDirectory });
  const limit = namespace => {
    if (!['models', 'images', 'attachments'].includes(namespace)) fail('FILE_NAMESPACE_INVALID', '上传文件用途无效');
    return namespace === 'models' ? maxModelBytes : (namespace === 'images' ? 25 : 50) * 1024 * 1024;
  };
  return Object.freeze({
    storage,
    limit,
    authorizeUpload: session => withAuthenticatedRead(pool, session, async (tx, actor) => {
      if (!['owner', 'staff'].includes(actor.role)) fail('BUSINESS_FORBIDDEN', '当前账号无权上传文件', 403);
      await assertBusinessWritesAllowed(tx);
      return actor;
    }),
    async complete(session, token, key) {
      const staged = storage.describe(token);
      // Staging tokens vary per HTTP attempt. Only stable byte metadata belongs in the receipt digest.
      const payload = { namespace: staged.namespace, originalName: staged.originalName, size: staged.size, sha256: staged.sha256 };
      const execute = createBusinessCommands(pool, { 'file.upload': { roles: ['owner', 'staff'], scope: 'file_uploads',
        async handle(tx, { actor, audit }) {
          const extension = path.extname(staged.originalName).toLowerCase();
          if (staged.namespace === 'images' || staged.namespace === 'attachments') {
            const prefix = await storage.inspectPrefix(token);
            const valid = extension === '.png' ? prefix.length >= 8 && prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : ['.jpg', '.jpeg'].includes(extension) ? prefix.length >= 3 && prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255
              : extension === '.webp' ? prefix.length >= 12 && prefix.toString('ascii', 0, 4) === 'RIFF' && prefix.toString('ascii', 8, 12) === 'WEBP'
              : extension === '.pdf' && /^%PDF-[12]\.\d/.test(prefix.toString('ascii'));
            if (!valid) fail('FILE_CONTENT_INVALID', '文件内容与图片或PDF扩展名不符');
          }
          const published = await storage.publish(token), uploadId = randomUUID();
          const metadata = { uploadId, fileKey: published.fileKey, fileUrl: `/api/files/${published.fileKey}`,
            name: staged.originalName, originalName: staged.originalName, size: published.size, sha256: published.sha256,
            fileType: path.extname(staged.originalName).slice(1).toLowerCase(), mimeType: MIME[path.extname(staged.originalName).toLowerCase()] || 'application/octet-stream' };
          await tx.query('INSERT INTO erp.object_uploads(id,owner_id,file_key,metadata) VALUES($1,$2,$3,$4)', [uploadId, actor.id, metadata.fileKey, JSON.stringify(metadata)]);
          await audit({ entity: 'objectUploads', entityId: uploadId, action: 'upload', diff: metadata });
          return { status: 201, body: metadata };
        },
      } });
      return execute({ actorId: session.actorId, tokenVersion: session.tokenVersion, key, operation: 'file.upload', payload });
    },
    async open(session, key) {
      await withAuthenticatedRead(pool, session, async () => {});
      return storage.open(key);
    },
  });
}
module.exports = { createFileService, FILE_MIME_TYPES: MIME };
