# 2026-09-09 Compose 备份恢复演练

## 结论

在全新隔离部署中完成了真实 Linux/amd64 Compose 构建、Owner 初始化、持久化重启、PowerShell 冷备份、破坏性数据删除、隔离校验恢复及失败注入。恢复后的 serverId、登录、订单、附件、AI 会话和加密凭据均与备份基线一致。

独立 Linux 主机上的 `backup.sh` / `restore.sh` 实机演练不在本次证据范围内；两个脚本通过 `sh -n`。Git Bash/MSYS 会改写容器路径，因此不作为 Linux 验收环境。

## Docker 引擎修复

- 初始反馈闭环：连续两次 `docker info --format '{{.ServerVersion}}'` 均因 `dockerDesktopLinuxEngine` 管道不存在而失败。
- Docker Desktop 4.64.0 日志显示 Inference Manager 和 Secrets Engine 无法删除异常退出遗留的 AF_UNIX socket。
- 停止 Docker Desktop 用户态进程后，仅清理 `dockerInference`、`engine.sock` 和 Analytics 的运行时 socket；未重置或删除镜像、容器、卷及 WSL 数据盘。
- 修复结果：`Docker Engine 29.2.1 / Docker Desktop / x86_64`，原反馈闭环恢复为绿。

## 环境与构建

- 操作者：Codex，本地隔离演练。
- 源码提交：`0812011d9402c3d79af7042426836bf07c5dd102`。
- 输入归档：`.tmp/release-package/3d-manage-1.0.0.tar.gz`。
- Docker Compose：`v5.1.0`。
- PostgreSQL：`16.15 (Debian 16.15-1.pgdg12+2)`。
- Compose project：`manage3d-rehearsal-0909`。
- 宿主测试端口：`15080`；Windows 保留端口范围包含默认 `5000`，故隔离环境显式换端口。
- app 平台：`amd64/linux`。
- app 镜像 digest：`sha256:ecf673eb4543541c8d5841ed705817105ae3f857a2f4ef9d3897f22439332b7f`。

## 备份基线

- serverId：`9064e59d-600b-493b-99a6-ffa8b1f56212`。
- 初始化：首次 Owner bootstrap 成功，第二次返回 `409`。
- 数据：1 个 Owner、1 个订单、1 个附件、1 组加密 AI 设置、1 个 AI 会话及消息。
- 附件 SHA-256：`96f4e629f6d81236a25013a1c3153a92367ca3ac1631bb535194597919e8faa0`。
- app 重启后登录、serverId、订单、附件哈希及会话均保持。
- PostgreSQL 事务回滚和并发 Owner 初始化验证通过，临时测试表已删除。
- 基线备份：`.backups/20260909T091521Z`。
- manifest SHA-256：`0fc94c4e92a7d32440c0a2dfedb029e0c98bcc6d8e899442a382aa6b6bb9d15f`。
- database.dump SHA-256：`10497bde385dcac3cbb2a36ee61d3d24142df3f54a9f96be04de570d73462936`。
- files.tar.gz SHA-256：`3e7a66f08f344433cb8b1655e65b99a7452ee99dd2a412a9f9d2c935a78b8f20`。
- manifest 计数：users `1`、orders `1`、auditLogs `5`。

## 恢复过程与结果

1. 删除订单、附件、AI 设置、会话和消息，并确认 API 分别返回订单 `0`、会话 `0`、AI 设置 `404`、附件 `404`。
2. 创建恢复前保护备份 `.backups/20260909T091655Z`，manifest SHA-256 为 `442d9d14e307b0b5ce666e45f32c2324cae9ac074a4c9ebdb60e0e540132687a`。
3. 从基线备份恢复。脚本先恢复到隔离数据库，核对 serverId 和集合计数，再验证 SQLite 完整性与加密密钥，最后切换正式数据库和文件目录。
4. 实际恢复命令耗时约 `13.3 s`；原 runtime 保留在 `runtime.pre-restore.1788945446`。
5. 恢复后 app 为 healthy，Owner 登录成功，serverId 未变化，订单数恢复为 `1`，附件 SHA-256 与基线一致，会话 `rehearsal-conversation` 及消息恢复，两组 AI Key 均成功解密。

## 恢复守卫失败注入

| 场景 | 预期结果 | 正式目标状态 |
| --- | --- | --- |
| 错误加密密钥标识 | `Recovery encryption key does not match` | running/healthy，未变化 |
| manifest 文件哈希错误 | `Files archive hash mismatch` | running/healthy，未变化 |
| 损坏 dump 且同步更新 hash | `pg_restore` 失败 | running/healthy，未变化 |
| 文件归档包含 `../escape` | `Unsafe archive entry` | running/healthy，未变化 |

四个场景均以非零状态退出。失败注入后再次确认 serverId 仍为基线值、订单仍为 `1`。

## 演练中修复的问题

Linux `backup.sh` 失败时原本没有生成文档承诺的 `manifest.incomplete.json`。清理 trap 已补充失败标记，并以缺失 Docker CLI 的确定性失败场景验证：退出码 `127` 被写入 marker，操作锁正常释放。
