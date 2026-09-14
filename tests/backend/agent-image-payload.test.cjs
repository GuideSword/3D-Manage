'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAgentImages, IMAGE_LIMITS } = require('../../backend/agent/imagePayload');
const { normalizeChatRequest } = require('../../backend/agent/chatRequest');

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const image = (overrides = {}) => ({
  name: 'pixel.png',
  mimeType: 'image/png',
  dataUrl: `data:image/png;base64,${PNG_BASE64}`,
  ...overrides,
});

test('verified vision models receive validated multimodal parts', () => {
  const result = parseAgentImages([image()], 'vision');
  assert.equal(result.decoded.length, 1);
  assert.equal(result.decoded[0].mimeType, 'image/png');
  assert.equal(Buffer.isBuffer(result.decoded[0].buffer), true);
  assert.deepEqual(result.parts, [
    { type: 'image_url', image_url: { url: image().dataUrl } },
  ]);
});

test('image limits and signatures are enforced server-side', () => {
  assert.deepEqual(IMAGE_LIMITS, { count: 4, eachBytes: 4 * 1024 * 1024, totalBytes: 6 * 1024 * 1024 });
  assert.throws(() => parseAgentImages(Array.from({ length: 5 }, () => image()), 'vision'), { code: 'IMAGE_LIMIT_EXCEEDED' });
  assert.throws(() => parseAgentImages([image({ dataUrl: 'data:image/png;base64,not-base64!' })], 'vision'), { code: 'IMAGE_PAYLOAD_INVALID' });
  assert.throws(() => parseAgentImages([image({ dataUrl: 'data:image/png;base64,AQIDBA==' })], 'vision'), { code: 'IMAGE_TYPE_UNSUPPORTED' });
  const tooLarge = Buffer.alloc(IMAGE_LIMITS.eachBytes + 1);
  tooLarge.set(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.throws(
    () => parseAgentImages([image({ dataUrl: `data:image/png;base64,${tooLarge.toString('base64')}` })], 'vision'),
    { code: 'IMAGE_TOO_LARGE' }
  );
});

test('unverified and text-only models cannot receive images', () => {
  assert.throws(() => parseAgentImages([image()], 'untested'), { code: 'IMAGE_CAPABILITY_UNTESTED' });
  assert.throws(() => parseAgentImages([image()], 'text_only'), { code: 'IMAGE_CAPABILITY_UNSUPPORTED' });
});

test('text-only requests are unaffected by vision state', () => {
  assert.deepEqual(parseAgentImages([], 'untested'), { decoded: [], parts: [] });
});

test('image-only chat requests use a hidden model prompt without requiring visible text', () => {
  const request = normalizeChatRequest({ message: '   ', images: [image()] });
  assert.equal(request.suppliedMessage, '');
  assert.equal(request.modelMessage, '请分析这些图片');
  assert.equal(request.images.length, 1);
});

test('chat requests reject only when both text and images are absent', () => {
  assert.throws(() => normalizeChatRequest({ message: '   ', images: [] }), {
    code: 'MESSAGE_REQUIRED',
    message: '请输入消息或选择图片',
  });
});
