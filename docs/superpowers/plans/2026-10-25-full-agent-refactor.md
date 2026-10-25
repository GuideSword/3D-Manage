# 小鲤全量 ERP Agent 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让订单、模型、耗材、库存在 legacy/file 与 relational/PostgreSQL 两种运行模式下通过同一套 Agent 工具完成可靠查询和带确认的增删改。

**Architecture:** 以共享实体契约生成严格工具 schema 和统一 DTO；两种存储模式分别实现 `AgentDataPort`，路由和编排器只依赖该接口。读取工具返回完整分页元数据，写入工具只生成签名提案，用户确认后复用现有领域服务执行。

**Tech Stack:** Node.js/CommonJS、Express、Zod、better-sqlite3/JSON store、PostgreSQL services、React Native/Expo、Node test runner、SSE。

---

## 文件地图

- Create `backend/agent/contracts/entities.js`: 四类实体的字段、类型、权限和 DTO 归一化规则。
- Create `backend/agent/contracts/drafts.js`: 订单草稿规范化、必填字段计算和共享 Zod schema。
- Create `backend/agent/dataPort.js`: `AgentDataPort` 接口检查、分页和错误结构。
- Create `backend/agent/adapters/legacy.js`: file/JSON 模式适配器。
- Create `backend/agent/adapters/relational.js`: PostgreSQL services 适配器。
- Create `backend/agent/tools/entities.js`: metadata-driven 读写工具。
- Create `backend/agent/tools/mutations.js`: 提案工具与确认边界。
- Create `components/agent/MutationConfirmCard.js`: 通用写操作确认卡。
- Create `tests/backend/agent-contracts.test.cjs`, `tests/backend/agent-data-port.test.cjs`, `tests/backend/agent-mutations.test.cjs`, `tests/client/agent-draft-validation.test.cjs`。
- Modify `backend/application/legacyRuntime.js`, `backend/application/relationalRuntime.js`, `backend/modules/adapters/agent.js`, `backend/agent/orchestrator.js`, `backend/agent/tools/index.js`, `backend/routes/agent.js`, `backend/agent/persona.js`。
- Modify `backend/agent/dbBridge.js` only as a compatibility wrapper during migration; no new tool may call it directly.
- Modify `components/agent/ToolCallCard.js`, `components/agent/DraftConfirmCard.js`, `screens/AgentChatScreen.js`, `utils/agentApi.js`。

### Task 1: 共享实体契约与确定性草稿校验

**Files:**
- Create: `backend/agent/contracts/entities.js`
- Create: `backend/agent/contracts/drafts.js`
- Test: `tests/backend/agent-contracts.test.cjs`
- Test: `tests/client/agent-draft-validation.test.cjs`

- [ ] **Step 1: 写失败测试，锁定四类 DTO 和客户名优先级**

```js
test('订单客户名兼容嵌套、旧字段和快照', () => {
  assert.equal(normalizeOrder({ customer: { name: '嵌套' }, customerName: '旧', customerSnapshot: { name: '快照' } }).customer.name, '嵌套');
  assert.equal(normalizeOrder({ customerName: '旧', customerSnapshot: { name: '快照' } }).customer.name, '旧');
  assert.equal(normalizeOrder({ customerSnapshot: { name: '快照' } }).customer.name, '快照');
});

test('列表 DTO 保留订单明细、备注、客户联系方式', () => {
  const row = normalizeOrder({ id: '1', customer: { name: '客户', email: 'a@b.test', phone: '1' }, items: [{ qty: 2, unitPrice: 3 }], notes: '备注' });
  assert.equal(row.items[0].quantity, 2);
  assert.equal(row.customer.email, 'a@b.test');
  assert.equal(row.notes, '备注');
});

test('missing_fields 根据规范化后的实际值计算', () => {
  const draft = normalizeOrderDraft({ customer_name: ' 客户 ', items: [{ material_type: 'PLA', qty: '2', unit_price: '3' }], missing_fields: ['customer_name'] });
  assert.equal(draft.customer_name, '客户');
  assert.deepEqual(draft.missing_fields, []);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/backend/agent-contracts.test.cjs tests/client/agent-draft-validation.test.cjs`

Expected: FAIL because the contract modules do not exist.

- [ ] **Step 3: 实现共享契约**

`entities.js` 导出 `ENTITY_NAMES`, `ENTITY_DEFINITIONS`, `normalizeOrder`, `normalizeModel`, `normalizeMaterial`, `normalizeInventoryLot`, `normalizeRecord`, `toListResponse`。订单客户字段按 `customer.name -> customerName -> customerSnapshot.name -> customer_id 对应客户` 优先级归一化；订单行统一输出 `modelId/modelName/materialType/color/layerHeightMm/quantity/unitPrice/subtotal/notes`。

