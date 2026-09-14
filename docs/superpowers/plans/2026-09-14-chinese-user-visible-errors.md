# 用户可见报错中文化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将应用界面与后端 API 中最终用户可见的项目自有报错统一为简体中文，同时保留错误码、HTTP 状态和业务行为。

**Architecture:** 在现有错误产生点直接替换中文文案，并在后端通用错误出口增加一个很小的安全中文兜底函数，阻止框架或第三方英文异常被透传。客户端在 HTTP、下载和 SSE 网络边界将平台英文异常转换为中文，开发日志、测试断言和运维脚本保持原样。

**Tech Stack:** React Native / Expo、Express、CommonJS、Node.js 内置测试运行器、Zod

---

## 文件结构

- Create: `backend/utils/publicError.js` — 只负责把未知或英文底层异常转换成安全的中文兜底，不维护业务错误字典。
- Modify: `backend/utils/validation.js` — 将 Zod 校验详情转换为中文。
- Modify: `backend/middleware/auth.js`, `backend/middleware/rateLimit.js`, `backend/middleware/uploadConcurrency.js` — 中文化通用 API 错误。
- Modify: `backend/routes/auth.js`, `backend/routes/users.js`, `backend/routes/system.js` — 中文化账号、初始化及组织管理错误。
- Modify: `backend/routes/orders.js`, `backend/routes/models.js`, `backend/routes/materials.js`, `backend/routes/stock.js`, `backend/routes/files.js`, `backend/routes/oss.js`, `backend/server.js` — 中文化业务 API 与通用 API 出口。
- Modify: `backend/agent/settingsService.js`, `backend/agent/memoryService.js`, `backend/agent/attachmentStore.js`, `backend/agent/orchestrator.js`, `backend/agent/tools/index.js`, `backend/agent/tools/models.js`, `backend/routes/agent.js` — 中文化智能助手可见错误并屏蔽第三方英文异常。
- Modify: `utils/api.js`, `utils/agentApi.js`, `utils/sessionFiles.js`, `utils/sessionStorage.js`, `utils/serverConfig.js`, `utils/protectedImage.js`, `components/agent/sseClient.js` — 中文化客户端网络、下载、会话及 SSE 错误。
- Create: `tests/backend/chinese-user-visible-errors.test.cjs` — 覆盖后端安全兜底、校验详情和遗留英文 API 文案扫描。
- Create: `tests/client/chinese-user-visible-errors.test.cjs` — 覆盖客户端遗留英文报错扫描。

### Task 1: 建立后端中文错误回归测试

**Files:**
- Create: `tests/backend/chinese-user-visible-errors.test.cjs`
- Test: `tests/backend/chinese-user-visible-errors.test.cjs`

- [ ] **Step 1: 写入失败测试**

创建以下测试文件。它先约束通用兜底和 Zod 中文详情，再扫描 API 边界中本次要清除的遗留英文文案：

```js
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
    'backend/middleware/rateLimit.js',
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
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/backend/chinese-user-visible-errors.test.cjs`

Expected: FAIL，首先报告 `backend/utils/publicError` 不存在，且现有 API 文件仍包含英文报错。

- [ ] **Step 3: 提交测试**

```powershell
git add -- tests/backend/chinese-user-visible-errors.test.cjs
git commit -m "test: guard Chinese API error messages"
```

### Task 2: 实现后端通用中文兜底与校验详情

**Files:**
- Create: `backend/utils/publicError.js`
- Modify: `backend/utils/validation.js`
- Test: `tests/backend/chinese-user-visible-errors.test.cjs`

- [ ] **Step 1: 新增安全的 API 错误出口函数**

创建 `backend/utils/publicError.js`：

```js
'use strict';

const HAS_CHINESE = /\p{Script=Han}/u;

const publicErrorMessage = (error, fallback) => {
  if (error?.code === 'LIMIT_FILE_SIZE') return '上传文件超过大小限制';
  const message = String(error?.message || '').trim();
  return HAS_CHINESE.test(message) ? message : fallback;
};

module.exports = { publicErrorMessage };
```

- [ ] **Step 2: 在 validation.js 生成中文校验详情**

