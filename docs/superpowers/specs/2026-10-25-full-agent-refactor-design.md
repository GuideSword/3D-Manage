# 小鲤全量 ERP Agent 重构设计

日期：2026-10-25  
范围：订单、模型、耗材、库存；legacy/file 与 relational/PostgreSQL 两种运行模式

## 背景

当前 Agent 读取链路直接依赖旧版 `dbBridge` 和 JSON 字段形态。订单客户名、明细字段和分页契约在不同模块中不一致，导致已填写字段被判空、列表只返回首屏、订单表单字段缺失。Agent 目前只有查询和订单草稿创建，模型无法安全地执行统一的增删改查；relational 运行模式则将 `/agent` 置为维护状态。

## 目标

1. 让同一套 Agent 工具在 legacy/file 与 relational/PostgreSQL 运行模式下使用一致的业务 DTO、权限和错误契约。
2. 为订单、模型、耗材、库存提供完整读取能力：实体描述、列表、单条详情和搜索；列表支持可靠分页及“全部”查询的明确截断状态。
3. 为四类实体提供安全写入：准备提案、用户确认、执行提交；所有写入复用现有领域服务、版本检查、权限检查和审计。
4. 让草稿、工具参数、提案校验和前端确认卡使用同一份字段契约，避免 `missing_fields` 与实际表单值冲突。
5. 让工具调用结果在 SSE 和会话历史中可见、可审计、可重试。

## 非目标

- 不让模型绕过用户确认直接写业务数据。
- 不把订单状态、库存入库/出库/调整等领域动作降级成普通字段更新。
- 不在本次重构中实现生产排程、报价成本、采购、交付或收付款模块。
- 不改变现有普通 ERP 页面和公共业务 API 的外部行为。

## 架构

### AgentDataPort

新增稳定的领域接口，工具层只依赖该接口：

- `describeEntity(entity)`：字段类型、标签、必填项、可编辑项、状态枚举和单位。
- `list(entity, query)` / `get(entity, id)`：返回统一 DTO。
- `search(entity, query)`：精确、规范化和模糊匹配。
- `prepareCreate` / `prepareUpdate` / `prepareDelete`：返回签名提案，包含规范化变更、原值、版本、权限和字段级错误。
- `confirmMutation(proposal, key)`：验证确认、签名、过期、账号、服务器和版本后执行。
- 专用命令：订单状态流转、库存流水动作等继续调用原领域命令。

legacy/file 适配器封装 `withData` 和现有 `services/orders` 等领域函数；relational 适配器封装现有 PostgreSQL services 与 `modules/adapters/agent.js`。运行时按已探测的存储模式注入同一 Agent 路由，不再用维护中占位路由或直接读取另一种存储。

### 实体工具

工具目录由实体契约生成，统一注册以下工具：

- `describe_entity`
- `list_records`
- `get_record`
- `search_records`
- `prepare_create`
- `prepare_update`
- `prepare_delete`

工具参数使用严格 JSON Schema：禁止额外属性，字段错误返回机器可读的 `code/path/message`。写工具只生成提案；确认接口是唯一执行入口。订单状态与库存动作使用独立工具，避免通用更新绕过领域规则。

### 统一 DTO 与契约

共享契约负责：

- 客户名按 `customer.name`、旧 `customerName`、客户表/快照的优先级归一化。
- 订单行统一模型、材料、颜色、层高、数量、单价、行备注和小计字段。
- 模型、耗材和库存统一字段别名、数量单位及状态值。
- 草稿和提案在服务端 trim、类型转换和业务校验后重新计算 `missing_fields`；模型输出的同名缺失标记不能覆盖真实值。

列表响应统一为：

```json
{
  "items": [],
  "total": 0,
  "returned": 0,
  "hasMore": false,
  "nextCursor": null,
  "truncated": false
}
```

“全部”查询由服务端按游标循环，达到安全上限时返回 `truncated: true`，模型必须在最终回答中说明范围。

## 事件流与前端

每个工具调用发送成对的 `tool_call` 和 `tool_result` SSE 事件；工具结果同时以完整 JSON 写入会话历史和审计日志。前端工具卡显示实体、返回条数、分页状态及字段错误。

新增通用 `MutationConfirmCard`，展示动作、原值、变更值、风险和版本。用户确认后调用 `/agent/mutations/confirm`；服务端返回新记录或字段级错误。现有订单草稿卡保留兼容入口，但内部改走 `prepare_create(entity=orders)`。

## 错误与安全

- 读取、搜索和写入都绑定当前用户与角色；不得跨租户或跨账号使用模型索引。
- 提案绑定账号、服务器、记录版本和过期时间，并使用独立签名。
- 版本冲突、权限拒绝、必填缺失、单位无效和引用保护都返回稳定错误码。
- 删除默认要求明确二次确认；存在库存流水或业务引用时拒绝删除。
- 工具失败不会被模型包装成成功；编排器将错误结果回传模型，允许有限次数的纠正重试。

## 验收与测试

1. legacy/file 与 relational 两种模式下，四类实体的 `describe/list/get/search` 返回同构 DTO。
2. 订单客户名来自嵌套字段、旧字段或客户快照时均能正确显示；客户名为空时才标记缺失。
3. 超过一页的数据返回正确 `total/hasMore/nextCursor`；“全部”查询要么完整返回，要么明确 `truncated`。
4. 订单明细、模型字段、耗材单位、库存数量和备注均能从列表/详情工具读取。
5. 创建、更新、删除在未确认时不改变数据；确认后经过权限、版本和领域规则检查并写入审计。
6. 草稿编辑后缺失字段实时更新；非法或冲突提案不会执行。
7. SSE 工具卡能看到真实结果和错误；会话历史保留工具调用与结果。
8. 运行现有客户端、后端、ERP 和发布验证脚本，并新增 Agent 契约、适配器、分页、提案和 UI 回归测试。

## 外部参考

- OpenAI Function Calling：工具调用应形成完整的调用—执行—结果循环，并使用严格 schema。
- ERPNext AI Copilot：按领域拆分工具，统一权限、清洗、执行和审计边界。
- LazyChat ERPNext：先读取实体 schema 与当前上下文，再生成 Apply-gated 提案。
- Paddle Pagination：以 `has_more` 和 `next` 作为分页结束依据，不能根据首屏条数猜测已完成。
