# Newcomer-Friendly README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the root README with a newcomer-friendly project overview and verified deployment paths for Windows, x86_64 Linux/Docker, and local development.

**Architecture:** Keep `README.md` as the short, task-oriented entry point: product overview first, a deployment selector second, then executable quick starts, first-run setup, architecture, security, operations, troubleshooting, and links to authoritative detail documents. Reuse existing implemented UI screenshots and existing scripts; do not change runtime code or duplicate the full self-hosting manual.

**Tech Stack:** GitHub Flavored Markdown, HTML image layout, PowerShell, Docker Compose v2, Node.js, Expo/React Native, Express, PostgreSQL 16, SQLite.

---

## File map

- Modify: `README.md` — project landing page, deployment selector, quick starts, first-run instructions, architecture, permissions, operations, and documentation index.
- Reference only: `package.json`, `backend/package.json` — source of development, build, and verification commands.
- Reference only: `compose.yaml`, `compose.https.yaml`, `.env.example` — source of ports, services, persistence, and production configuration.
- Reference only: `deploy/docker-backend.ps1`, `deploy/init-config.mjs`, `获取初始化令牌.ps1` — source of Windows and manual deployment behavior.
- Reference only: `docs/SELF_HOSTING.md`, `docs/UPGRADE.md`, `docs/BACKUP_RESTORE.md`, `docs/RELEASE_CHECKLIST.md`, `backend/README.md` — authoritative detailed documentation linked by the README.
- Reference only: `docs/ui-concepts/xiaoli-home-light-implemented.png`, `docs/ui-concepts/xiaoli-orders-light-implemented.png`, `docs/ui-concepts/xiaoli-models-light-implemented.png` — implemented interface previews embedded by the README.

### Task 1: Capture the missing newcomer contract

**Files:**
- Inspect: `README.md`

- [ ] **Step 1: Run a baseline content check**

Run:

```powershell
$readme = Get-Content -Raw README.md
@(
  '## 选择部署方式',
  '## Windows 一键部署',
  '## x86_64 Linux / Docker 部署',
  '## 连接客户端并初始化 Owner',
  'runtime/postgres',
  '常见问题'
) | ForEach-Object {
  if (-not $readme.Contains($_)) { throw "README 缺少：$_" }
}
```

Expected: FAIL on the first missing newcomer section. This confirms the existing README does not satisfy the approved design.

### Task 2: Replace the root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md` with the approved task-oriented content**

Use this complete file content:

````markdown
# 3D Manage

面向小型 3D 打印工作室的订单、模型与耗材运营管理系统。

3D Manage 由两部分组成：用户安装 **Expo / React Native 客户端**，团队在自己的电脑或服务器上运行 **Express 后端**。客户端首次打开时填写服务器地址，因此同一安装包可以连接不同的客户环境。

