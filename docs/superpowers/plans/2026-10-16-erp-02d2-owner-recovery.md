# ERP 02D2 Task5：主机Owner恢复实施计划

> 延用已批准阶段02设计及主机恢复边界，逐项实施，不扩展TOTP/安全问题/通行密钥，不操作正式账号。

**Goal:** 日常Owner无法登录时，部署主机管理员能明确指定服务器和已有Owner，原子重置密码并注销原会话，保留审计。

**Architecture:** 关系专用主机服务加显式CLI；不挂HTTP，不加载dotenv或迁移。恢复只允许维护状态，取得共享维护锁→用户保护行→目标用户行；退出维护的排他锁须等待恢复结束。密码、用户version、token_version和NULL actor的host审计同事务提交。已有Owner可重新启用；不创建账号、不把Staff/Viewer提升为Owner，不改邮箱/姓名/角色或删除其他Owner。

**Tech Stack:** PostgreSQL16、现有bcrypt/密码校验/版本更新/用户保护、Node命令行与真实PG测试。

## 文件职责

- 新增 backend/modules/users/hostRecovery.js：显式serverId核验、只读Owner状态、维护内恢复事务，返回公开用户信息；复用用户验证和版本更新，不导入旧store或AI。
- 新增 backend/scripts/erp-owner-recovery.js：status/reset；显式--target-env/--server-id/--user-id，reset另需--expected-version/--reason/--password-env。密码只从指定环境读取，不放命令参数、不输出hash/密码/token；不默认DATABASE_URL。
- 新增 tests/backend/erp-owner-recovery.test.cjs；扩展 tests/ops/erp-02a-postgres.verify.ps1 suite owner-recovery。
- 旧 backend/scripts/reset-owner-password.js 先只读判定PG模式再加载旧store；关系模式拒绝并指向新命令，防止主机恢复误写旧JSONB。文件和旧JSONB继续使用原交互恢复。新增 docs/ERP_OWNER_RECOVERY.md 操作说明。
- 更新本计划、运行入口计划、总计划与验收记录。

## Task1：失败测试与CLI边界

- [x] 测试参数缺失、重复/未知字段、密码直接参数、错误serverId/legacy/未迁移拒绝；status只读不暴露hash，缺密码环境拒绝。
- [x] 新增隔离suite并观察缺模块失败，然后实现最小服务/CLI。

## Task2：维护内恢复与事务证据

- [x] reset严格校验字段、现有密码强度、用户/维护身份；仅maintenance状态可写，open拒绝。hash在事务前计算，事务内再校验serverId/状态及当前角色、version。
- [x] 锁序共享维护→user_write_guard→用户FOR UPDATE。version精确+1，token_version精确+1（防bigint溢出），active=true；不改role/name/email，不削减有效Owner。
- [x] 密码变更与host recovery审计原子，审计仅sessionsRevoked/reactivated/reason/source，不含密码/hash。审计失败全部回滚；过期version重试拒绝无重复审计。
- [x] 测试活跃/停用Owner恢复、Staff/Viewer拒绝、弱密码/错误身份/错误版本不写；原JWT失效，新密码开放后能登录，旧密码不能登录，其他用户不受影响。
- [x] 真实锁等待证明维护退出等待恢复事务完成；status不写且关闭CLI连接后可正常退出。

## Task3：回归、收尾与推进

- [x] owner-recovery、users、maintenance、server-runtime、system相关实际PG回归通过，无跳过；命令输出检查不含凭据，正式仅只读摘要对比。
- [x] 更新证据和精确提交；不向正式容器运行恢复命令。达到95%后进入Task6及02D3接线，阶段02保持未完成。

## 完成记录（2026-10-16）

达到约95%推进线。主机恢复专项最终10项、相关users18/maintenance9/server-runtime9/system5及中文用户错误3项，共54项Node检查通过，0跳过。真实PG锁等待、CLI成功恢复及凭据不输出已验证。正式只读摘要不变，未恢复正式账号。操作说明见 ../../ERP_OWNER_RECOVERY.md。进入Task6发布前检查与02D3同源接线；完整关系恢复/切换仍归02D4。
