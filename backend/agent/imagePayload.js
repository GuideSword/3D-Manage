'use strict';

const IMAGE_LIMITS = Object.freeze({
  count: 4,
  eachBytes: 4 * 1024 * 1024,
  totalBytes: 6 * 1024 * 1024,
});

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function isSignatureValid(buffer, mimeType) {
  if (mimeType === 'image/png') {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return false;
}

function decodeImage(image) {
  const match = DATA_URL_RE.exec(image?.dataUrl || '');
  if (!match || match[2].length % 4 === 1) {
    fail('IMAGE_PAYLOAD_INVALID', '图片数据格式无效');
  }
  const [, mimeType, encoded] = match;
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    fail('IMAGE_PAYLOAD_INVALID', '图片 Base64 数据无效');
  }
  if (image?.mimeType && image.mimeType !== mimeType) {
    fail('IMAGE_TYPE_UNSUPPORTED', '图片类型声明不一致');
  }
  if (!isSignatureValid(buffer, mimeType)) {
    fail('IMAGE_TYPE_UNSUPPORTED', '图片内容与声明类型不一致');
  }
  if (buffer.length > IMAGE_LIMITS.eachBytes) {
    fail('IMAGE_TOO_LARGE', '单张图片不能超过 4 MB');
  }
  return {
    buffer,
    dataUrl: image.dataUrl,
    name: String(image?.name || 'image').slice(0, 255),
    mimeType,
    byteSize: buffer.length,
  };
}

function parseAgentImages(images = [], visionStatus = 'untested') {
  if (!Array.isArray(images)) fail('IMAGE_PAYLOAD_INVALID', 'images 必须是数组');
  if (images.length > IMAGE_LIMITS.count) {
    fail('IMAGE_LIMIT_EXCEEDED', `每条消息最多发送 ${IMAGE_LIMITS.count} 张图片`);
  }
  if (images.length && visionStatus !== 'vision') {
    fail(
      visionStatus === 'untested' ? 'IMAGE_CAPABILITY_UNTESTED' : 'IMAGE_CAPABILITY_UNSUPPORTED',
      visionStatus === 'untested'
        ? '尚未验证当前模型的图片能力'
        : visionStatus === 'text_only'
          ? '您选择的模型不是多模态大模型'
          : '图片能力验证失败，请在 AI 服务设置中重新测试',
      422
    );
  }
  const decoded = images.map(decodeImage);
  const total = decoded.reduce((sum, image) => sum + image.byteSize, 0);
  if (total > IMAGE_LIMITS.totalBytes) {
    fail('IMAGE_TOTAL_TOO_LARGE', '图片总大小不能超过 6 MB');
  }
  return {
    decoded,
    parts: decoded.map((image) => ({
      type: 'image_url',
      image_url: { url: image.dataUrl },
    })),
  };
}

module.exports = {
  IMAGE_LIMITS,
  parseAgentImages,
};