> 想直接部署？请跳到[选择部署方式](#选择部署方式)。第一次部署完成后，还需要在客户端[初始化 Owner](#连接客户端并初始化-owner)。

<p align="center">
  <img src="docs/ui-concepts/xiaoli-home-light-implemented.png" alt="3D Manage 运营首页" width="30%" />
  <img src="docs/ui-concepts/xiaoli-orders-light-implemented.png" alt="3D Manage 订单中心" width="30%" />
  <img src="docs/ui-concepts/xiaoli-models-light-implemented.png" alt="3D Manage 模型图鉴" width="30%" />
</p>

## 能做什么

| 模块 | 能力 |
| --- | --- |
| 订单 | 创建订单、查询筛选、状态流转、回收站恢复 |
| 模型 | 管理模型资料、图片和受保护附件 |
| 耗材 | 管理耗材、批次、入库、出库与库存调整 |
| 团队 | Owner、Staff、Viewer 分级权限 |
| 追溯 | 记录订单、模型、耗材和库存操作的审计信息 |
| 小鲤助手 | 可选 AI 对话、业务查询、图片理解与草稿确认 |
| 文件 | 默认保存到本地，也可由后端配置 OSS |

系统没有公开注册入口。首位 Owner 使用一次性初始化令牌创建账号，之后由 Owner 创建其他成员。

## 选择部署方式

| 你的场景 | 推荐入口 | 说明 |
| --- | --- | --- |
| Windows 10/11，想少敲命令 | [Windows 一键部署](#windows-一键部署) | 自动准备配置、启动 Docker 后端并设置登录后自启动 |
| x86_64 Linux 服务器 | [Docker Compose 部署](#x86_64-linux--docker-部署) | 适合局域网或配置 HTTPS 后用于公网 |
| 修改源码或调试功能 | [本地开发](#本地开发) | 启动 Expo Web 与文件存储后端 |

生产部署和本地开发是两套用途不同的运行方式。生产环境应使用 Docker Compose、PostgreSQL、独立密钥和持久化目录，不要把开发数据目录直接当作生产环境。

## Windows 一键部署

适合第一次部署的 Windows 用户。脚本只部署 Docker 后端，不安装或启动 Expo 客户端。

### 准备

- Windows 10/11 x64，并已启用虚拟化；
- [Node.js 20 或更高版本](https://nodejs.org/)；
- 将完整项目下载或克隆到本机，进入项目根目录；
- 如果尚未安装 Docker Desktop，请确保系统可以使用 `winget`。安装脚本会尝试安装当前稳定版；如果安装后暂时找不到 `docker.exe`，注销或重启 Windows 后重新运行即可。

### 部署步骤

1. 双击项目根目录的 `一键安装并启动后端.bat`。
2. 等待脚本启动 Docker Desktop、生成 `.env`、构建镜像并确认 `db` 与 `app` 容器健康。
3. 记下成功信息中的本机或局域网地址。默认地址是 `http://本机IP:5800`。
4. 双击 `获取初始化令牌.bat`。令牌会显示并复制到剪贴板。
5. 打开客户端，按[连接客户端并初始化 Owner](#连接客户端并初始化-owner)完成首次设置。

以后重启服务时，双击 `一键启动后端.bat`。首次安装脚本还会注册当前 Windows 用户登录后的自动启动任务。

如果 `5800` 端口已被占用，脚本会显示占用进程或容器，并让你选择清理占用方或改用其他端口。实际地址以脚本成功信息和 `.env` 中的 `APP_PORT` 为准。

## x86_64 Linux / Docker 部署

### 准备

- x86_64 Linux 主机；
- Docker Engine 与 Docker Compose v2；
- Node.js 20 或更高版本，仅用于首次生成安全配置；
- 建议先为应用预留约 1.5 CPU / 2 GB 内存，再根据上传文件大小和并发量调整。

在项目根目录运行：

```bash
node deploy/init-config.mjs
docker compose up -d --build
docker compose ps
curl http://localhost:5800/api/system/info
```

配置生成器会创建 `.env`，其中包含独立的数据库密码、JWT 密钥、AI 密钥加密密钥和一次性初始化令牌。为避免覆盖现有环境，已存在 `.env` 时生成器会直接退出。

健康接口应返回类似内容：

```json
{
  "product": "3D Manage",
  "serverId": "...",
  "apiVersion": "1"
}
```

查看首次初始化令牌：

```bash
grep '^BOOTSTRAP_TOKEN=' .env | cut -d= -f2-
```

默认端口是 `5800`。同一局域网中的客户端应填写服务器的局域网 IP，例如 `192.168.1.10:5800`，而不是客户端自己的 `localhost`。

### 公网 HTTPS

不要把明文 HTTP 后端直接暴露到公网。先让域名的 A/AAAA 记录指向服务器，再在 `.env` 中设置：

```dotenv
APP_DOMAIN=manage.example.com
CORS_ORIGINS=https://manage.example.com
```

然后启动带 Caddy 的 HTTPS 配置：

```bash
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

Caddy 会自动申请和续期证书。完整网络、CORS 与 HTTPS 说明见[自托管部署文档](docs/SELF_HOSTING.md)。当前生产基线是单个应用副本；本阶段未验证 ARM64。

## 连接客户端并初始化 Owner

后端健康后，仍需在客户端完成一次初始化：

1. 打开已安装的 3D Manage 客户端。开发调试时也可以按[本地开发](#本地开发)启动 Expo 客户端。
2. 输入服务器地址：局域网可用 `192.168.1.10:5800`，公网使用 `https://manage.example.com`。
3. 客户端确认服务器产品与 API 版本后，会进入初始化页面。
4. 填写组织名称、Owner 账号、密码和 `BOOTSTRAP_TOKEN`。
5. 初始化成功后登录，在“设置 → 用户与权限”中创建 Staff 或 Viewer。

初始化令牌仅用于创建首位 Owner。它作为请求头发送，不会保存在客户端或业务数据中；系统初始化完成后，再次使用会被拒绝。

客户端连接不到服务器时，先在服务器上运行健康检查，再确认防火墙已开放实际的 `APP_PORT`。Native 客户端没有浏览器 Origin；Web 客户端的来源必须精确加入 `CORS_ORIGINS`。

## 本地开发

### 环境要求

- Node.js 20 或更高版本；
- npm；
- Windows PowerShell；
- Android 调试还需要 Android Studio、模拟器或安装了 Expo Go 的真机。

安装依赖并同时启动后端与 Expo Web：

```powershell
npm install
npm --prefix backend install
npm run start:all
```

启动成功后：

- Web 客户端：`http://localhost:8081`
- 后端健康检查：`http://localhost:5000/health`
- 首次初始化令牌：显示在启动脚本输出中
- 日志：保存在 `.expo/` 与 `backend/` 下的启动日志文件中

开发启动脚本使用本地文件存储，并生成仅用于本机开发的随机密钥。它不会创建默认账号，也不等同于 Docker 生产部署。

常用前端命令：

```powershell
npm start
npm run web
npm run android
```

主要验证命令：

```powershell
npm run verify:client
npm run verify:agent-client
npm run verify:backend
npm --prefix backend run verify:self-hosted
```

维护者构建 Android 安装包时可使用：

```powershell
npm run build:android:preview
npm run build:android:production
```

这两个命令依赖 EAS 登录状态和有权限的 Expo 项目配置，不是后端部署的前置步骤。

## 架构概览

```text
Expo / React Native 客户端
            │ HTTPS / HTTP（仅受信任局域网）
            ▼
       Express API
        ├─ PostgreSQL 16：账号与业务数据
        ├─ SQLite：小鲤 AI 会话与记忆
        ├─ runtime/uploads：本地附件
        └─ 可选外部服务：OpenAI 兼容模型 / OSS
```

| 角色 | 权限边界 |
| --- | --- |
| Owner | 全部业务操作、用户管理、系统配置和数据导入导出 |
| Staff | 查看并编辑日常订单、模型、耗材与库存，不能管理用户和系统 |
| Viewer | 只读查看业务数据 |

技术栈：Expo 54、React Native 0.81、React 19、Express 5、Node.js 22 容器、PostgreSQL 16、SQLite、Docker Compose，以及可选 Caddy HTTPS。

## 数据与安全

Docker 部署的数据保存在项目根目录的以下位置：

| 路径 | 内容 |
| --- | --- |
| `runtime/postgres` | PostgreSQL 业务数据 |
| `runtime/data` | AI SQLite 数据 |
| `runtime/uploads` | 本地上传文件 |

> **不要删除 `runtime/`。** 删除它会删除客户业务数据、AI 数据和本地附件。升级前应创建冷备份，并把三个目录作为同一个恢复点处理。

生产环境还应遵守以下规则：

- 不要提交 `.env`，也不要把 JWT、初始化令牌、AI 加密密钥或 OSS 密钥发送给客户端；
- 将 `.env` 作为受限的独立恢复密钥包离线保存；
- 公网只使用受信任 HTTPS；
- `CORS_ORIGINS` 填写准确的 scheme、host 和 port，不要使用 `*`；
- 当前仅支持单个 `app` 副本，因为 AI SQLite 使用本地持久化目录。

备份和恢复步骤见[备份与恢复](docs/BACKUP_RESTORE.md)。

## 常用运维命令

```bash
# 查看容器状态
docker compose ps

# 查看后端最近 200 行日志
docker compose logs --tail 200 app

# 停止服务（保留数据）
docker compose stop

# 重新启动已有服务
docker compose start

# 检查 API 身份
curl http://localhost:5800/api/system/info
```

升级前请先阅读[升级运行手册](docs/UPGRADE.md)，不要使用会删除卷或 `runtime/` 的命令。

## 常见问题

### Docker 后端没有启动

先运行 `docker compose ps`，再运行 `docker compose logs --tail 200 app`。Windows 用户还应确认 Docker Desktop 已启动并完成初始化。

### `5800` 端口被占用

Windows 一键脚本会引导处理冲突。手动部署时可以修改 `.env` 中的 `APP_PORT`，重新执行 `docker compose up -d`，然后在客户端使用新端口。

### 后端健康，但手机连接失败

不要在手机上填写 `localhost`。填写运行后端电脑的局域网 IP，并检查系统防火墙是否允许实际端口入站。

### Web 页面提示跨域或 Mixed Content

将 Web 页面的精确来源加入 `CORS_ORIGINS`。HTTPS 页面不能请求 HTTP API；两端都应使用 HTTPS。

### 忘记初始化令牌

Windows 运行 `获取初始化令牌.bat`；Linux 从受限的 `.env` 中读取 `BOOTSTRAP_TOKEN`。如果系统已经初始化，该令牌不能再次创建 Owner。

## 文档

- [自托管部署](docs/SELF_HOSTING.md)：生产环境、网络、HTTPS 和会话验收
- [升级运行手册](docs/UPGRADE.md)：安全升级步骤
- [备份与恢复](docs/BACKUP_RESTORE.md)：冷备份、恢复守卫与演练
- [发布检查清单](docs/RELEASE_CHECKLIST.md)：发布前自动与真机检查
- [后端说明](backend/README.md)：后端开发、验证与数据迁移
- [产品需求](需求文档.md)：MVP 范围、业务流程与数据模型

## 项目结构

```text
3D-Manage/
├─ screens/、components/、navigation/  # Expo / React Native 客户端
├─ backend/                            # Express API 与数据访问
├─ deploy/                             # 初始化、备份、恢复与 Windows 部署脚本
├─ docs/                               # 部署、运维、设计与发布文档
├─ runtime/                            # Docker 持久化数据（不要删除或提交）
├─ compose.yaml                        # PostgreSQL + 应用服务
└─ compose.https.yaml                  # 可选 Caddy HTTPS
```
````

- [ ] **Step 2: Inspect only the intended diff**

Run:

```powershell
git diff -- README.md
```

Expected: only the root README is replaced. Existing modifications in `backend/README.md`, `docs/SELF_HOSTING.md`, source files, and tests remain untouched.

### Task 3: Verify the README against the repository

**Files:**
- Verify: `README.md`

- [ ] **Step 1: Re-run the newcomer content check**

Run:

```powershell
$readme = Get-Content -Raw README.md
@(
  '## 选择部署方式',
  '## Windows 一键部署',
  '## x86_64 Linux / Docker 部署',
  '## 连接客户端并初始化 Owner',
  'runtime/postgres',
  '## 常见问题'
) | ForEach-Object {
  if (-not $readme.Contains($_)) { throw "README 缺少：$_" }
}
Write-Host 'README newcomer contract: PASS'
```

Expected: `README newcomer contract: PASS`.

- [ ] **Step 2: Verify every local Markdown link and image target**

Run:

```powershell
$content = Get-Content -Raw README.md
$targets = [regex]::Matches($content, '(?:href=|src=")?\(?((?:docs|backend)/[^\s\)"#>]+)') |
  ForEach-Object { $_.Groups[1].Value } |
  Sort-Object -Unique
$missing = @($targets | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($missing.Count -gt 0) { throw "README 本地目标不存在：$($missing -join ', ')" }
Write-Host "README local targets: PASS ($($targets.Count))"
```

Expected: a `PASS` line and no missing paths.

- [ ] **Step 3: Verify documented scripts and Docker files exist**

Run:

```powershell
@(
  '一键安装并启动后端.bat',
  '一键启动后端.bat',
  '获取初始化令牌.bat',
  'deploy/init-config.mjs',
  'compose.yaml',
  'compose.https.yaml',
  '.env.example'
) | ForEach-Object {
  if (-not (Test-Path -LiteralPath $_)) { throw "部署入口不存在：$_" }
}
Write-Host 'README deployment targets: PASS'
```

Expected: `README deployment targets: PASS`.

- [ ] **Step 4: Run the existing self-hosted contract verification**

Run:

```powershell
npm --prefix backend run verify:self-hosted
```

Expected: the self-hosted verification exits with code `0` and reports its checks as passed.

- [ ] **Step 5: Check Markdown diff hygiene**

Run:

```powershell
git diff --check -- README.md
```

Expected: no output and exit code `0`.

- [ ] **Step 6: Confirm only the planned README is staged**

Run:

```powershell
git add -- README.md
git diff --cached --name-only
```

Expected: `README.md` is the only staged file. If any other file is listed, unstage that path without discarding its working-tree changes.

- [ ] **Step 7: Commit the README**

Run:

```powershell
git commit -m "docs: make deployment guide newcomer-friendly"
```

Expected: one documentation commit containing only `README.md`.
