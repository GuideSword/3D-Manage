# 自托管首版发布检查清单

只有全部必需项完成后才能标记阶段交付。外部条件缺失时保留未勾选状态。

## 2026-10-15 ERP 02B2 核心关系表与隔离导入

- [x] SQL v2 核心关系表、FK/唯一/精度约束、不可编辑审计/库存事实；v1→v2 隔离升级通过。
- [x] 核心表 9/9、导入 12/12、foundation 17/17、preflight 12/12，0 跳过；库存/编辑/备份 30/30。
- [x] 来源 hash 与逐项决策、原始数值/扩展字段、凭据/快照保留、并发重复导入幂等、中途失败整体回滚。
- [x] 正式快照副本在一次性 PG16 导入并重复执行对账；业务集合、客户/文件子记录、身份、金额和原始 JSON 一致。
- [x] 正式来源 hash、业务及 AI 摘要未变化；正式库没有 erp schema；演练容器已清理。
- [ ] 02B3 关系业务服务、02C 主数据页面、02D 正式同源切换与恢复。

证据见 [02B2 验收记录](rehearsals/2026-10-15-erp-02b2-core-import.md)。演练不构成正式客户映射批准，无 APK 或正式后端更新。

## 2026-10-15 ERP 02B1 只读迁移预检

- [x] 原文数值精度、来源 hash、只读 PostgreSQL 事务、金额/库存/关联及文件检查交付。
- [x] 专项 12/12（实际 PostgreSQL，无跳过）、02A 17/17、库存/编辑/备份 30/30 通过。
- [x] 正式来源只读演练：0 阻断、2 待复核；业务与 AI 前后摘要一致，正式库没有 erp schema，服务健康。
- [x] 独立客户映射仅为未批准建议；原文快照与报告保存在忽略的 runtime 目录，未作为源码提交。
- [x] 02B2 核心关系表与隔离导入演练，证据见下方 02B2 专项。
- [ ] 正式迁移映射批准、冷备份、停止业务写入、重新对账与切换（属于后续包）。

证据见 [02B1 执行记录](rehearsals/2026-10-15-erp-02b1-preflight.md)。本包不改客户端，无需 APK 更新。

## 2026-10-15 ERP 02A 基础模块验收

- [x] 精确金额、专用连接、迁移登记、单事务与乐观版本更新实现，17/17 专项验证通过，真实 PostgreSQL 用例无跳过。
- [x] 并发迁移只执行一次，历史 SQL 篡改/未来版本拒绝，迁移和审计失败整体回滚。
- [x] 同版本并发修改只允许一次成功，非法版本与未注册表/字段拒绝，bigint 版本不经浮点转换。
- [x] 一次性测试容器的同名保护、失败清理和成功清理验证通过；现有库存、编辑、备份回归通过。
- [x] 正式库与聊天记录的前后计数/hash 一致，正式库未新增 erp schema。
- [ ] 02B3–02D：关系业务服务、主数据页面与 HTTP/CSV/AI 正式切换尚未实施；隔离核心表与导入证据见 02B2。

证据见 [02A 执行记录](rehearsals/2026-10-15-erp-02a-foundation.md)。本包没有客户端界面变更或 APK 发布需求。

## 2026-09-29 编辑与库存升级

以下为此次发布证据，后文的 2026-09-08/09 检查记录保留为历史。

- [x] 编辑 9/9、库存 16/16、专用 PostgreSQL 12/12、客户端 25/25 和发布回归通过。
- [x] schema 3 冷备份/恢复及 schema 2 → 3 升级演练通过，旧余额和附件保留。
- [x] 恢复空目标、操作锁、WhatIf、集合计数和 APK 身份守卫通过。
- [x] 同签名 ARM64 APK 构建、签名校验和物理设备覆盖安装成功。
- [x] 物理设备验证配置保留、订单/模型/耗材/批次/姓名编辑、角色入口及返回刷新。
- [x] 批次资料保存断网后保留输入，恢复连接重试成功；版本冲突拒绝并支持重新加载。
- [x] 真机受保护模型文件下载/分享与断网出库重试；隔离 HTTP 已提交但响应丢失后，同键重试只过账一次。
- [x] 本机 Docker 正式目标完成发布前后完整备份、隔离恢复核对、schema 2 → 3 升级与对象/文件逐项核对。
- [x] 用户用日常账号在手机登录正式服务，并确认原订单和模型可见。
- [ ] 将最新已验证备份与恢复密钥包加密复制到另一台机器，演练离机恢复。