将文件实现调整为：

```js
const localizeValidationIssue = (issue = {}) => {
  if (/\p{Script=Han}/u.test(String(issue.message || ''))) return issue.message;
  if (issue.code === 'invalid_string' && issue.validation === 'email') return '邮箱格式无效';
  if (issue.code === 'unrecognized_keys') return `包含不支持的字段：${(issue.keys || []).join('、')}`;
  if (issue.code === 'invalid_type') return '字段类型无效';
  if (issue.code === 'too_small') return '字段内容过短或数量不足';
  if (issue.code === 'too_big') return '字段内容过长或数量过多';
  return '字段值无效';
};

const parseRequest = (schema, value, res) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  res.status(400).json({
    code: 'VALIDATION_FAILED',
    error: '请求参数校验失败',
    details: parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: localizeValidationIssue(issue),
    })),
  });
  return null;
};

module.exports = { localizeValidationIssue, parseRequest };
```

- [ ] **Step 3: 运行两个单元测试**

Run: `node --test --test-name-pattern="未知英文异常|Zod" tests/backend/chinese-user-visible-errors.test.cjs`

Expected: PASS（API 文件扫描测试仍允许暂时失败）。

- [ ] **Step 4: 提交通用边界实现**

```powershell
git add -- backend/utils/publicError.js backend/utils/validation.js
git commit -m "feat: localize public API error boundaries"
```

### Task 3: 中文化账号、初始化和通用中间件错误

**Files:**
- Modify: `backend/middleware/auth.js`
- Modify: `backend/middleware/rateLimit.js`
- Modify: `backend/middleware/uploadConcurrency.js`
- Modify: `backend/routes/auth.js`
- Modify: `backend/routes/users.js`
- Modify: `backend/routes/system.js`
- Test: `tests/backend/chinese-user-visible-errors.test.cjs`

- [ ] **Step 1: 按下表执行精确文案替换，错误码与状态码不变**

```js
const replacements = [
  ['Authentication required', '需要登录后才能继续'],
  ['Invalid token', '登录凭证无效，请重新登录'],
  ['Insufficient permissions', '当前账号权限不足'],
  ['Too many failed attempts. Try again later.', '失败次数过多，请稍后重试'],
  ['Upload capacity reached; retry later', '当前上传任务较多，请稍后重试'],
  ['Password must be at least 12 characters', '密码至少需要 12 个字符'],
  ['Password must be at most 72 UTF-8 bytes', '密码不能超过 72 个 UTF-8 字节'],
  ['Email is required', '请输入邮箱'],
  ['Password must be at least 8 characters', '密码至少需要 8 个字符'],
  ['System is not initialized', '系统尚未初始化'],
  ['Invalid email or password', '邮箱或密码错误'],
  ['Login failed', '登录失败，请稍后重试'],
  ['Current password is invalid', '当前密码错误'],
  ['Change password failed', '修改密码失败，请稍后重试'],
  ['At least one field is required', '至少需要提供一个可修改字段'],
  ['Get users failed', '获取用户列表失败'],
  ['Email already registered', '该邮箱已注册'],
  ['Create user failed', '创建用户失败'],
  ['User not found', '用户不存在'],
  ['Owner accounts cannot be changed here', '不能在此处修改 Owner 账号'],
  ['Update user failed', '更新用户失败'],
  ['Owner password cannot be reset here', '不能在此处重置 Owner 密码'],
  ['Reset password failed', '重置密码失败'],
  ['Server storage is unavailable', '服务器存储暂不可用'],
  ['Bootstrap token is invalid', '初始化令牌无效'],
  ['System is already initialized', '系统已完成初始化'],
  ['System bootstrap failed', '系统初始化失败'],
  ['Update organization failed', '更新组织信息失败'],
];
```

只替换响应、Zod 自定义消息和业务校验返回值；同名的 `console.error(...)` 开发日志保持英文。

- [ ] **Step 2: 运行后端回归测试**

Run: `node --test tests/backend/chinese-user-visible-errors.test.cjs`

Expected: FAIL 仅剩订单、模型、耗材、库存、文件、OSS 和智能助手文件中的英文文案。

