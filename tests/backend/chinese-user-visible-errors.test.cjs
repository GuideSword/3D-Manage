'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('未知英文异常在 API 边界使用中文兜底', () => {
  const { publicErrorMessage } = require('../../backend/utils/publicError');
  assert.equal(publicErrorMessage(new Error('connect ECONNREFUSED'), '服务暂不可用'), '服务暂不可用');
  assert.equal(publicErrorMessage(new Error('ENOENT: open C:\\中文目录\\secret.txt'), '服务暂不可用'), '服务暂不可用');
  assert.equal(publicErrorMessage(new Error('已有中文错误'), '服务暂不可用'), '已有中文错误');
  assert.equal(publicErrorMessage({ code: 'LIMIT_FILE_SIZE' }, '上传失败'), '上传文件超过大小限制');
});

test('Zod 校验详情使用中文', () => {
  const { localizeValidationIssue } = require('../../backend/utils/validation');
  assert.equal(localizeValidationIssue({ code: 'invalid_string', validation: 'email' }), '邮箱格式无效');
  assert.equal(localizeValidationIssue({ code: 'unrecognized_keys', keys: ['secret'] }), '包含不支持的字段：secret');
  assert.equal(localizeValidationIssue({ code: 'custom', message: '密码至少需要 12 个字符' }), '密码至少需要 12 个字符');
});

test('用户可见 API 文案不再包含已知英文报错', () => {
  const files = [
    'backend/server.js',
    'backend/middleware/auth.js',
    'backend/utils/rateLimit.js',
    'backend/middleware/uploadConcurrency.js',
    'backend/utils/validation.js',
    'backend/routes/auth.js',
    'backend/routes/users.js',
    'backend/routes/system.js',
    'backend/routes/orders.js',
    'backend/routes/models.js',
    'backend/routes/materials.js',
    'backend/routes/stock.js',
    'backend/routes/files.js',
    'backend/routes/oss.js',
    'backend/routes/agent.js',
    'backend/agent/settingsService.js',
    'backend/agent/memoryService.js',
    'backend/agent/attachmentStore.js',
    'backend/agent/orchestrator.js',
    'backend/agent/tools/index.js',
    'backend/agent/tools/models.js',
  ];
  const forbidden = [
    'Authentication required', 'Invalid token', 'Insufficient permissions',
    'Request validation failed', 'Too many failed attempts', 'Upload capacity reached',
    'Password must be', 'Email is required', 'System is not initialized',
    'Invalid email or password', 'Login failed', 'Current password is invalid',
    'Get users failed', 'Email already registered', 'User not found',
    'Owner accounts cannot', 'Reset password failed', 'Server storage is unavailable',
    'Bootstrap token is invalid', 'System is already initialized', 'Route not found',
    'Something went wrong', 'Export orders failed', 'Order not found',
    'Export models failed', 'Model not found', 'Export materials failed',
    'Material not found', 'Export stock failed', 'Stock lot not found',
    'File not found', 'Access denied', 'Upload target not found',
    'Object is not registered', 'Not found', 'Attachment not found',
    'Semantic search is not configured', 'Unknown tool:',
  ];
  for (const file of files) {
    const source = read(file);
    const publicLines = source.split(/\r?\n/).filter((line) => (
      !line.includes('console.')
      && (/\b(?:error|message)\s*:/.test(line) || /new Error\s*\(/.test(line) || /return\s+['"`]/.test(line))
    ));
    for (const phrase of forbidden) {
      assert.equal(publicLines.some((line) => line.includes(phrase)), false, `${file} 仍包含英文用户报错：${phrase}`);
    }
  }
});
