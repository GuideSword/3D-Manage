# Docker 后端一键管理脚本设计

## 目标

为 Windows + Docker Desktop 环境提供两个可双击入口：

- “一键安装并启动后端”负责补齐 Docker Desktop、初始化部署配置、构建并启动 Compose 后端，并配置当前 Windows 用户登录后的自动启动。
- “一键启动后端”负责恢复已有部署，确保停留在 `Created`、`Exited` 或未创建状态的后端服务真正运行并通过健康检查。

两个入口只管理 `compose.yaml` 中的 `init-volumes`、`db` 和 `app`，不安装、不启动、不修改 Expo/React Native 前端。

## 文件与职责

- `一键安装并启动后端.bat`：用户双击入口，以安装模式调用共享 PowerShell 脚本，保留窗口以展示结果。
- `一键启动后端.bat`：用户双击入口，以启动模式调用共享 PowerShell 脚本，保留窗口以展示结果。
- `deploy/docker-backend.ps1`：共享实现，负责环境检查、Docker Desktop 安装与启动、Compose 操作、健康验证、诊断输出及开机任务注册。

BAT 文件只负责稳定传递项目绝对路径、运行模式和退出码。所有业务逻辑集中在 PowerShell 文件，防止两个入口的行为逐渐不一致。

## 安装并启动流程

1. 将工作目录固定为脚本所在的项目根目录，并验证 `compose.yaml` 与 `deploy/init-config.mjs` 存在。
2. 检测 Docker Desktop，而不是只检测当前 `PATH` 中是否存在 `docker.exe`。
3. Docker Desktop 不存在时：
   - 检查 `winget` 是否可用；
   - 使用包标识 `Docker.DockerDesktop`、精确匹配和 `winget` 官方源安装运行时可获得的当前稳定版；
   - 接受源和软件包协议，并让安装程序按需触发 Windows 提权；
   - 安装失败时停止，不继续创建半完成部署。
4. 启动 Docker Desktop。优先使用受支持的 `docker desktop start`；CLI 尚不可用时，回退到 Docker Desktop 的标准安装路径启动程序。
5. 轮询 `docker info`，最多等待 180 秒。超时后输出 Docker Desktop 状态并失败退出。
6. `.env` 不存在时调用 `node deploy/init-config.mjs` 生成部署密钥；存在时保持原文件不变。若缺少 Node.js，则明确报错且不伪造配置。
7. 执行 `docker compose up -d --build`。该命令会创建或重建镜像，并启动所有后端依赖。
8. 等待 `db` 和 `app` 达到健康状态，再访问 `http://127.0.0.1:${APP_PORT}/api/system/info`。只有返回成功 HTTP 状态且响应包含 3D Manage 产品标识才算成功。
9. 注册当前用户登录触发的 Windows 计划任务。计划任务以隐藏、非交互模式调用共享脚本的启动模式；重复执行安装脚本时更新同名任务，不创建重复任务。
10. 输出本机和局域网访问地址、Compose 状态，以及获取初始化令牌的现有入口。

## 一键启动流程

1. 验证 Docker Desktop 已安装；未安装时提示用户改用“一键安装并启动后端”。
2. 启动 Docker Desktop 并等待 `docker info` 可用。
3. 验证 `.env` 已存在；缺失时提示用户改用安装入口，绝不使用示例密钥启动生产后端。
4. 执行 `docker compose up -d`，而不是 `docker compose start` 或 `restart`。这样可以同时覆盖未创建、`Created`、`Exited` 和已运行状态，并应用 Compose 当前配置。
5. 等待服务健康并验证 `/api/system/info`。
6. 成功时显示服务器地址；失败时显示 `docker compose ps -a` 和 `docker compose logs --tail 100 app`，并返回非零退出码。

## 开机自启动

Compose 已为 `db` 和 `app` 配置 `restart: unless-stopped`。安装入口额外注册当前 Windows 用户登录计划任务，解决 Docker Desktop 尚未运行或容器从未成功启动时，仅依赖重启策略无法恢复的问题。

计划任务调用启动模式，因此其行为是幂等的：服务已运行时只做状态收敛和健康验证，不删除容器、不清空数据、不重复初始化配置。

## 安全与数据保护

- 不覆盖现有 `.env`，不在日志中打印数据库密码、JWT 密钥、加密密钥或初始化令牌。
- 不执行 `docker compose down -v`、卷删除、镜像清理或任何 `runtime/` 删除操作。
- 不安装 Node.js、Expo 或前端依赖。
- 所有 Docker 命令显式指定项目目录，避免从错误目录操作同名 Compose 项目。
- 安装 Docker Desktop 是唯一可能触发管理员确认的步骤；脚本不绕过 Windows UAC。

## 错误处理

共享脚本统一捕获错误、以中文给出失败阶段和建议，并返回非零退出码。交互式 BAT 入口在退出前暂停，确保错误不会随窗口关闭而消失；计划任务模式不暂停、不弹出交互提示。

Docker Desktop 安装后若系统要求注销或重启，脚本明确提示并安全退出。Docker 引擎、Compose 启动或 API 健康验证失败时保留现有容器和数据，输出最小必要诊断信息。

## 验证

实现后至少验证以下场景：

1. Docker Desktop 已安装且运行，服务已经健康：两个入口均幂等成功。
2. Docker Desktop 已安装但未运行：两个入口能启动引擎并恢复服务。
3. `app` 容器处于 `Created`：启动入口执行后变为健康，覆盖本次故障。
4. `.env` 不存在：安装入口生成配置；启动入口拒绝使用示例配置。
5. Docker Desktop 不存在：安装入口经 `winget` 安装稳定版；启动入口给出正确引导。
6. `app` 启动失败：脚本返回非零退出码并显示状态及末尾日志。
7. 重复运行安装入口：不会覆盖 `.env`，计划任务保持单份且配置正确。
8. 静态检查确认脚本未引用 `npm start`、Expo、Metro 或任何前端启动命令。
