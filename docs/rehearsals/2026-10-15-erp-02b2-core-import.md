# ERP 02B2 核心关系表与隔离导入验收

日期：2026-10-15。02B2 Tasks 1–3 已完成，主功能达到约 95% 推进门槛；下一步 02B3 核心关系业务服务。整个阶段 02 仍未交付，正式业务仍使用原存储。

## 实现与边界

SQL v2（提交 `47b2d0f`）建立用户、客户、供应商、仓库、模型/文件/图片、耗材、订单/行/附件、批次/流水、审计、回执、上传、来源及映射关系表。主键沿用 text，版本为正 bigint，FK 保护引用、业务编号唯一；同名客户可并存。numeric domain 拒绝非法精度、负值、溢出与非有限数，不靠 numeric(p,s) 静默取整。新库存流水验证方向和 before/after/delta；历史绝对盘点单独保留。审计、流水及回执拒绝更新/删除。

导入器及 CLI（提交 `e721eb7`）只允许专用隔离库，不回退到日常 DATABASE_URL，不执行正式切换。来源 raw/hash 重新验证、逐项 review 决策精确匹配、客户独立目标 ID 不得合并。单事务内插入身份、业务、映射与执行记录；异常整体回滚。同来源/决策重复运行复用既有导入，不重复写入；来源或决策变化拒绝覆盖。

预检树将数值保存为字符串用于计算，导入原始 JSON 则由 PostgreSQL 从原文提取，保留数值类型、超出 2^53 的精度及全部扩展字段。每条业务记录完整快照、原文、客户/规格/文件元数据、密码 hash、tokenVersion、原审计 actor 均保留。缺失历史账号的 FK 为空，原 ID 留在 legacy_actor_id 与原始快照。缺失模型保留订单行快照并置空当前引用。

源订单未提供业务编号时分配稳定的 `LEGACY-<原ID>`，客户独立编号为 `LEGACY-<来源顺序>`；新增默认仓库。缺失旧版本采用 1、缺失时间采用来源时间或本次导入时间，原始缺失状态仍保存在完整快照。库存仅复制已核对的余额、基线与历史流水，不创建新期初事实。已初始化的服务器身份沿用，storage_mode 保持 legacy。

## 实际验证

| 专项 | 结果 |
| --- | --- |
| core | 9/9，实际 PostgreSQL 16，包含 v1→v2 升级 |
| import | 12/12，实际 PostgreSQL 16；CLI 也实际执行 |
| foundation | 17/17；冻结 v1 测试契约，新版本在 core/import 验证 |
| preflight | 12/12 |
| 库存/编辑/备份回归 | 30/30 |

全部无跳过。导入用例覆盖逐项批准拒绝、同名不合并、超过 2^53 的实际 numeric 金额分位保持、原 JSON 类型、库存旧/新流水、账号凭据、附件、缺失历史 actor、并发幂等、变更决策拒绝、数据库中途失败与数据库篡改子快照时整体回滚、来源文件字节不变。

`0002_core.sql` SHA-256：`39ea6d04ace1aaf1571b9dd46fd42c12a8e2f70a5bd96e78bf3bb10380ee95d2`。v1 未修改。验证工具记录全部迁移文件 hash，测试容器使用随机口令/本地随机端口、专用数据库和所有权标签，结束后清理；不处理已有同名容器。

## 正式快照副本演练

命令（目标由工具创建在一次性容器内）：

```powershell
pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite import `
  -RehearsalSource runtime/migration-preflight/20261015T095318Z/snapshot.json `
  -RehearsalDecisions .tmp/erp-02a/02b2-rehearsal-decisions.json `
  -UploadDirectory runtime/uploads
```

来源 SHA-256：`fdfc1fe167994afa8f06bb24df3aa11830b85686b526019e311cb9ad3634d078`。最后一次演练 runId：`151c8fdc-5879-4c7a-992a-dff89fc64577`，首次 reused=false，重跑 reused=true，同一 runId。

导入并对账：1 用户、1 订单、3 模型、2 耗材、63 审计；批次/流水/上传登记/回执均为 0。客户独立档案、订单行、7 个文件/图片引用与原始 metadata 核对通过，实际文件 SHA-256 在导入前后复核。服务端身份、逐订单金额、所有根记录原始 JSON、子快照、来源映射均核对通过。演练决策文件明确标注仅隔离演练：客户单独建档、缺失历史 actor 保留快照并置空 FK。正式 `mappings.json` 仍为 approved=false。

证据：`.tmp/erp-02a/core-verification.json`、`import-verification.json`、`source-import-rehearsal.json`。正式前后业务/AI 摘要 `.tmp/erp-02a/02b2-before.json`、`02b2-after.json` 完全一致；正式 raw hash 仍等于上述来源，`to_regnamespace('erp')` 仍为空。未改正式后端或 APK，未操作 AI SQLite；演练库已随自建容器删除。

## 剩余工作

02B3 需实现关系模式订单、模型、耗材、库存、账号等业务服务与事务审计/幂等；02C 提供主数据 CRUD 与页面；02D 才执行 HTTP/CSV/AI 同源切换、旧客户端守卫、正式停写冷备份与恢复演练。最后有效 Owner、角色权限与客户端冲突交互必须在对应业务服务验收，不能仅凭 SQL 约束声明已交付。历史无效余额仍由预检阻断，不能通过本导入器自动清零或修正。正式客户映射批准仍待切换前完成。
