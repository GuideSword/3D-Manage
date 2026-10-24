# ERP 02B1 只读预检验收（2026-10-15）

02B1 Tasks 1–5 已完成，主功能与验证达到约 95% 推进门槛。下一步为 02B2 核心关系表及隔离导入演练；整个 02B 和阶段 02 尚未完成。预检通过不代表迁移已批准或执行。

## 已交付

- file / PostgreSQL JSONB 原文读取，数字词法以字符串保留，SHA-256 绑定来源；不加载现有 store 初始化或隐式升级。
- PostgreSQL 显式 REPEATABLE READ READ ONLY；尝试写入由数据库拒绝，失败也关闭连接。
- 精确订单金额、库存基线及新账本、ID/角色/关联/版本检查；不重算保存历史订单，不把旧绝对盘点量累加为差额。
- 上传文件逐项大小与 SHA-256 核对，目录穿越及真实路径逃逸拒绝；外链仅报告、不请求。
- 新目录保存 snapshot.json、report.json、mappings.json、report.md、manifest.json；拒绝覆盖。客户逐订单生成独立建议，不按同名自动合并，mappings.approved 保持 false。

实现提交：`7c23ef8` 来源、`01786ed` 报告与产物、`d06f7e5` PostgreSQL 验证及补充约束。计划提交 `e465e8c`。

## 验证证据

| 验证 | 结果 |
| --- | --- |
| `npm run verify:erp:preflight` | 12/12，0 跳过，包含一次性 PostgreSQL 16 |
| `npm run verify:erp:foundation` | 17/17，0 跳过，包含实际 PostgreSQL 16 |
| 库存、编辑与备份既有回归 | 30/30，0 跳过 |
| 正式预检 | 0 blocker、2 review，状态 review_required |
| 正式业务及 AI 前后计数/hash | 完全相同 |
| 正式库 erp schema | 不存在 |
| app/db 健康与测试容器清理 | 正常；未遗留测试数据库容器 |

专项摘要位于 `.tmp/erp-02a/preflight-verification.json`，基础摘要位于 `.tmp/erp-02a/verification.json`。正式复检前后摘要为 `.tmp/erp-02a/02b1-final-before.json` 与 `02b1-final-after.json`。

正式报告：`runtime/migration-preflight/20261015T095318Z/`。来源 SHA-256：`fdfc1fe167994afa8f06bb24df3aa11830b85686b526019e311cb9ad3634d078`。复检使用 expected-source-hash 拒绝来源变化。1 笔订单金额及 7 个文件核对通过。

正式演练使用现有 app 镜像启动一次性进程，新预检代码与 uploads/data 只读挂载，产物另存报告目录；没有重启或更新正式后端。PostgreSQL 来源读取受只读事务约束。原文含账号 hash 与客户信息，只保存在忽略的受限运行目录，不提交 Git；Unix 创建权限为目录 0700/文件 0600，Windows 继承宿主权限。

## 需复核的两项

1. `CUSTOMER_MAPPING_REVIEW`：订单内嵌客户须建立独立客户档案。当前每笔订单建议单独建档并完整保留客户快照，不合并；真实导入必须使用与来源 hash 绑定的明确批准映射。
2. `AUDIT_ACTOR_SNAPSHOT_REVIEW`：一条历史审计关联的账号已不存在。按既定设计允许关系 actor_id 为空，保留原 actor ID 和历史记录；不能补造账号或删除审计。

这两项没有修改来源，也没有通过自动批准消除。后续在隔离库验证明确映射、引用、金额、文件及完整记录对账后，再准备正式迁移。现有 HTTP、CSV、AI 仍使用现有业务存储，没有双写。