- [ ] **Step 3: 提交账号与系统错误翻译**

```powershell
git add -- backend/middleware/auth.js backend/middleware/rateLimit.js backend/middleware/uploadConcurrency.js backend/routes/auth.js backend/routes/users.js backend/routes/system.js
git commit -m "feat: localize account and system API errors"
```

### Task 4: 中文化业务资源 API 与通用服务器出口

**Files:**
- Modify: `backend/routes/orders.js`
- Modify: `backend/routes/models.js`
- Modify: `backend/routes/materials.js`
- Modify: `backend/routes/stock.js`
- Modify: `backend/routes/files.js`
- Modify: `backend/routes/oss.js`
- Modify: `backend/config/storage.js`
- Modify: `backend/config/oss.js`
- Modify: `backend/server.js`
- Test: `tests/backend/chinese-user-visible-errors.test.cjs`

- [ ] **Step 1: 中文化订单、模型、耗材和库存响应**

使用以下一致术语逐处替换，保留 `console.error` 文本不动：

```js
const businessReplacements = [
  ['Export orders failed', '导出订单失败'], ['Import orders failed', '导入订单失败'],
  ['No file uploaded', '未上传文件'], ['Attachment upload failed', '上传附件失败'],
  ['Get orders failed', '获取订单列表失败'], ['Create order failed', '创建订单失败'],
  ['Get order audit failed', '获取订单审计记录失败'], ['Order not found', '订单不存在'],
  ['Get order failed', '获取订单失败'], ['Use the order status endpoint to change status', '请通过订单状态接口修改状态'],
  ['Update order failed', '更新订单失败'], ['Delete order failed', '删除订单失败'],
  ['Invalid status transition', '不允许进行该订单状态转换'], ['Update order status failed', '更新订单状态失败'],
  ['Unsupported attachment format. Use PNG, JPG, JPEG, or PDF.', '不支持的附件格式，请使用 PNG、JPG、JPEG 或 PDF'],
  ['Export models failed', '导出模型失败'], ['Import models failed', '导入模型失败'],
  ['Get models failed', '获取模型列表失败'], ['Create model failed', '创建模型失败'],
  ['Model not found', '模型不存在'], ['Get model failed', '获取模型失败'],
  ['Get model audit failed', '获取模型审计记录失败'], ['Update model failed', '更新模型失败'],
  ['Delete model failed', '删除模型失败'], ['Model name is required', '请输入模型名称'],
  ['Model description is required', '请输入模型描述'],
  ['Model source must be original, remix, or imported', '模型来源必须是 original、remix 或 imported'],
  ['Unsupported model format. Use STL, OBJ, 3MF, STEP, STP, or ZIP.', '不支持的模型文件格式，请使用 STL、OBJ、3MF、STEP、STP 或 ZIP'],
  ['Unsupported image format. Use JPG, PNG, or WEBP.', '不支持的图片格式，请使用 JPG、PNG 或 WEBP'],
  ['Image type must be cover, real_print, or other', '图片类型必须是 cover、real_print 或 other'],
  ['Export materials failed', '导出耗材失败'], ['Import materials failed', '导入耗材失败'],
  ['Get materials failed', '获取耗材列表失败'], ['Create material failed', '创建耗材失败'],
  ['Get material audit failed', '获取耗材审计记录失败'], ['Material not found', '耗材不存在'],
  ['Get material failed', '获取耗材失败'], ['Update material failed', '更新耗材失败'],
  ['Delete material failed', '删除耗材失败'], ['Export stock failed', '导出库存失败'],
  ['Import stock lots failed', '导入库存批次失败'], ['Get stock lots failed', '获取库存批次失败'],
  ['Create stock lot failed', '创建库存批次失败'], ['Get inventory transactions failed', '获取库存流水失败'],
  ['Stock lot not found', '库存批次不存在'], ['Invalid inventory transaction type', '库存操作类型无效'],
  ['Invalid quantity', '数量无效'], ['Insufficient stock', '库存不足'],
  ['Inventory transaction failed', '库存操作失败'], ['Get stock lot audit failed', '获取库存批次审计记录失败'],
  ['Get stock lot failed', '获取库存批次失败'], ['Update stock lot failed', '更新库存批次失败'],
  ['Delete stock lot failed', '删除库存批次失败'],
];
```

