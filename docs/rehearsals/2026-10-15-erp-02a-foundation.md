# ERP 02A 执行记录（2026-10-15）

**最新状态：02A Tasks 1–6 已完成并验收，进入 02B 的只读预检。** 下方初始记录保留为历史，本次续推结果见后文。整个阶段 02 尚未完成。

## 初始状态：Task 1 完成时

01A 按会话恢复、实际中断重试、账号隔离、上下文预算、完整恢复和正式发布证据评估约 95%，现按既有[02A 计划](../superpowers/plans/2026-09-30-erp-02a-data-foundation.md)进入下一阶段。

已完成 Task 1：`backend/business-db/decimal.js` 与 `tests/backend/erp-decimal.test.cjs`，本地提交 `9ff0633`。测试先因模块缺失失败，实现后 5 组通过，覆盖精确缩放、非法/浮点输入拒绝、逐行四舍五入、PostgreSQL 数值边界和整分合计；库存回归 16/16、编辑回归 10/10 通过。

模块只接受十进制字符串或安全整数，内部使用 BigInt。数量三位、单价六位、行金额与合计固定两位字符串；拒绝非整数 Number、指数写法、负数、超过精度和金额范围的输入。基础数学允许零，具体业务数量正数约束由后续领域服务执行。

目前没有任何现有路由或业务服务导入该模块，没有创建专用关系表或修改正式数据库；原订单金额和库存仍走现有路径。02A 的独立连接、迁移登记、事务与版本更新尚未实现，02B–02D 未开始，不能将阶段 02 标记完成。

下一项：Task 2，独立 PostgreSQL 连接与带内容 hash 的迁移登记。执行时继续使用专用测试数据库，禁止回退到日常 DATABASE_URL。

## 本次续推与验收

| 项目 | 结果 | 本地提交 |
| --- | --- | --- |
| Task 2 专用连接、PG16 校验、迁移登记及 advisory lock | 并发首次迁移只执行一次；篡改、未来版本、历史缺口拒绝；迁移失败整批回滚 | `11efc47` |
| Task 3 统一事务 | 业务/审计/回执共同提交或回滚；回滚本身失败时保留原异常并丢弃连接 | `d43abdd` |
| Task 4 版本更新 | 并发同版本只允许一方保存；旧版本 409、缺失对象 404；审计失败使版本回滚 | `ad0a629` |
| Task 5 一次性 PostgreSQL 验证工具 | 随机密钥、本地随机端口、专用数据库；已有同名容器保留，失败后清理自建容器 | `517bf0d` |

`createBusinessPool({connectionString})` 必须接收显式连接串，不读取默认 DATABASE_URL 或 ERP 环境变量作回退；连接后校验 PG16。版本更新使用 `createVersionedUpdater(服务端表/列白名单)` 返回 `updateVersioned`，避免在生产模块硬编码测试探针表，表名/字段名不能由请求自行注册。bigint 版本以字符串传递，超过 JavaScript 安全整数仍能准确比较。SQL 迁移使用 scoped `.gitattributes` 固定 LF，防止跨平台换行改变已登记的内容 hash。

验证结果：

- `npm run verify:erp:foundation`：17/17 通过，0 跳过，包含实际独立 PostgreSQL 16；测试数据库 `erp_02a_verify`。
- `npm run verify:erp`：16/16；`npm run verify:edit`：10/10；`npm run verify:backup`：4/4。
- SQL v1 SHA-256：`a647a50c539cda135538b03ee198e44ecca93716f73dadc67368aff3bac4a9f4`。
- 错误注入确认：已有同名容器时脚本非零退出且不删除该容器；人为使 Node 测试失败后，本次创建的 PostgreSQL 容器被清理。最终成功运行后也无测试容器遗留。
- 正式服务只读前后核对一致：serverId `f5942634-5fdd-4964-abc6-3971b1787c0b`、schema 3，全部业务集合及 AI 表计数/hash 相同；正式数据库 `to_regnamespace('erp')` 为 null。未把本阶段模块接入现有 HTTP、CSV、AI 或订单计价路径。
- `git diff --check` 通过，只有既有工作区 CRLF 提示。其他未提交业务改动保留；package.json 仅将新增验证脚本选择性提交，未夹带原有依赖修改。

证据：`.tmp/erp-02a/verification.json`、`verification.log`、`runner-guards.json`；正式数据摘要位于 `.tmp/erp-02a-before.json` 和 `.tmp/erp-02a-after.json`。这些文件不包含明文账号密码或连接密钥，不作为 Git 数据备份。

## 下一执行位置：02B 只读预检

已读取当前业务集合的字段名、ID 状况及模型/材料引用数量，报告位于 `.tmp/erp-02a/02b-source-inventory.json`。当前 1 订单、3 模型、2 耗材，已检查引用中未发现模型/材料悬空；这只是源数据盘点，不是完整迁移预检通过。

下一步建立保留原数值文本的只读来源快照、逐订单金额/逐批次余额报告及待确认映射；随后才建立并演练核心关系表。02B–02D 的迁移、主数据 CRUD 与业务切换尚未交付，不在正式库自动建表或重算历史金额。
