# 升级运行手册

1. 阅读目标版本发行说明，记录当前 Git 提交、镜像 digest、serverId 与 PostgreSQL major。
2. 按 [BACKUP_RESTORE.md](./BACKUP_RESTORE.md) 创建完整备份，并确认 `manifest.json` 为 `complete`。
3. 保留上一版本镜像和最近一次已演练备份。`.env` 与 `runtime/` 不得被包替换、Git 清理或复制脚本覆盖。
4. 使用共享操作锁，停止 app，替换源码/发布包，然后构建：

```powershell
docker compose stop app
docker compose build --pull app
docker compose up -d
docker compose ps
curl.exe http://localhost:5800/api/system/info
```

5. 等待 app 健康，核对 serverId 与升级前一致，再验证 Owner 登录、Staff 新建订单、Viewer 只读、附件下载和 AI 设置解密。
6. 检查 `docker compose logs --tail 200 app`，确认没有 schema、SQLite、目录权限或密钥错误。

若升级失败，立即停止 app，恢复上一版本镜像。数据 schema 已变更或业务验证失败时，按恢复手册使用升级前备份整体恢复 PostgreSQL、`runtime/data` 和 `runtime/uploads`；禁止混用新数据库与旧文件目录。回滚成功后再次核对 serverId、登录和文件 hash。