把模型预览成功响应中的英文警告改成固定中文：`previewWarning = '模型预览生成失败'`。模型导入、模型文件上传、模型图片上传和订单附件上传的 catch 响应不得再拼接 `error.message`，分别使用 `publicErrorMessage(error, '导入模型失败')`、`publicErrorMessage(error, '上传模型文件失败')`、`publicErrorMessage(error, '上传模型图片失败')`、`publicErrorMessage(error, '上传附件失败')`。

- [ ] **Step 2: 中文化文件、OSS 和服务器出口**

```js
const infrastructureReplacements = [
  ['File not found', '文件不存在'], ['Access denied', '无权访问该文件'],
  ['File download failed', '文件下载失败'],
  ['Object-storage credentials are configured only on the server', '对象存储凭证只能在服务器端配置'],
  ['Upload target not found', '上传目标不存在'], ['Object is not registered', '对象尚未登记'],
  ['Pending upload not found', '待完成的上传记录不存在'], ['Upload belongs to another user', '该上传记录属于其他用户'],
  ['Uploaded object metadata does not match the pending upload', '已上传对象信息与待上传记录不一致'],
  ['Upload was already completed', '该上传已完成'],
  ['Object storage is not enabled on this server', '此服务器未启用对象存储'],
  ['Invalid object key', '对象存储键无效'], ['Access denied: Invalid file path', '无权访问：文件路径无效'],
  ['CORS origin not allowed:', '不允许该跨域来源：'], ['Route not found', '请求的接口不存在'],
  ['Something went wrong', '服务器内部错误'],
];
```

在 `backend/server.js` 引入 `publicErrorMessage`，最终错误中间件使用：

```js
res.status(err.status || 500).json({
  error: publicErrorMessage(err, '服务器内部错误'),
});
```

`backend/routes/oss.js` 中所有直接返回 `error.message` 的 catch 分支按当前操作分别改为：`publicErrorMessage(error, '对象存储连接测试失败')`、`'生成上传地址失败'`、`'生成下载地址失败'`、`'确认上传失败'`、`'删除对象失败'`。

- [ ] **Step 3: 运行后端测试**

Run: `node --test tests/backend/chinese-user-visible-errors.test.cjs`

Expected: FAIL 仅剩智能助手相关文件中的英文文案。

- [ ] **Step 4: 提交业务 API 翻译**

```powershell
git add -- backend/routes/orders.js backend/routes/models.js backend/routes/materials.js backend/routes/stock.js backend/routes/files.js backend/routes/oss.js backend/config/storage.js backend/config/oss.js backend/server.js
git commit -m "feat: localize business API errors"
```

### Task 5: 中文化智能助手错误链路

**Files:**
- Modify: `backend/agent/settingsService.js`
- Modify: `backend/agent/memoryService.js`
- Modify: `backend/agent/attachmentStore.js`
- Modify: `backend/agent/orchestrator.js`
- Modify: `backend/agent/tools/index.js`
- Modify: `backend/agent/tools/models.js`
- Modify: `backend/routes/agent.js`
- Test: `tests/backend/chinese-user-visible-errors.test.cjs`

- [ ] **Step 1: 中文化可直接返回的智能助手业务错误**

```js
const agentReplacements = [
  ['Attachment not found', '附件不存在'],
  ['Validated image buffer is required', '缺少已校验的图片数据'],
  ['Unsupported core memory category', '不支持该核心记忆分类'],
  ['Memory content must be 1-500 characters', '记忆内容长度必须为 1 到 500 个字符'],
  ['Source user message not found', '作为来源的用户消息不存在'],
  ['Core memory must quote an explicitly stated user fact', '核心记忆必须引用用户明确表达的事实'],
  ['Core memory is full', '核心记忆空间已满'],
  ['The saved API key can no longer be decrypted', '已保存的 API Key 无法解密，请重新填写'],
  ['LLM Base URL, API Key and model are required', '请完整填写大模型 Base URL、API Key 和模型名'],
  ['Embedding Base URL, API Key, model and Group ID are required when embedding is enabled', '启用 Embedding 时，请完整填写 Base URL、API Key、模型名和 Group ID'],
  ['Unknown tool:', '未知工具：'],
  ['Tool ', '工具 '],
  [' is not allowed for this role', ' 不允许当前角色使用'],
  ['Semantic search is not configured', '尚未配置语义搜索'],
  ['Not found', '记录不存在'],
];
```