`drafts.js` 导出 `orderDraftSchema`, `normalizeOrderDraft`, `missingOrderDraftFields`。函数必须 trim 字符串、将数量和单价转换为有限数字、要求至少一行订单，并从当前值重新生成 `missing_fields`，不采信模型传入的冲突标记。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/backend/agent-contracts.test.cjs tests/client/agent-draft-validation.test.cjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/agent/contracts tests/backend/agent-contracts.test.cjs tests/client/agent-draft-validation.test.cjs
git commit -m "feat: add shared agent entity contracts"
```

### Task 2: AgentDataPort 与 legacy/file 适配器

**Files:**
- Create: `backend/agent/dataPort.js`
- Create: `backend/agent/adapters/legacy.js`
- Modify: `backend/agent/dbBridge.js`
- Test: `tests/backend/agent-data-port.test.cjs`

- [ ] **Step 1: 写失败测试，覆盖完整列表和分页**

测试用内存数据注入 `withData`，构造 205 条订单，断言 `list('orders', { limit: 50 })` 返回 `total=205`, `returned=50`, `hasMore=true`, `nextCursor`；`all=true` 返回 200 条并设置 `truncated=true`。另测 `get('orders', id)` 能读到 `customer.name` 和完整 `items`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/backend/agent-data-port.test.cjs`

Expected: FAIL because `createLegacyAgentDataPort` does not exist.

- [ ] **Step 3: 实现 legacy 适配器**

实现 `createLegacyAgentDataPort({ actor, signingKey })`：读取使用 `withData(..., { write:false })`；订单、模型、耗材和库存分别复用现有数据结构与 `services/orders` 规范化逻辑；列表按 `createdAt/id` 稳定排序，游标编码最后一条排序键；`all` 最多聚合 200 条并设置 `truncated`。

提案生成保存实体、动作、规范化变更、before、expectedVersion、actorId、serverId、proposalId、expiresAt 和 HMAC signature。确认时重新读取数据、检查版本和角色，再调用现有 create/update/delete 或库存命令；每次成功写入调用 `appendAudit`。

- [ ] **Step 4: 保持旧 dbBridge 兼容**

将 `dbBridge.listOrders` 和 `getOrderDetail` 改为调用共享归一化函数，保留旧数组返回形态供已有测试使用；新工具只依赖 `AgentDataPort`。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/backend/agent-data-port.test.cjs tests/backend/erp-adapters.test.cjs`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/agent/dataPort.js backend/agent/adapters/legacy.js backend/agent/dbBridge.js tests/backend/agent-data-port.test.cjs
git commit -m "feat: add legacy agent data port"
```

### Task 3: relational/PostgreSQL 适配器与运行时接线

**Files:**
- Create: `backend/agent/adapters/relational.js`
- Modify: `backend/modules/adapters/agent.js`
- Modify: `backend/application/relationalRuntime.js`
- Modify: `backend/application/legacyRuntime.js`
- Test: `tests/backend/agent-runtime.test.cjs`

- [ ] **Step 1: 写失败测试**

为 relational runtime 注入 fake pool/services，断言 `/api/agent/chat` 不再返回 `FEATURE_MAINTENANCE`；断言同一 `list('orders')` DTO 与 legacy 适配器字段一致；viewer 只能读，staff/owner 才能生成和确认提案。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/backend/agent-runtime.test.cjs`

Expected: FAIL because relational runtime still mounts the maintenance handler.

- [ ] **Step 3: 扩展 relational adapter**

把现有 `createAgentAdapter` 的 `db`、`prepareRecordUpdate`、`confirmRecordUpdate` 和 `confirmOrderDraft` 重构为 `createRelationalAgentDataPort`，补齐 `describe/list/get/search`、create/delete 和库存专用命令；所有返回值通过共享 `normalizeRecord` 和 `toListResponse`。

- [ ] **Step 4: 接入 runtime**

`createRelationalRuntime` 创建认证后的 Agent router，并通过请求 session 创建 port；删除 `/agent` maintenance 占位。`createLegacyRuntime` 创建 legacy port 注入同一 router。认证和存储模式检查必须在路由入口完成。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/backend/agent-runtime.test.cjs tests/backend/erp-server-runtime.test.cjs`

