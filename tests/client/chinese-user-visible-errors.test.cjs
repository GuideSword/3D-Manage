'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

test('客户端将平台和远端英文异常转换成中文且保留错误元数据', () => {
  const { localizeTransportError } = require('../../utils/userErrorCore.cjs');

  const network = localizeTransportError(new TypeError('Network request failed'));
  assert.equal(network.message, '网络连接失败，请检查网络设置');

  const pathError = localizeTransportError(new Error('ENOENT: open C:\\中文目录\\secret.txt'));
  assert.equal(pathError.message, '请求失败，请稍后重试');

  const storage = localizeTransportError(new Error('SecureStore unavailable'), {
    fallback: '本地数据读写失败，请稍后重试',
  });
  assert.equal(storage.message, '本地数据读写失败，请稍后重试');

  const timeout = localizeTransportError(Object.assign(new Error('Aborted'), { name: 'AbortError' }), { timedOut: true });
  assert.equal(timeout.message, '请求超时，请稍后重试');

  const response = Object.assign(new Error('Internal Server Error'), { status: 500, code: 'FAILED' });
  assert.equal(localizeTransportError(response).message, '请求失败，请稍后重试');
  assert.equal(response.status, 500);
  assert.equal(response.code, 'FAILED');

  const chinese = new Error('订单不存在');
  assert.equal(localizeTransportError(chinese), chinese);
});

test('图片读取失败不会向界面透传平台英文异常', async () => {
  const { prepareImagesForSend } = require('../../utils/agentImageCore.cjs');
  await assert.rejects(
    prepareImagesForSend(
      [{ id: 'a', uri: 'file:///missing.png', name: 'missing.png', mimeType: 'image/png', size: 1 }],
      async () => { throw new Error('File could not be read'); },
    ),
    { code: 'IMAGE_READ_FAILED', message: '读取图片失败' },
  );
});

test('客户端用户错误链路不再包含遗留英文文案', () => {
  const files = [
    'utils/api.js',
    'utils/agentApi.js',
    'utils/sessionFiles.js',
    'utils/sessionStorage.js',
    'utils/serverConfig.js',
    'utils/protectedImage.js',
    'utils/agentImage.js',
    'utils/agentImageCore.cjs',
    'components/agent/ImageAttachment.js',
    'components/agent/sseClient.js',
  ];
  const forbidden = [
    'assetId is required for model file upload',
    "new Error('SERVER_NOT_CONFIGURED')",
    'A valid serverKey is required',
    'A valid serverKey is required for session storage',
    'Verified server metadata is required',
    'Request aborted',
    'Network error',
    'Request timeout',
    "status || 'unknown'",
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const phrase of forbidden) {
      assert.equal(source.includes(phrase), false, `${file} 仍包含英文用户报错：${phrase}`);
    }
  }
});