`normalizeBaseUrl` 不再用英文 `field` 拼句子；为调用方传入中文标签“大模型 Base URL”或“Embedding Base URL”，并分别产生“不能为空”“必须是有效的 HTTP(S) 地址”“只支持 HTTP 或 HTTPS”三类中文错误。

- [ ] **Step 2: 屏蔽第三方服务原始英文异常**

在 `settingsService.js` 的连接测试 catch 中不再返回 `error.message`：大模型使用“连接大模型服务失败，请检查地址、模型名和 API Key”，Embedding 使用“连接 Embedding 服务失败，请检查地址、模型名、Group ID 和 API Key”，保留已有数值 `status` 字段。

在 `orchestrator.js` 与 `routes/agent.js` 引入 `publicErrorMessage`。SSE/JSON 的动态异常按上下文提供中文兜底：“对话初始化失败”“大模型调用失败”“流式响应中断”“工具参数解析失败”“读取对话失败”“删除对话失败”“读取草稿失败”“测试 AI 服务配置失败”“保存 AI 服务配置失败”。已有中文业务异常会被保留，底层纯英文异常会被兜底替换。

- [ ] **Step 3: 运行智能助手及中文错误测试**

Run: `node --test tests/backend/chinese-user-visible-errors.test.cjs tests/backend/agent-settings.test.cjs tests/backend/agent-memory.test.cjs tests/backend/agent-attachments.test.cjs tests/backend/agent-image-payload.test.cjs`

Expected: PASS。

- [ ] **Step 4: 提交智能助手翻译**

```powershell
git add -- backend/agent/settingsService.js backend/agent/memoryService.js backend/agent/attachmentStore.js backend/agent/orchestrator.js backend/agent/tools/index.js backend/agent/tools/models.js backend/routes/agent.js
git commit -m "feat: localize assistant-facing errors"
```

### Task 6: 建立并实现客户端中文错误边界

**Files:**
- Create: `tests/client/chinese-user-visible-errors.test.cjs`
- Modify: `utils/api.js`
- Modify: `utils/agentApi.js`
- Modify: `utils/sessionFiles.js`
- Modify: `utils/sessionStorage.js`
- Modify: `utils/serverConfig.js`
- Modify: `utils/protectedImage.js`
- Modify: `components/agent/sseClient.js`
- Test: `tests/client/chinese-user-visible-errors.test.cjs`

- [ ] **Step 1: 写入客户端失败测试**

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');