证据及产物见 [此次执行记录](rehearsals/2026-09-29-erp-release-execution.md)和[本机 Docker 升级记录](rehearsals/2026-09-30-local-docker-upgrade.md)。

## 自动与源码检查

- [x] `npm run verify:release` 本地通过（2026-09-08）。
- [x] 运行时地址规范化和客户端会话竞态测试通过。
- [x] 后端 runtime、API、自托管验证通过。
- [x] Web 独立导出通过。
- [x] 生产默认凭据与客户端对象存储密钥扫描已人工检查匹配项。
- [x] 发布归档生成器排除 `.env`、客户 runtime、签名私钥、依赖目录和日志。
- [x] EAS preview 签名 APK 构建成功，并完成本地下载与 SHA-256 校验（2026-09-09）。

## Compose 与恢复证据

- [x] 从发布归档在全新隔离目录构建 Linux/amd64 Compose，并记录 app 镜像 digest。
- [x] 全新 runtime 初始化 Owner，记录 serverId；初始化接口第二次调用返回 409。
- [x] 创建订单和上传文件后重启，登录、serverId、订单和文件 hash 保持。
- [x] PostgreSQL 事务/并发验证在专用测试表通过并自动清理。
- [x] PowerShell 冷备份生成有效 dump、文件归档和 manifest。
- [ ] 独立 Linux 主机上的 `backup.sh` / `restore.sh` 实机演练通过。
- [x] 删除测试数据后完整恢复订单、文件、AI 会话和加密凭据。
- [x] 错误密钥、损坏 dump、错误 hash、路径穿越在目标变更前失败。
- [ ] HTTPS 域名证书、SSE、500 MB 上传限制和精确 CORS 验证通过。

完整证据见 [2026-09-09 Compose 备份恢复演练](rehearsals/2026-09-09-compose-backup-restore.md)。

## 角色与客户端真机

- [x] 自动化验证 Staff 可创建订单，Viewer 不能通过普通或 Agent API 写入。
- [ ] 独立签名 preview APK 已在物理 Android 设备安装，Metro 与开发前端均关闭。
- [ ] 局域网 HTTP 地址运行时连接通过。
- [ ] 受信任 HTTPS 域名连接通过；未关闭证书校验。
- [ ] 从上一测试 APK 覆盖安装后，服务器设置保留且账号隔离正确。
- [ ] Native 文件读取、鉴权下载/分享、断网取消和退出临时文件清理通过。

## 发布记录

- 客户端版本：`1.0.0`
- Android package ID：`com.anonymous.x3DManage`（沿用现有 ID，首次外发前由发布方确认所有权）
- Android preview build number：`1`
- EAS project owner：`guidesword`；签名密钥由发布方 EAS 账户托管
- EAS build ID：`b160c8b9-d4b1-4930-b3e8-19b3184fa0cb`
- APK 构建 URL：<https://expo.dev/accounts/guidesword/projects/3D-Manage/builds/b160c8b9-d4b1-4930-b3e8-19b3184fa0cb>
- APK SHA-256：`B6FAB0F4A0A9150A5CAF1CF0325C891304146C58EC2B48C9D4D6589B5173CC3C`
- APK 本地校验路径：`.tmp/eas/3d-manage-1.0.0-preview-build-1.apk`（97,707,515 bytes，不纳入 Git）
- 后端镜像 tag：`3d-manage-backend:1.0.0`（源码构建标识，尚未发布）
- 本地演练镜像 digest：`sha256:ecf673eb4543541c8d5841ed705817105ae3f857a2f4ef9d3897f22439332b7f`
- 后端发布镜像 digest：尚未生成
- API / store schema / PostgreSQL：`1 / 2 / 16`
- 测试 serverVersion：`1.0.0`
- Git 提交：发布时以 `git rev-parse HEAD` 和 `release-manifest.json` 为准
- 检查日期：2026-09-09

当前发布状态：未完成。阻断项是独立 Linux 主机 shell 脚本演练、受信任 HTTPS 与物理设备验收。
