# AI 聊天会话续接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Android 与 Web 重开助手后恢复同账号原会话，保留已接收但回复中断的消息并由用户安全重试。

**Architecture:** 复用服务端 SQLite 会话和分层记忆，给用户消息增加回合状态并在 SSE 接收后回传 ID；客户端通过现有 API 读取历史，并只在本地存账号隔离的会话指针/文字草稿。既有确认卡仍需用户显式确认。

**Tech Stack:** Express、better-sqlite3、Expo / React Native Web、Node test、Playwright、Android ADB。

---

依据：[设计](../specs/2026-10-04-agent-chat-resume-design.md)与[ERP 总计划](2026-09-29-erp-priority-plan.md)。现有 `AgentChatScreen.js`、`agentApi.js`、`backend/routes/agent.js`、`backend/agent/orchestrator.js` 有其他未提交改动，逐段编辑并保留。

## 文件职责

- `backend/db/agent.js`：读取最后一轮、更新用户消息状态、仅删除该轮未完成的后续消息。
- `backend/agent/orchestrator.js`：会话归属、`accepted` 事件、正常/中断状态及复用原消息的手动重试。
- `backend/agent/chatRequest.js`、`backend/routes/agent.js`：校验重试 ID 和 HTTP/SSE 请求契约。
- `utils/agentConversationCore.cjs`：服务端消息到聊天 UI 的纯映射和中断识别。
- `utils/sessionStorage.js`：服务器/账号隔离的指针和草稿及退出清理。
- `screens/AgentChatScreen.js`、`utils/agentApi.js`：历史、新对话、恢复、删除、草稿和重试交互。
- `tests/backend/agent-chat-resume.test.cjs`、`tests/client/agent-chat-resume.test.cjs`：真实数据库回合与纯客户端状态验证。

### Task 1：服务端持久化中断回合

- [x] 在隔离 SQLite 测试中建立会话、用户消息、未完成助手消息，断线后断言用户消息仍存在且状态为 `interrupted`，助手/工具尾部记录被清理。
- [x] 运行 `node --test tests/backend/agent-chat-resume.test.cjs`，确认新增断言先失败。
- [x] 在 `backend/db/agent.js` 增加按会话/账号读取最后用户消息与原子更新 JSON `content.turn_state` 的方法；在 `orchestrator.js` 将失败清理改为保留用户记录并删除 `currentSequence + 1` 之后的未完成记录。
- [x] 重新运行专用测试与 `npm --prefix backend run verify`，结果为通过。

### Task 2：手动重试和会话归属

- [x] 增加测试：他人会话返回拒绝；同一中断消息的重试只保留一条有效用户记录；非最后一条、已完成或图片消息重试被拒绝。
- [x] 在 `chatRequest.js` 限制 `retryMessageId` 为非空字符串且必须伴随 `conversationId`；在路由入口先验证会话归属；在 `orchestrator.js` 的重试分支复用最后一条中断消息。
- [x] 用户消息落库后发 `accepted`，成功后设 `complete`。执行上述测试及现有 AI 后端测试。

### Task 3：本地会话状态和历史映射

- [x] 用纯逻辑测试覆盖普通文字、多段含图文字、助手工具回复、中断尾消息、空会话与账号/服务器不一致。
- [x] 在 `agentConversationCore.cjs` 输出 `{ messages, retryMessage }`；在现有 `sessionStorage.js` 按 `serverKey` 存 `{ userId, conversationId, draft }`，读取时严格比较用户 ID，`clearSession` 删除这一键。
- [x] 执行 `node --test tests/client/agent-chat-resume.test.cjs tests/client/server-lifecycle.test.cjs`。

### Task 4：Android / Web 聊天 UI

- [x] 增加历史入口，进入时列出并加载最近会话，打开、删除和新建后清理过期页面状态；异步请求返回前复核当前服务器/账号。
- [x] 发送流处理 `accepted`、`done` 和失败：记录 ID、保留用户气泡并展示中断重试；重试只传 `retryMessageId`，绝不自动启动；草稿随输入保存，恢复时不恢复图片字节。
- [x] 运行 `npm run verify:agent-client` 和 Web 导出；使用无界面浏览器验证页面交互，不使用 Computer Use。

### Task 5：隔离环境和真机发布验收

- [x] 在隔离服务核对两个账号的会话归属、断线重试只写一条用户消息、摘要仍按 8K 预算工作、冷备份/恢复保留记录。
- [x] 物理 Android 同签名覆盖安装、强制结束与重开、草稿及历史/删除验收通过；2026-10-15 用户模拟器复验回复中断及同消息重试通过，Web 刷新后继续同会话已通过。
- [x] 先备份正式 Docker 数据并在隔离环境恢复核对，再更新正式后端与 APK；发布前后原订单、模型、耗材和聊天记录摘要一致。
- [x] 将证据和未完成事项写回 ERP 总计划与[发布复核](../../rehearsals/2026-10-15-agent-chat-resume-release.md)。主要功能完成，综合约 95%，按用户约定进入 02A。
- [ ] 后续设备补测：长时间锁屏/后台清理及不同设备的真实网络切换。此项继续跟踪，不阻断 02A 的独立基础模块。
