# 自托管部署

3D Manage 由可安装客户端和客户自管后端组成。后端保存账号、业务数据、AI 设置与文件；客户端首次启动时输入后端地址。

## 前提与网络

- x86_64 Linux 主机，Docker Engine 及 Docker Compose v2；本阶段未验证 ARM64。
- 推荐先为 `app` 分配 Compose 默认的 1.5 CPU / 2 GB；默认只允许一个上传请求。必须按实际 500 MB 上传与并发压力测试结果调整。这是保护性初始限制，不是最低硬件保证。
- 局域网 HTTP 开放 `APP_PORT`（默认宿主机 TCP 5800，容器内部仍为 5000）；公网必须使用受信任 HTTPS，并开放 TCP 80/443 与 UDP 443。
- Web 来源必须以精确的 scheme、host、port 写入 `CORS_ORIGINS`。Native 客户端没有 Origin；不要用 `*` 放宽 Web 来源。

## 快速启动

Windows + Docker Desktop 可以直接双击项目根目录中的：

- `一键安装并启动后端.bat`：Docker Desktop 不存在时通过 winget 安装当前稳定版，生成首次部署配置、构建并启动后端，并注册当前 Windows 用户登录后的自动启动任务。
- `一键启动后端.bat`：启动 Docker Desktop，并使用现有配置恢复 `Created`、`Exited` 或尚未创建的 Compose 后端。

两个入口只管理 Docker 后端，不安装或启动 Expo 前端。宿主机端口冲突时，选择 A 会在显示 PID/进程路径或容器名称后，经用户确认终止占用进程或停止冲突容器；选择 B 可输入其他有效端口并保存到 `.env`。Windows/Hyper-V 保留端口没有可清理进程，只能选择 B。登录自动启动任务不进行交互式清理，冲突会记录到 `runtime/backend-startup.log`。

新部署默认映射宿主机 `5800` 到容器内部 `5000`。如果脚本保存了其他端口，以成功信息和 `.env` 的 `APP_PORT` 为准。

也可以在项目根目录手动运行：

```powershell
node deploy/init-config.mjs
docker compose up -d --build
docker compose ps
curl.exe http://localhost:5800/api/system/info
docker compose logs -f app
```

配置生成器创建独立的数据库密码、JWT 密钥、AI 密钥加密密钥和一次性初始化令牌，并拒绝覆盖已有 `.env`。限制 `.env` 的读取权限，并将其作为独立恢复密钥包离线保存。Compose 的 `.env` 只用于变量插值；配置已逐项传入容器。

首次启动后，在客户端输入 `192.168.1.10:5800`（私网 IP 会规范化为 HTTP）或 `https://manage.example.com`。确认产品与 API 版本后，填写组织、Owner 和 `.env` 中的 `BOOTSTRAP_TOKEN`。令牌仅作为请求头发送，不保存在客户端或业务存储。Owner 登录后可在“设置 → 用户与权限”创建 Staff 与 Viewer。

数据持久化在：

- `runtime/postgres`：业务 JSONB 数据；
- `runtime/data`：AI SQLite 数据；
- `runtime/uploads`：本地上传文件。

删除 `runtime/` 会删除客户数据，升级流程绝不能删除它。

健康检查和日常命令：

```powershell
curl.exe http://localhost:5800/api/system/info
docker compose ps
docker compose logs --tail 200 app
docker compose stop
docker compose start
```

`/api/system/info` 必须返回 `product: "3D Manage"`、稳定的 `serverId` 与 `apiVersion: "1"`。服务健康同时要求 PostgreSQL、AI SQLite 及数据/上传目录可用。

## HTTPS

先让域名 A/AAAA 记录指向主机，在 `.env` 设置 `APP_DOMAIN` 与准确的 `CORS_ORIGINS=https://域名`，再运行：

```powershell
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

Caddy 自动申请并续期证书、关闭 SSE 响应缓冲，并把上传上限设为 500 MB。HTTPS 模式不向主机发布 app 的 5000 端口。不要关闭证书校验；自签证书只有安装为系统受信任根证书后才能测试。HTTPS Web 页面不能请求 HTTP API，这是浏览器混合内容限制，并非 CORS 故障。

## 会话验收

- 退出删除当前服务器 token 和 App 临时文件，保留服务器地址与主题。
- 从 A 更换到不可达 B 时，A 保持选中且 token 不变。
- 从 A 更换到可达 B 时，A token 被删除，B 成为当前服务器并要求登录。
- 以后返回 A 仍需登录，不能看到之前的页面、AI 流或临时数据。
- 清理失败时客户端保持登出并显示重试；不会宣称清理成功。

Web token 位于标签页 `sessionStorage`，关闭标签页即消失；Native token 位于 SecureStore。浏览器或用户明确导出的副本不属于可安全擦除的 App 临时文件。

## 文件存储与外部服务

不配置 OSS 和外部 AI 时，订单、库存、本地文件与基础管理仍可运行。若启用 OSS，密钥只放在后端 `.env`。单实例是当前支持模式，因为 AI SQLite 位于本地持久卷。

小鲤同一用户一次只运行一条对话，并限制单条消息长度及单次模型调用规模。

备份与恢复见 [BACKUP_RESTORE.md](./BACKUP_RESTORE.md)，升级见 [UPGRADE.md](./UPGRADE.md)。
