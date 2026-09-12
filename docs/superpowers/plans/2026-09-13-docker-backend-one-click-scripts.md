# Docker 后端一键管理脚本实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供两个 Windows 双击入口，分别完成 Docker Desktop 稳定版安装、后端部署与开机自启动，以及已有 Docker 后端的一键恢复启动。

**Architecture:** 两个 BAT 文件只负责选择运行模式和保留终端结果，共享的 `deploy/docker-backend.ps1` 负责全部 Docker Desktop、Compose、健康检查和计划任务逻辑。脚本通过项目绝对路径执行 Compose，以 `docker compose up -d` 收敛容器状态，并用真实 API 探测作为成功条件。

**Tech Stack:** Windows PowerShell 5.1、Docker Desktop、Docker Compose v2+、winget、Windows Task Scheduler

---

## 文件结构

- Create: `deploy/docker-backend.ps1` — 两种运行模式的共享实现。
- Create: `一键安装并启动后端.bat` — 安装模式双击入口。
- Create: `一键启动后端.bat` — 启动模式双击入口。
- Create: `tests/ops/docker-backend-scripts.verify.ps1` — PowerShell/BAT 静态契约验证。
- Modify: `docs/SELF_HOSTING.md` — 记录新入口、自动启动行为和诊断方式。

### Task 1: 添加脚本契约验证

**Files:**
- Create: `tests/ops/docker-backend-scripts.verify.ps1`

- [ ] **Step 1: 编写失败的静态契约验证**

验证文件存在、PowerShell 可解析、两个 BAT 传入正确模式、共享脚本包含稳定版 Docker Desktop 安装、Compose 收敛、API 验证和计划任务，同时拒绝前端命令与破坏性 Docker 命令。测试核心断言如下：

```powershell
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptPath = Join-Path $root 'deploy\docker-backend.ps1'
$installBat = Join-Path $root '一键安装并启动后端.bat'
$startBat = Join-Path $root '一键启动后端.bat'

foreach ($path in @($scriptPath, $installBat, $startBat)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing file: $path" }
}

$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw ($errors | ForEach-Object Message | Out-String) }

$script = Get-Content -LiteralPath $scriptPath -Raw
$install = Get-Content -LiteralPath $installBat -Raw
$start = Get-Content -LiteralPath $startBat -Raw

$required = @(
  'Docker.DockerDesktop',
  'docker info',
  'compose',
  'up',
  '/api/system/info',
  'Register-ScheduledTask',
  'restart: unless-stopped'
)
foreach ($pattern in $required) {
  if ($script -notmatch [regex]::Escape($pattern)) { throw "Missing contract text: $pattern" }
}
if ($install -notmatch '-Mode Install') { throw 'Install BAT does not select Install mode.' }
if ($start -notmatch '-Mode Start') { throw 'Start BAT does not select Start mode.' }

$forbidden = @('npm start', 'expo start', 'npx expo', 'docker compose down', 'down -v', 'docker volume rm')
foreach ($pattern in $forbidden) {
  if ($script -match [regex]::Escape($pattern)) { throw "Forbidden backend-script command: $pattern" }
}

Write-Host 'Docker backend script contract verification passed.' -ForegroundColor Green
```