Expected: Agent runtime assertions PASS；原有 runtime 生命周期测试保持 PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/agent/adapters/relational.js backend/modules/adapters/agent.js backend/application/relationalRuntime.js backend/application/legacyRuntime.js tests/backend/agent-runtime.test.cjs
git commit -m "feat: connect agent to both storage runtimes"
```

### Task 4: metadata-driven 工具与严格 schema

**Files:**
- Create: `backend/agent/tools/entities.js`
- Create: `backend/agent/tools/mutations.js`
- Modify: `backend/agent/tools/index.js`
- Modify: `backend/agent/tools/orders.js`, `backend/agent/tools/extract.js`
- Modify: `backend/agent/orchestrator.js`
- Test: `tests/backend/agent-tools.test.cjs`

- [ ] **Step 1: 写失败测试**

断言四类实体都注册 `describe_entity/list_records/get_record/search_records`；工具 schema 拒绝额外字段；`list_records({ entity:'orders', all:true })` 返回完整分页对象；写工具只返回 proposal，不修改数据；工具参数错误返回 `code/path/message`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/backend/agent-tools.test.cjs`

Expected: FAIL because the metadata-driven registry does not exist.

- [ ] **Step 3: 实现工具目录**

用 `ENTITY_DEFINITIONS` 生成严格的 Zod/JSON schema。所有 object schema 设置 `additionalProperties:false`；可选值用 nullable/显式 required 兼容 OpenAI strict schema。`list_records` 支持 `search/status/from/to/limit/cursor/all`，`prepare_*` 调用 port 并返回提案。

- [ ] **Step 4: 迁移订单草稿**

保留 `extract_order_draft` 作为兼容工具，但 handler 调用 `normalizeOrderDraft` 并返回确定性 `missing_fields`；`routes/agent.js` 的确认 schema 改为复用同一契约。

- [ ] **Step 5: 编排器接入 port 和严格工具**

`runConversation` 的 ctx 注入 `agentDataPort`；工具执行使用该 port。工具列表传给模型时加 `strict:true`；工具失败时把结构化错误作为 tool message 回传模型，最多允许 `MAX_MODEL_TURNS` 内重试。每次成功或失败都发出 `tool_result` SSE。

- [ ] **Step 6: 运行测试确认通过**

