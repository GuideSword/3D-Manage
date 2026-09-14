'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sqliteDb = require('../db/agent');
const { UPLOAD_DIR } = require('../config/storage');

const DEFAULT_ROOT = path.resolve(UPLOAD_DIR, 'agent');
const EXTENSION_BY_MIME = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
});
const STORAGE_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/i;

function notFound() {
  const error = new Error('附件不存在');
  error.code = 'ATTACHMENT_NOT_FOUND';
  error.status = 404;
  return error;
}

function storagePath(storageName, rootDir = DEFAULT_ROOT) {
  if (!STORAGE_NAME_RE.test(String(storageName || ''))) throw notFound();
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, storageName);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw notFound();
  return resolved;
}

async function prepareMessageImages({ images = [], userId, conversationId, messageId, rootDir = DEFAULT_ROOT }) {
  const root = path.resolve(rootDir);
  await fs.mkdir(root, { recursive: true });
  const prepared = [];
  try {
    for (const image of images) {
      const extension = EXTENSION_BY_MIME[image.mimeType];
      if (!extension || !Buffer.isBuffer(image.buffer)) throw new Error('缺少已校验的图片数据');
      const id = crypto.randomUUID();
      const storageName = `${crypto.randomUUID()}${extension}`;
      const fullPath = storagePath(storageName, root);
      const temporaryPath = `${fullPath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporaryPath, image.buffer, { flag: 'wx' });
      await fs.rename(temporaryPath, fullPath);
      prepared.push({
        id,
        user_id: String(userId),
        conversation_id: String(conversationId),
        message_id: String(messageId),
        display_name: String(image.name || 'image').slice(0, 255),
        mime_type: image.mimeType,
        byte_size: image.byteSize || image.buffer.length,
        sha256: crypto.createHash('sha256').update(image.buffer).digest('hex'),
        storage_name: storageName,
        description: '',
        fullPath,
      });
    }
    return prepared;
  } catch (error) {
    await discardPreparedImages(prepared, { rootDir: root });
    throw error;
  }
}

async function discardPreparedImages(prepared = [], { rootDir = DEFAULT_ROOT } = {}) {
  await Promise.all(prepared.map(async (item) => {
    try { await fs.unlink(storagePath(item.storage_name, rootDir)); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }));
}

async function readOwnedAttachment({ attachmentId, userId, conversationId, db = sqliteDb, rootDir = DEFAULT_ROOT }) {
  const metadata = db.getOwnedAttachment(String(attachmentId), String(userId), String(conversationId));
  if (!metadata || metadata.status === 'delete_pending') throw notFound();
  try {
    const buffer = await fs.readFile(storagePath(metadata.storage_name, rootDir));
    return { metadata, buffer };
  } catch (_) {
    throw notFound();
  }
}

async function deleteConversationAttachments(attachments = [], { db = sqliteDb, rootDir = DEFAULT_ROOT, unlink = fs.unlink } = {}) {
  let cleanupPending = false;
  for (const attachment of attachments) {
    try {
      await unlink(storagePath(attachment.storage_name, rootDir));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      cleanupPending = true;
      db.queueAttachmentCleanup(attachment.id, attachment.storage_name, error?.code || error?.message || 'unlink_failed');
    }
  }
  return { cleanupPending };
}

async function retryPendingAttachmentCleanup({ limit = 25, db = sqliteDb, rootDir = DEFAULT_ROOT, unlink = fs.unlink } = {}) {
  let removed = 0;
  let failed = 0;
  for (const item of db.listAttachmentCleanup(limit)) {
    try {
      await unlink(storagePath(item.storage_name, rootDir));
      db.removeAttachmentCleanup(item.attachment_id);
      removed += 1;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        db.removeAttachmentCleanup(item.attachment_id);
        removed += 1;
      } else {
        db.queueAttachmentCleanup(item.attachment_id, item.storage_name, error?.code || 'unlink_failed');
        failed += 1;
      }
    }
  }
  return { removed, failed };
}

module.exports = {
  DEFAULT_ROOT,
  deleteConversationAttachments,
  discardPreparedImages,
  prepareMessageImages,
  readOwnedAttachment,
  retryPendingAttachmentCleanup,
  storagePath,
};