- [ ] **Step 2: 运行验证并确认失败**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/ops/docker-backend-scripts.verify.ps1
```

Expected: FAIL，提示缺少 `deploy/docker-backend.ps1` 或两个 BAT 文件。

- [ ] **Step 3: 提交测试**

```powershell
git add -- tests/ops/docker-backend-scripts.verify.ps1
git commit -m "test(ops): define Docker backend launcher contract"
```

### Task 2: 实现共享 Docker 后端管理脚本

**Files:**
- Create: `deploy/docker-backend.ps1`
- Test: `tests/ops/docker-backend-scripts.verify.ps1`

- [ ] **Step 1: 建立参数、路径和外部命令边界**

脚本使用以下公开参数，并在任何操作前验证项目文件：

```powershell
param(
  [ValidateSet('Install', 'Start')]
  [string]$Mode = 'Start',
  [switch]$NonInteractive,
  [int]$DockerReadyTimeoutSeconds = 180,
  [int]$ServiceReadyTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$script:ProjectRoot = Split-Path -Parent $PSScriptRoot
$script:ComposeFile = Join-Path $script:ProjectRoot 'compose.yaml'
$script:EnvFile = Join-Path $script:ProjectRoot '.env'
$script:TaskName = '3D Manage Docker Backend'

if (-not (Test-Path -LiteralPath $script:ComposeFile -PathType Leaf)) {
  throw "未找到 Compose 配置：$script:ComposeFile"
}
```

添加 `Write-Step`、`Resolve-DockerCli`、`Resolve-DockerDesktopExecutable`、`Invoke-Docker` 和 `Invoke-Compose`。所有 Compose 调用必须等价于：

```powershell
& $docker compose --project-directory $script:ProjectRoot --env-file $script:EnvFile -f $script:ComposeFile @Arguments
if ($LASTEXITCODE -ne 0) { throw "Docker Compose 命令失败，退出码：$LASTEXITCODE" }
```

- [ ] **Step 2: 实现 Docker Desktop 稳定版安装与引擎等待**

`Install-DockerDesktop` 只在安装模式且无法解析 Docker Desktop/CLI 时运行：

```powershell
$winget = Get-Command winget.exe -ErrorAction SilentlyContinue
if (-not $winget) { throw '未找到 winget，无法自动安装 Docker Desktop 稳定版。' }
& $winget.Source install --id Docker.DockerDesktop -e --source winget `
  --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop 安装失败，退出码：$LASTEXITCODE" }
```

`Start-DockerDesktop` 优先运行 `docker desktop start`，失败或插件不可用时使用标准 `Docker Desktop.exe` 路径启动。`Wait-DockerEngine` 每两秒运行一次 `docker info`，直到成功或达到超时；不把普通等待输出当作错误。

- [ ] **Step 3: 实现部署配置保护与 Compose 状态收敛**

安装模式中 `.env` 不存在时检查 `node` 并运行：

```powershell
Push-Location $script:ProjectRoot
try {
  & $node.Source (Join-Path $script:ProjectRoot 'deploy\init-config.mjs')
  if ($LASTEXITCODE -ne 0) { throw "部署配置初始化失败，退出码：$LASTEXITCODE" }
} finally {
  Pop-Location
}
```

启动模式遇到 `.env` 缺失时直接失败并引导运行安装入口。安装模式执行 `up -d --build`；启动模式执行 `up -d`。不得调用 `start` 或 `restart` 代替 `up`。

- [ ] **Step 4: 实现容器健康等待和真实 API 验证**

分别通过 `docker compose ps -q db/app` 获取容器 ID，再用 `docker inspect` 读取 `.State.Status` 和 `.State.Health.Status`。只有 `db`、`app` 均为 `running/healthy` 才进入 API 验证。

从 `.env` 安全读取 `APP_PORT`，缺失时使用 5000；只允许 1–65535。API 验证使用：

```powershell
$response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/system/info" `
  -UseBasicParsing -TimeoutSec 10
$info = $response.Content | ConvertFrom-Json
if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300 -or $info.product -ne '3D Manage') {
  throw '后端 API 身份验证失败。'
}
```

失败路径调用 `Show-Diagnostics`，输出 `docker compose ps -a` 和 `docker compose logs --tail 100 app`，但不输出 `.env`。

- [ ] **Step 5: 实现登录自启动计划任务**

安装模式在后端验证成功后使用 Task Scheduler cmdlet 注册/更新当前用户任务：

```powershell
$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Mode Start -NonInteractive"
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $script:ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description '登录 Windows 后启动 3D Manage Docker 后端。' -Force | Out-Null
```

在脚本中保留字面说明 `restart: unless-stopped`，并验证 Compose 中 `db` 与 `app` 的重启策略确实为该值；不修改 Compose 文件。

- [ ] **Step 6: 运行静态验证**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/ops/docker-backend-scripts.verify.ps1
```