Run: `node --test tests/backend/agent-tools.test.cjs tests/backend/agent-*.test.cjs`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add backend/agent/tools backend/agent/orchestrator.js tests/backend/agent-tools.test.cjs
git commit -m "feat: add strict metadata-driven agent tools"
```

### Task 5: Agent mutation API 与订单草稿兼容层

**Files:**
- Modify: `backend/routes/agent.js`
- Modify: `utils/agentApi.js`
- Test: `tests/backend/agent-mutations.test.cjs`

- [ ] **Step 1: 写失败测试**

覆盖：viewer 确认写入返回 `BUSINESS_FORBIDDEN`；未确认返回 `HUMAN_CONFIRMATION_REQUIRED`；篡改 proposal、过期 proposal、版本冲突分别拒绝；成功确认返回统一 DTO 并写 audit；旧 `/drafts/confirm` 能转换成 `prepare_create/confirmMutation`。

- [ ] **Step 2: 实现路由**

新增 `POST /agent/mutations/prepare` 和 `POST /agent/mutations/confirm`，分别校验实体、动作、变更和提案签名。保留 `/agent/drafts/confirm`，内部转换为订单 create proposal，避免已有客户端失效。

- [ ] **Step 3: 更新客户端 API**

在 `agentApi` 增加 `prepareMutation`、`confirmMutation`，统一带 `Idempotency-Key`；保留 `confirmDraft` 作为兼容方法。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/backend/agent-mutations.test.cjs tests/backend/agent-settings.test.cjs`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/routes/agent.js utils/agentApi.js tests/backend/agent-mutations.test.cjs
git commit -m "feat: add confirmed agent mutation API"
```

### Task 6: 编排器 SSE、工具卡和会话可观测性

**Files:**
- Modify: `backend/agent/orchestrator.js`
- Modify: `components/agent/ToolCallCard.js`
- Modify: `screens/AgentChatScreen.js`
- Test: `tests/client/agent-chat-contract.test.cjs`

- [ ] **Step 1: 写失败测试**

静态契约测试断言后端包含 `onEvent('tool_result'`，前端能按 tool call id 更新结果；结果为 `{ error }` 时显示错误状态，分页结果显示 `returned/total/hasMore`。

- [ ] **Step 2: 实现结果事件匹配**

为每次工具调用生成稳定 key（优先 `tool_call_id`，兼容旧服务端按顺序匹配），发送 `{ id, name, result, ok }`；SQLite tool message 保存同样的结构化结果。

- [ ] **Step 3: 更新前端工具卡**

`AgentChatScreen` 的 `toolMap` 以 call id 建立映射；`ToolCallCard` 接受 `status` 和 `result`，成功、失败、等待三种状态分别渲染。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run verify:agent-client`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/agent/orchestrator.js components/agent/ToolCallCard.js screens/AgentChatScreen.js tests/client/agent-chat-contract.test.cjs
git commit -m "feat: expose agent tool results in SSE"
```

### Task 7: 通用 mutation 确认卡与草稿实时校验

**Files:**
- Create: `components/agent/MutationConfirmCard.js`
- Modify: `components/agent/DraftConfirmCard.js`
- Modify: `screens/AgentChatScreen.js`
- Test: `tests/client/agent-draft-validation.test.cjs`

- [ ] **Step 1: 写失败测试**

断言客户名输入后不再保留 `customer_name` 缺失标记；删除订单行或把数量清空会重新产生对应字段错误；模型、颜色、层高和行备注可编辑并随提案提交。

- [ ] **Step 2: 实现实时校验**

在 DraftConfirmCard 中使用共享纯函数根据当前 `editing` 计算 missing/errors，不再直接读取模型传来的 `missing_fields`；确认时先 trim/转换，再调用 `agentApi.confirmMutation`。

- [ ] **Step 3: 实现 MutationConfirmCard**

渲染 entity、action、before、changes、风险、版本和字段错误；只允许 owner/staff 确认；删除显示二次确认；成功后将统一 DTO 追加到聊天消息。

- [ ] **Step 4: 接入 AgentChatScreen**

处理 `mutation_proposal` 和 `mutation_result` 事件，分别插入确认卡和结果消息；Viewer 只显示提案，不显示确认按钮。

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test tests/client/agent-draft-validation.test.cjs tests/client/agent-chat-contract.test.cjs`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add components/agent/MutationConfirmCard.js components/agent/DraftConfirmCard.js screens/AgentChatScreen.js tests/client/agent-draft-validation.test.cjs
git commit -m "feat: add agent mutation confirmation UI"
```

### Task 8: persona、文档与完整回归

**Files:**
- Modify: `backend/agent/persona.js`
- Modify: `docs/AGENT_DESIGN.md`
- Test: existing backend/client suites and new Agent suites

- [ ] **Step 1: 更新 persona 行为约束**

明确：当前数据必须先调用工具；“全部”必须迭代到 `hasMore=false` 或说明 `truncated`；读取到的字段优先于模型推断；写操作必须展示提案并等待确认；工具错误必须如实转述。

- [ ] **Step 2: 更新设计文档**

把 `docs/AGENT_DESIGN.md` 中旧的 `dbBridge`/PostgreSQL 方案替换为双适配器、共享契约、严格工具和确认提案流程，并记录 relational `/agent` 已接通。

- [ ] **Step 3: 运行分层验证**

```bash
node --test tests/backend/agent-contracts.test.cjs tests/backend/agent-data-port.test.cjs tests/backend/agent-tools.test.cjs tests/backend/agent-mutations.test.cjs tests/backend/agent-runtime.test.cjs
npm run verify:agent-client
npm --prefix backend run test:agent
npm run verify:backend
npm run verify:erp
```

Expected: all commands exit 0；若 relational PostgreSQL 环境可用，再运行 `npm run verify:erp:foundation` 和 `npm run verify:erp:preflight`。

- [ ] **Step 4: 手动 API/UI 验证**

在 legacy/file 和 relational 环境各执行：登录 → “列出全部订单” → 检查完整客户名/明细/分页 → 查询模型/耗材/库存 → 修改一条记录并取消 → 再次生成提案并确认 → 删除无引用记录 → 尝试删除有库存引用记录并确认被拒绝。检查 Network 中每个 `tool_call` 都有对应 `tool_result`，审计记录包含动作和结果。

- [ ] **Step 5: 提交**

```bash
git add backend/agent/persona.js docs/AGENT_DESIGN.md
git commit -m "docs: finalize unified ERP agent behavior"
```

## Self-review

- Spec coverage: 双 runtime、四实体 DTO、分页、草稿校验、SSE 结果、确认提案、权限/版本/审计和回归验收均有对应任务。
- Placeholder scan: 未使用 TBD、TODO 或“稍后补充”等占位语句。
- Type consistency: 所有工具通过 `AgentDataPort`，列表统一使用 `items/total/returned/hasMore/nextCursor/truncated`；提案统一使用 `proposalId/expectedVersion/expiresAt/signature`。
- Compatibility: 保留旧 `dbBridge` 数组 API、`/agent/drafts/confirm` 和现有前端草稿入口；未修改工作区已有的 `tests/client/server-lifecycle.test.cjs` 未提交变更。
