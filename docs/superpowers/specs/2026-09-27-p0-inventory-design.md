# P0 库存一致性设计

依据 ERP_TRANSFORMATION.md 第 5.2、5.3、9 节和路线图 P0；本次执行用户指定的现有设计，范围仅 P0。

## 字段与历史

schema 3，API 主版本保持 1，system/info.capabilities.inventoryRulesVersion=1。新批次 UUID；qtyMg 为非负安全整数毫克，qty 为兼容展示克。输入只接受 number 或十进制字符串，至多三位小数，拒绝空值、负值、指数字符串、尾随字符、超出安全整数和非 g 单位。创建允许省略数量为 0，显式空数量拒绝。

新批次 balanceStatus=tracked，ledgerBaselineQtyMg=0；非零期初写 type=in/source=opening 流水。流水含 qty（动作数量；adjust 仍为实盘绝对量）、beforeQtyMg、afterQtyMg、deltaQtyMg、对应克字段、actorId、来源和时间。过账后不编辑或删除。

schema 2→3 保留旧 qty 与旧流水，在批次保存切换余额 ledgerBaselineQtyMg、ledgerStartedAt、balanceStatus=legacy_unverified；无法精确解释的余额为 legacy_invalid，阻止过账并要求迁移前人工核对。旧流水不补差额、不重算、不冒充新期初流水。新流水自切换点起可对账，历史仍需 P1 预检。

## 动作与契约

沿用 POST /stock/lots、POST /stock/import、POST /stock/inventory/txns、PATCH /stock/lots/:id、DELETE /stock/lots/:id；新增 POST /stock/lots/:id/archive，PATCH active=true 可恢复。创建/导入/过账/编辑/归档/删除均须 Idempotency-Key 请求头（或 body.idempotencyKey），1–128 个 ASCII 字母数字及 ._:-。同用户同键同操作与内容返回首次状态和响应；不同操作或内容 409。回执与库存、流水、审计在一个 withData 写事务提交。失败不保存回执。

PATCH 白名单为 lotNo/lot_no、serialNo/serial_no、location、notes、photoKey/photo_key、active、version；数量、物料、状态、ID、审计、历史字段不可直接改。可提供 version 乐观校验；盘点客户端必传当前 version，过期 409。过账 in/out/adjust/scrap，正数量（adjust 允许 0），订单引用必须存在；冻结、报废、停用批次禁止过账。adjust 仅 Owner，其他动作 Owner/Staff；Viewer 只读。scrap 要原因。归档保留余额和历史，并禁止后续过账。

有任何流水/订单批次引用、有余额或历史待核对的批次不可物理删除。耗材有关联批次/流水时不可删除；订单有库存流水关联时不可删除。不改变订单旧状态规则。HTTP 与 CSV 使用同一 createLotInData/postTransactionInData；AI 库存工具目前只读，不新增 AI 写入，库存摘要接同一公共服务，AI 确认订单及 CSV 订单创建继续共用订单服务。

## 错误与一致性

统一 {error:中文说明, code:稳定错误码}。400 INVALID_QUANTITY/INVALID_UNIT/INVALID_COMMAND/IDEMPOTENCY_KEY_REQUIRED/PROTECTED_LOT_FIELD；403 INVENTORY_FORBIDDEN；404 MATERIAL_NOT_FOUND/LOT_NOT_FOUND/ORDER_NOT_FOUND；409 INSUFFICIENT_STOCK/LOT_INACTIVE/LOT_REFERENCED/VERSION_CONFLICT/IDEMPOTENCY_CONFLICT/LEGACY_BALANCE_INVALID；意外故障 500，隐藏内部路径与数据库信息。

文件模式只支持单进程写队列；JSONB 模式继续整行 SELECT FOR UPDATE。业务函数只修改事务数据；无文件删除等外部副作用。P1 才引入关系库及预留，P0 不生成成本/生产事实。

## 客户端及验收

一次表单提交持有一个稳定命令键；网络超时后同内容重试复用，明确 4xx 失败后可修改重新提交。提交中拒绝重复点击；提交成功后锁定直至返回。新批次含期初量一次请求创建，避免创建成功后重复建批次。导入同一文件内容重试复用键。停用批次不可选，列表提供停用/恢复及历史待核对提示；盘点仅 Owner。

Node 测试仅临时目录，覆盖期初/盘点差额/非法精度/库存不足/并发/同键重试与冲突/CSV 整批回滚/HTTP 权限/删除引用/AI 摘要/注入故障后的事务回滚；基线验证及 Expo Web 构建。PostgreSQL 验证使用专用临时实例才运行，不连接用户数据库。
