# 升级运行手册

## 模型助手与批量导入

升级包含模型助手时，先下载新版本 ZIP，再用发布页提供的 `SHA256SUMS` 校验原始归档；不要只校验解压后的单个脚本。批量导入只支持 HTTPS 服务器和 STL、OBJ、3MF、STEP、STP；ZIP 解包受条目数与解压大小限制。

升级中断或电脑断电后，重新启动助手并选择恢复任务。它会把 `preparing`、`uploading`、`verifying` 的不完整项目修复为待处理状态，只保留已完成项目。取消任务会清理未完成服务端记录，不会删除已完成模型或源目录文件。默认 2 路并发，可设置 1–4 路。

模型事实摘要在本地生成；云端 AI 描述为明确的可选功能，关闭时不会上传源文件内容。卸载前按助手说明移除 `manage3d-model` 协议和当前用户目录。

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

## P0 库存规则升级（schema 3）

本阶段仍为文件/单行 JSONB 存储，未迁移到 ERP 关系表。升级前完成上述完整备份，并核对逐批次余额。首次启动自动将 schema 2 升到 3，新增 commandReceipts，保存旧批次切换余额及 legacy_unverified/legacy_invalid 标识，不重算旧流水、不改旧 qty；旧 adjust.qty 仍是调整后绝对数量。无效历史数量不会自动修正，正式迁移前必须人工处理。

后端与客户端须一起升级。库存创建、导入、过账、编辑、停用和删除必须带 Idempotency-Key；旧客户端缺键返回 400，直接编辑数量返回 400，删除有关联批次/耗材/订单返回 409，Staff 盘点返回 403。system/info.capabilities.inventoryRulesVersion=1；API 主版本继续为 1。

恢复验证需覆盖新批次及期初流水、200g 出库的同键重试、盘点差额、停用/恢复和库存导出。验证命令与操作示例见 [P0 库存说明](P0_INVENTORY.md)。历史余额待核对标记应在客户端可见，不能以启动成功代替对账。

schema 3 写入后不支持直接降级旧后端继续营业。回滚必须停写并恢复完整升级前快照和匹配应用版本；如已有新增业务，先导出新增单据、流水、审计和回执，核对处置后再恢复。不要只移除 commandReceipts 或降低 schemaVersion，这会失去幂等保护并允许旧接口再次改余额。
