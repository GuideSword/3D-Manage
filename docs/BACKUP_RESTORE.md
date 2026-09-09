# 备份与恢复

备份只有在成功恢复演练后才可信。每次发布前及日常计划任务中都应创建冷备份，并把最新已验证副本加密保存到另一台机器。`.env`（尤其 `AGENT_KEY_ENC_SECRET`）必须作为受限恢复密钥包单独保存；丢失该密钥后，备份中的 AI 凭据无法解密。CSV 导出不能替代完整备份。

## 创建备份

PowerShell 7：

```powershell
pwsh -File deploy/backup.ps1 -DeploymentDirectory . -ProjectName manage3d -OutputDirectory .backups
```

Linux：

```sh
sh deploy/backup.sh --deployment-dir . --project-name manage3d --output-dir .backups
```

Windows 主机应使用 PowerShell 脚本。不要从 Git Bash/MSYS 直接运行 Linux 脚本；MSYS 会改写 `/tmp`、`/backup` 等容器内路径。Linux 脚本应在安装了 Docker CLI 与 Compose 插件的真实 Linux shell 中运行。

脚本取得与恢复/升级共享的锁，记录 app 原运行状态，停止 app，checkpoint AI SQLite，使用 `pg_dump -Fc` 生成 `database.dump`，归档 `runtime/data` 与 `runtime/uploads` 为 `files.tar.gz`，最后写入含 serverId、版本、hash 和加密密钥标识的 `manifest.json`。任一步失败会保留带 `manifest.incomplete.json` 的诊断目录，并只在原先运行时重启 app。

推荐每日备份、至少保留 7 个每日和 4 个每周已验证副本；确认最新已验证副本已离机后再修剪旧副本。Windows 任务计划程序或 Linux systemd timer/cron 应执行上述命令并监控非零退出码。

## 恢复守卫

恢复前记录备份 serverId。已有数据的目标必须另有一份已验证的恢复前备份；全新主机必须显式选择空目标模式。脚本先检查 manifest、schema/PostgreSQL 版本、文件 hash、归档路径穿越，再恢复到隔离测试数据库并核对 serverId。所有检查通过后才停止 app、切换数据/上传目录和正式数据库；旧目录保留在时间戳路径中。

PowerShell 示例：

```powershell
pwsh -File deploy/restore.ps1 -BackupDirectory .backups/20260908T120000Z -DeploymentDirectory . -ProjectName manage3d -ConfirmedServerId 00000000-0000-0000-0000-000000000000 -PreRestoreBackup .backups/20260908T110000Z
```

空主机恢复追加 `-AllowEmptyTarget`。Linux 使用对应参数：

```sh
sh deploy/restore.sh --backup-dir .backups/20260908T120000Z --deployment-dir . --project-name manage3d --confirmed-server-id 00000000-0000-0000-0000-000000000000 --allow-empty-target
```

恢复后可轮换 `JWT_SECRET` 使所有复制的旧 token 失效，并要求所有用户重新登录。

## 演练与证据

只在一次性测试部署演练：创建订单、上传已知 hash 文件、写入使用假 AI 服务的加密设置和会话；备份；删除数据；恢复；验证登录、订单、文件 hash、AI 会话和密钥解密。还需确认错误密钥、损坏 dump、损坏 hash 与路径穿越归档均在目标变更前失败。

记录日期、操作者、Git/镜像版本、serverId、备份路径、manifest hash、恢复耗时、数据库计数、文件 hash、登录结果和失败注入结果。恢复验证完成前不得删除旧数据库或 `runtime.pre-restore.*` 目录。

默认备份覆盖本地上传目录。若部署启用 OSS，远端对象不在此归档范围内；必须另行导出对象版本/清单并演练对象恢复，完成前不能把基础恢复演练标记为完整。