Expected: 仍 FAIL，因为两个 BAT 入口尚未创建，但 PowerShell 解析无错误。

- [ ] **Step 7: 提交共享实现**

```powershell
git add -- deploy/docker-backend.ps1
git commit -m "feat(ops): add Docker backend lifecycle manager"
```

### Task 3: 添加两个双击入口

**Files:**
- Create: `一键安装并启动后端.bat`
- Create: `一键启动后端.bat`
- Test: `tests/ops/docker-backend-scripts.verify.ps1`

- [ ] **Step 1: 创建安装入口**

```bat
@echo off
setlocal
cd /d "%~dp0"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\docker-backend.ps1" -Mode Install
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
```

- [ ] **Step 2: 创建启动入口**

```bat
@echo off
setlocal
cd /d "%~dp0"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\docker-backend.ps1" -Mode Start
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
```

- [ ] **Step 3: 运行静态契约验证**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/ops/docker-backend-scripts.verify.ps1
```

Expected: PASS，输出 `Docker backend script contract verification passed.`

- [ ] **Step 4: 提交入口**

```powershell
git add -- '一键安装并启动后端.bat' '一键启动后端.bat'
git commit -m "feat(ops): add one-click backend launchers"
```

### Task 4: 执行真实恢复验证并注册开机任务

**Files:**
- Verify: `deploy/docker-backend.ps1`
- Verify: `compose.yaml`

- [ ] **Step 1: 运行启动模式覆盖当前 Created 故障**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/docker-backend.ps1 -Mode Start
```

Expected: `manage3d-app-1` 从 `Created` 变为 `running/healthy`，API 身份验证成功。

- [ ] **Step 2: 验证 Compose 和 API**

Run:

```powershell
docker compose ps -a
curl.exe --fail http://127.0.0.1:5000/api/system/info
```

Expected: `db`、`app` 为 healthy，API JSON 的 `product` 为 `3D Manage`。

- [ ] **Step 3: 运行安装模式验证幂等性和任务注册**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/docker-backend.ps1 -Mode Install
Get-ScheduledTask -TaskName '3D Manage Docker Backend'
```

Expected: 不覆盖 `.env`，构建/启动成功，计划任务存在且状态为 Ready。

- [ ] **Step 4: 再次运行启动模式验证幂等性**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/docker-backend.ps1 -Mode Start
```

Expected: 已健康服务保持健康，命令成功退出。

### Task 5: 更新运维文档并完成回归

**Files:**
- Modify: `docs/SELF_HOSTING.md`
- Test: `tests/ops/docker-backend-scripts.verify.ps1`

- [ ] **Step 1: 在快速启动前增加 Windows 双击入口说明**

文档明确：安装入口会通过 winget 安装当前稳定版 Docker Desktop、保留已有 `.env`、构建后端并注册当前用户登录任务；启动入口只恢复既有 Docker 后端；两者均不管理前端。

- [ ] **Step 2: 运行全部相关验证**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/ops/docker-backend-scripts.verify.ps1
docker compose config --quiet
git diff --check
```

Expected: 三条命令全部成功，且没有空白错误。

- [ ] **Step 3: 检查没有误改用户现有工作**

Run:

```powershell
git status --short
git diff -- docs/SELF_HOSTING.md deploy/docker-backend.ps1 tests/ops/docker-backend-scripts.verify.ps1 '一键安装并启动后端.bat' '一键启动后端.bat'
```

Expected: 只显示本计划文件；仓库中原有前端修改保持原状且未被暂存。

- [ ] **Step 4: 提交文档与最终验证**

```powershell
git add -- docs/SELF_HOSTING.md tests/ops/docker-backend-scripts.verify.ps1
git commit -m "docs(ops): document one-click backend startup"
```
