# AI 聊天会话令牌修复设计

## 问题

AI 服务设置页可以成功验证 LLM 与 Embedding，但 AI 助手发送消息时立即显示“发送失败”和 `undefined is not a function`。

自动化复现确认 `utils/agentApi.js` 在聊天请求启动前调用 `getTokenForSnapshot(snapshot)`，而 `utils/sessionStorage.js` 没有导出该函数。运行时因此抛出 `getTokenForSnapshot is not a function`，请求尚未到达 SSE 客户端或后端。

## 修复范围

在 `utils/sessionStorage.js` 中补齐并导出 `getTokenForSnapshot(captured)`：

1. 读取前确认 `captured` 仍是当前服务器会话。
2. 使用快照中的 `serverKey` 读取对应令牌。
3. 读取后再次确认会话未切换。
4. 若快照失效则返回 `null`，由调用方现有的会话检查抛出 `StaleSessionError`；若仍有效则返回令牌。

保留 `utils/agentApi.js` 现有接口、SSE 数据流、MiniMax 配置和错误展示逻辑。此次不修改后端 API、模型参数或页面视觉。

## 数据流

发送消息时，聊天模块捕获服务器快照，通过新增的快照令牌读取函数取得同一服务器命名空间下的 JWT，再次验证快照后注册请求并启动 SSE。服务器在令牌读取期间发生切换时，旧会话不会向新服务器发送请求。

## 验证

新增客户端回归测试，在真实模块导出边界加载 `sessionStorage` 与 `agentApi`，调用 `streamChat` 并断言：

- 不再发生“未定义函数”异常；
- 请求进入 SSE 调用；
- 当前令牌写入 `Authorization: Bearer ...`；
- 会话切换保护仍通过现有客户端生命周期测试。

随后运行新增回归测试、`npm run verify:client`，并重新运行最初的聊天发送复现。

## 完成标准

- 聊天发送不会再因 `getTokenForSnapshot` 缺失而失败。
- LLM/Embedding 连接测试行为不变。
- 服务器切换期间不会泄漏或误用旧服务器令牌。
- 自动化客户端验证全部通过。
