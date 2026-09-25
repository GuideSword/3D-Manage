# 3D Manage Backend

Express API 提供 Owner 一次性初始化、JWT 认证、Owner/Staff/Viewer 权限、订单、模型、耗材、库存、审计、受保护文件与可选 AI/OSS 能力。

## 本地开发

```powershell
npm install
npm run store:init
npm run dev
```

开发默认使用 `STORE_DRIVER=file`，数据位于 `DATA_DIR/store.json`，上传位于 `UPLOAD_DIR`。首次账号通过 `POST /api/system/bootstrap` 与主机生成的初始化令牌创建；没有公开注册接口。

## 生产

生产基线是 Node.js 22 Bookworm Slim、PostgreSQL 16 和单个 app 副本。完整配置、端口、HTTPS 与持久化目录见 [自托管部署](../docs/SELF_HOSTING.md)。不要将 JWT、初始化、AI 加密或 OSS 密钥传给客户端。

主要检查：

```powershell
npm run verify:runtime
npm run verify
npm run verify:self-hosted
```

设置 `DATABASE_URL` 后可运行 `npm run verify:postgres`。旧文件业务存储先执行只读分析：

```powershell
node scripts/migrate-file-to-postgres.js --source C:\absolute\path\store.json --dry-run
```

正式迁移要求暂停写入、空 PostgreSQL 目标和源文件备份。AI SQLite 与上传文件必须和业务数据库作为同一冷备份恢复点迁移并校验 hash。

小鲤同一用户一次只运行一条对话。单条消息最多 1200 字，单次对话最多调用模型 4 轮，每轮最多输出 1536 token，文本输入上下文估算上限 8000 token（图片另按张数和大小限制）。这些限制由服务端校验。
