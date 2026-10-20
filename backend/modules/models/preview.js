'use strict';
const path = require('node:path');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { createLocalFileStorage } = require('../files/localStorage');
const { extract3mfThumbnail, imageExtension, MAX_IMAGE_BYTES } = require('./thumbnail3mf');
const { createModelPreview } = require('../../utils/modelPreview');

function createAutoPreviewPublisher({ uploadDirectory } = {}) {
  let pendingStorage;
  const storage = () => pendingStorage ||= createLocalFileStorage({ uploadDirectory });
  return async source => {
    const extension = path.extname(source.fileKey).toLowerCase();
    if (extension !== '.3mf' && process.platform !== 'win32') return { file: null };
    let local, token;
    try {
      local = await storage();
      const reader = await local.open(source.fileKey); let preview;
      try {
        if (extension === '.3mf') preview = await extract3mfThumbnail(reader);
        if (!preview && process.platform === 'win32') preview = await createModelPreview({ fileBuffer: Buffer.alloc(0), originalName: source.originalName || source.name || source.fileKey, fullPath: reader.fullPath });
      } finally { await reader.close(); }
      if (!preview) return { file: null };
      if (!Buffer.isBuffer(preview.buffer) || !preview.buffer.length || preview.buffer.length > MAX_IMAGE_BYTES
          || imageExtension(preview.buffer) !== preview.extension) throw new Error('Preview output invalid');
      const base = path.basename(String(source.originalName || source.name || 'model').replaceAll('\\', '/')).replace(/\.[^.]*$/, '').replace(/[\x00-\x1f]/g, '_').slice(0, 900) || 'model';
      const originalName = `${base}-preview.${preview.extension}`;
      const staged = await local.stage(Readable.from([preview.buffer]), { namespace: 'images', originalName, maxBytes: MAX_IMAGE_BYTES });
      token = staged.token;
      const published = await local.publish(token);
      return { file: { uploadId: randomUUID(), fileKey: published.fileKey, fileUrl: `/api/files/${published.fileKey}`,
        name: originalName, originalName, size: published.size, sha256: published.sha256, fileType: preview.extension,
        mimeType: preview.extension === 'png' ? 'image/png' : 'image/jpeg', type: 'auto_preview', sourceFileId: source.id, previewSource: preview.source } };
    } catch (_) {
      return { file: null, warning: '自动预览生成失败，源文件已保存，可手动添加图片' };
    } finally {
      // Only this attempt's private temporary copy is removed; published shared bytes stay intact.
      if (local && token) await local.discard(token);
    }
  };
}
module.exports = { createAutoPreviewPublisher };