test('客户端用户错误链路不再包含遗留英文文案', () => {
  const files = [
    'utils/api.js', 'utils/agentApi.js', 'utils/sessionFiles.js',
    'utils/sessionStorage.js', 'utils/serverConfig.js', 'utils/protectedImage.js',
    'components/agent/sseClient.js',
  ];
  const forbidden = [
    'assetId is required for model file upload', "new Error('SERVER_NOT_CONFIGURED')",
    'A valid serverKey is required', 'A valid serverKey is required for session storage',
    'Verified server metadata is required', 'Request aborted', 'Network error',
    'Request timeout', "status || 'unknown'",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const phrase of forbidden) {
      assert.equal(source.includes(phrase), false, `${file} 仍包含英文用户报错：${phrase}`);
    }
  }
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/client/chinese-user-visible-errors.test.cjs`

Expected: FAIL，列出 SSE、会话存储和 API 包装层中的遗留英文字符串。

- [ ] **Step 3: 中文化客户端直接错误**

执行以下精确替换：

```js
const clientReplacements = [
  ['assetId is required for model file upload', '上传模型文件时缺少 assetId'],
  ['A valid serverKey is required for session storage', '会话存储缺少有效的服务器标识'],
  ['A valid serverKey is required', '缺少有效的服务器标识'],
  ['Verified server metadata is required', '缺少已验证的服务器信息'],
  ['Request aborted', '请求已取消'],
  ['Network error (xhr.onerror)', '网络连接失败，请检查网络设置'],
  ['Network error', '网络连接失败，请检查网络设置'],
  ['Request timeout', '请求超时，请稍后重试'],
  ["result?.status || 'unknown'", "result?.status || '未知'"],
];
```

`utils/agentApi.js` 中未配置服务器的分支必须同时保留机器错误码与中文消息：

```js
if (!snapshot) {
  const error = new Error('尚未配置服务器');
  error.code = 'SERVER_NOT_CONFIGURED';
  throw error;
}
```

保留 `streamChat requires an onEvent callback` 与 `streamSSE requires an onEvent callback`，因为它们属于开发者调用契约，不会展示给最终用户；相应地不要把它们加入扫描列表。

- [ ] **Step 4: 在 api.js 归一化平台网络异常**

在 `apiRequest` 和 Web 下载路径的 catch 中加入同等规则：会话失效继续抛 `StaleSessionError`；`AbortError` 转成“请求超时，请稍后重试”；没有 HTTP `status` 的 `TypeError` 或包含 `Failed to fetch`、`Network request failed`、`Load failed` 的错误转成“网络连接失败，请检查网络设置”；已经包含中文的 API 错误保持不变。不得改动 `authRequired`、`status`、`data` 和会话清理流程。

- [ ] **Step 5: 运行客户端测试**

Run: `node --test tests/client/chinese-user-visible-errors.test.cjs tests/client/server-lifecycle.test.cjs tests/client/agent-chat-contract.test.cjs tests/client/protected-image.test.cjs`

Expected: PASS。

- [ ] **Step 6: 提交客户端翻译**

```powershell
git add -- tests/client/chinese-user-visible-errors.test.cjs utils/api.js utils/agentApi.js utils/sessionFiles.js utils/sessionStorage.js utils/serverConfig.js utils/protectedImage.js components/agent/sseClient.js
git commit -m "feat: localize client-visible errors"
```

### Task 7: 全量验证与最终英文提示审计

**Files:**
- Modify only if assertions must match translated user-visible strings: `tests/backend/*.test.cjs`, `tests/client/*.test.cjs`
- Verify: all files listed above

- [ ] **Step 1: 运行新增边界测试**

Run: `node --test tests/backend/chinese-user-visible-errors.test.cjs tests/client/chinese-user-visible-errors.test.cjs`

Expected: PASS。

- [ ] **Step 2: 运行仓库现有验证**

Run: `npm run verify:client`

Expected: PASS。

Run: `npm run verify:agent-client`

Expected: PASS。

Run: `npm --prefix backend run test:agent`

Expected: PASS。

Run: `npm --prefix backend run verify:runtime`

Expected: PASS。

- [ ] **Step 3: 静态审计用户可见错误出口**

Run:

```powershell
rg -n --glob '*.js' --glob '!backend/scripts/**' --glob '!tests/**' "error:" backend
rg -n --glob '*.js' --glob '!tests/**' "Alert\.alert|setErrorMessage|connectionError|new Error\(" screens components context utils
```

Expected: 剩余英文仅限错误码、技术标识、开发者调用契约、第三方服务名或开发日志；任何 `error` API 字段、界面错误状态、网络异常和 SSE 错误中不得残留项目自有英文提示。

- [ ] **Step 4: 检查变更没有混入用户现有工作**

Run: `git status --short`

Expected: 本任务提交只包含计划列出的文件；工作树中原先存在的其他修改仍保持原状，没有被还原或加入本任务提交。

- [ ] **Step 5: 提交必要的测试断言调整**

仅当现有测试直接断言旧英文用户文案时执行：

```powershell
git add -- tests/backend tests/client
git commit -m "test: align assertions with Chinese errors"
```

如果没有测试断言需要调整，则跳过本次提交。
