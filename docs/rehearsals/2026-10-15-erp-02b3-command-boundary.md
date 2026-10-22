# ERP 02B3 Task 1 公共命令入口验收

2026-10-15：[02B3 计划](../superpowers/plans/2026-10-15-erp-02b3-business-services.md) Task 1 完成。Task 2–6 尚未完成，当前下一步是模型/耗材关系服务；阶段 02 仍未上线。

新增 `backend/business-db/commands.js`，领域模块在服务器启动时注册操作、角色与处理函数。请求不能注册表/列或修改角色规则。数据库读取当前账号并锁定，核对 active、role、token_version；忽略调用方传入的 role，Viewer 不允许注册写操作。

同一事务执行领域写入、至少一条审计、幂等回执。审计 actor 来自已核验账号；没有审计或结果无效拒绝提交。scope 由领域注册表指定，库存沿用 inventory，规范化摘要兼容既有库存 canonical({operation,payload})；同一 scope/actor/key 串行处理，持久回执可在进程重建后重放。重放之前仍核对权限。锁先取得命令身份，再锁账号，避免同键修改自身账号时重试方持有共享锁造成互锁。

命令 payload 在首次异步调用前复制；不允许循环、非 JSON、非有限数或不安全大整数，精确金额/数量继续由领域使用十进制字符串验证。SQL 外键/唯一/约束及并发冲突映射为可处理的 400/409；不自动重试产生外部副作用的业务回调。

实际 PostgreSQL 16 命令专项：**9/9，0 跳过**，命令为：

```powershell
pwsh -NoProfile -File tests/ops/erp-02a-postgres.verify.ps1 -Suite commands
```

覆盖：伪造 Owner、Viewer、停用账号与旧 token 拒绝；JSON 键顺序变化重放；持久回执；同键并发一次提交；不同键同版本竞争只允许一个成功；缺少审计、审计插入失败及回执插入失败时版本/业务/审计回滚；迁移库存回执不再执行处理函数；跨账号相同 key 独立；重放前权限降级拒绝；同键修改自身账号的并发重试正常复用结果。

证据 `.tmp/erp-02a/commands-verification.json` / `.log`，随机口令和本地随机端口的一次性数据库 `erp_02a_verify`，容器已清理。本包没有导入旧 store 或接线正式 HTTP/CSV/AI，未改 APK、正式数据库、文件或 AI SQLite。

余项：具体模型/文件、耗材、订单、库存、用户业务规则、最后有效 Owner 保护、读取 DTO 与适配仍须在 Task 2–6 实现验证。公共入口是事务与权限执行机制，不能替代这些领域规则。
