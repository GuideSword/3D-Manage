'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IMAGE_LIMITS,
  normalizePickedAssets,
  appendImages,
  removeImage,
  prepareImagesForSend,
  canSendDraft,
  imageOnlyBubbleText,
} = require('../../utils/agentImageCore.cjs');

test('selected images become preview metadata without retaining base64', () => {
  const images = normalizePickedAssets({
    canceled: false,
    assets: [
      { uri: 'file:///one.png', name: 'one.png', mimeType: 'image/png', size: 128 },
      { uri: 'file:///two.jpg', name: 'two.jpg', mimeType: 'image/jpeg', size: 256 },
    ],
  });

  assert.deepEqual(images, [
    { id: 'file:///one.png:128', uri: 'file:///one.png', name: 'one.png', mimeType: 'image/png', size: 128 },
    { id: 'file:///two.jpg:256', uri: 'file:///two.jpg', name: 'two.jpg', mimeType: 'image/jpeg', size: 256 },
  ]);
  assert.equal(images.some((image) => 'dataUrl' in image), false);
});

test('image limits reject too many, oversized, and aggregate-heavy selections', () => {
  assert.deepEqual(IMAGE_LIMITS, {
    count: 4,
    eachBytes: 4 * 1024 * 1024,
    totalBytes: 6 * 1024 * 1024,
  });

  assert.throws(
    () => appendImages([], Array.from({ length: 5 }, (_, index) => ({ id: String(index), size: 1 }))),
    { code: 'IMAGE_LIMIT_EXCEEDED' }
  );
  assert.throws(
    () => appendImages([], [{ id: 'large', size: IMAGE_LIMITS.eachBytes + 1 }]),
    { code: 'IMAGE_TOO_LARGE' }
  );
  assert.throws(
    () => appendImages([], [
      { id: 'a', size: 4 * 1024 * 1024 },
      { id: 'b', size: 3 * 1024 * 1024 },
    ]),
    { code: 'IMAGE_TOTAL_TOO_LARGE' }
  );
});

test('removing an image is immutable and repeat selections are deduplicated', () => {
  const original = [{ id: 'a', size: 1 }, { id: 'b', size: 1 }];
  assert.deepEqual(removeImage(original, 'a'), [{ id: 'b', size: 1 }]);
  assert.deepEqual(appendImages(original, [{ id: 'b', size: 1 }]), original);
  assert.equal(original.length, 2);
});

test('send preparation reads each file at send time through a platform adapter', async () => {
  const calls = [];
  const result = await prepareImagesForSend(
    [{ id: 'a', uri: 'file:///one.png', name: 'one.png', mimeType: 'image/png', size: 3 }],
    async (uri) => {
      calls.push(uri);
      return 'AQID';
    }
  );

  assert.deepEqual(calls, ['file:///one.png']);
  assert.deepEqual(result, [
    { name: 'one.png', mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,AQID' },
  ]);
});

test('only JPEG, PNG, and WebP picker assets are accepted', () => {
  assert.throws(
    () => normalizePickedAssets({
      canceled: false,
      assets: [{ uri: 'file:///photo.heic', name: 'photo.heic', mimeType: 'image/heic', size: 12 }],
    }),
    { code: 'IMAGE_TYPE_UNSUPPORTED' }
  );
});

test('a draft can send text, images, or both without exposing the hidden prompt', () => {
  assert.equal(canSendDraft('', []), false);
  assert.equal(canSendDraft('查询库存', []), true);
  assert.equal(canSendDraft('', [{ id: 'a' }]), true);
  assert.equal(canSendDraft('分析', [{ id: 'a' }]), true);
  assert.equal(imageOnlyBubbleText(2), '已发送 2 张图片');
  assert.notEqual(imageOnlyBubbleText(2), '请分析这些图片');
});
