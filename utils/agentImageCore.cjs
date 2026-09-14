'use strict';

const IMAGE_LIMITS = Object.freeze({
  count: 4,
  eachBytes: 4 * 1024 * 1024,
  totalBytes: 6 * 1024 * 1024,
});

const MIME_BY_EXTENSION = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

const ACCEPTED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

function imageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function inferMimeType(name = '') {
  const extension = String(name).split('.').pop()?.toLowerCase();
  return MIME_BY_EXTENSION[extension] || '';
}

function normalizePickedAssets(result) {
  if (result?.canceled) return [];
  const assets = Array.isArray(result?.assets) ? result.assets : [];
  return assets.map((asset) => {
    const uri = String(asset?.uri || '').trim();
    if (!uri) throw imageError('IMAGE_READ_FAILED', '选择的图片缺少可读取地址');
    const name = String(asset?.name || uri.split('/').pop() || 'image').trim();
    const mimeType = String(asset?.mimeType || inferMimeType(name)).toLowerCase();
    if (!ACCEPTED_MIME_TYPES.has(mimeType)) {
      throw imageError('IMAGE_TYPE_UNSUPPORTED', '仅支持 JPEG、PNG 和 WebP 图片');
    }
    const size = Number.isFinite(Number(asset?.size)) ? Math.max(0, Number(asset.size)) : 0;
    return { id: `${uri}:${size}`, uri, name, mimeType, size };
  });
}

function assertImageLimits(images) {
  if (images.length > IMAGE_LIMITS.count) {
    throw imageError('IMAGE_LIMIT_EXCEEDED', `每条消息最多发送 ${IMAGE_LIMITS.count} 张图片`);
  }
  let totalBytes = 0;
  for (const image of images) {
    const size = Number(image?.size) || 0;
    if (size > IMAGE_LIMITS.eachBytes) {
      throw imageError('IMAGE_TOO_LARGE', '单张图片不能超过 4 MB');
    }
    totalBytes += size;
  }
  if (totalBytes > IMAGE_LIMITS.totalBytes) {
    throw imageError('IMAGE_TOTAL_TOO_LARGE', '图片总大小不能超过 6 MB');
  }
  return images;
}

function appendImages(current = [], additions = []) {
  const seen = new Set();
  const next = [];
  for (const image of [...current, ...additions]) {
    if (!image?.id || seen.has(image.id)) continue;
    seen.add(image.id);
    next.push(image);
  }
  return assertImageLimits(next);
}

function removeImage(images = [], id) {
  return images.filter((image) => image?.id !== id);
}

async function prepareImagesForSend(images = [], readBase64) {
  assertImageLimits(images);
  if (typeof readBase64 !== 'function') {
    throw imageError('IMAGE_READ_FAILED', '图片读取器不可用');
  }
  const prepared = [];
  for (const image of images) {
    let base64;
    try {
      base64 = await readBase64(image.uri);
    } catch (cause) {
      const error = imageError('IMAGE_READ_FAILED', '读取图片失败');
      error.cause = cause;
      throw error;
    }
    if (typeof base64 !== 'string' || !base64) {
      throw imageError('IMAGE_READ_FAILED', '读取到的图片内容为空');
    }
    prepared.push({
      name: image.name,
      mimeType: image.mimeType,
      size: image.size,
      dataUrl: `data:${image.mimeType};base64,${base64}`,
    });
  }
  return prepared;
}

function canSendDraft(text, images = []) {
  return Boolean(String(text || '').trim() || images.length);
}

function imageOnlyBubbleText(count) {
  return `已发送 ${Number(count) || 0} 张图片`;
}

module.exports = {
  IMAGE_LIMITS,
  normalizePickedAssets,
  appendImages,
  removeImage,
  prepareImagesForSend,
  canSendDraft,
  imageOnlyBubbleText,
};
