# 3D Manage

3D Manage 是两部分交付的 3D 打印运营系统：客户安装 Expo/React Native 客户端，并在自己的基础设施运行 Express 后端。服务器地址在客户端运行时输入；正式安装包不绑定某个客户域名。

功能包括订单与状态流转、模型/附件、耗材库存、Owner 管理的 Staff/Viewer 权限、审计记录和可选 AI 助手。

## 开发

```powershell
npm install
npm --prefix backend install
npm run start:all
```

也可分别运行 `npm start` 与 `npm --prefix backend run dev`。开发启动脚本会生成仅用于本次本机开发的随机初始化密钥，不创建默认账号。

验证：

```powershell
npm run verify:client
npm run verify:backend
npm --prefix backend run verify:self-hosted
```

## 客户部署与运维

- [自托管部署](docs/SELF_HOSTING.md)
- [升级手册](docs/UPGRADE.md)
- [备份与恢复](docs/BACKUP_RESTORE.md)
- [发布检查清单](docs/RELEASE_CHECKLIST.md)

客户环境使用 Docker Compose、PostgreSQL 16、持久化 AI SQLite 和上传目录。开发启动方式不等同于客户部署；生产环境必须生成独立密钥、配置精确 CORS，并通过 HTTPS 暴露公网服务。

## 技术栈

- Expo 54 / React Native 0.81
- Express 5 / Node.js 22
- PostgreSQL 16（业务存储）与 SQLite（AI 会话）
- Docker Compose / 可选 Caddy HTTPS
