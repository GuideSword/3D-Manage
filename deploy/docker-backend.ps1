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
$script:InitConfigScript = Join-Path $PSScriptRoot 'init-config.mjs'
$script:TaskName = '3D Manage Docker Backend'
$script:DockerCli = $null

function Write-Step {
  param([string]$Message)

  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-DockerCli {
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @()
  if ($env:ProgramFiles) {
    $candidates += Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\resources\bin\docker.exe'
  }

  return $candidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
}

function Resolve-DockerDesktopExecutable {
  $candidates = @()
  if ($env:ProgramFiles) {
    $candidates += Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\Docker Desktop.exe'
  }
  if ($env:LOCALAPPDATA) {
    $candidates += Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe'
  }

  $standardPath = $candidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
  if ($standardPath) {
    return $standardPath
  }

  $uninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($uninstallRoot in $uninstallRoots) {
    $entry = Get-ItemProperty -Path $uninstallRoot -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -eq 'Docker Desktop' } |
      Select-Object -First 1
    if (-not $entry) {
      continue
    }

    $iconPath = [string]$entry.DisplayIcon
    if ($iconPath) {
      $iconPath = ($iconPath -split ',')[0].Trim().Trim('"')
      if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
        return $iconPath
      }
    }

    $installLocation = [string]$entry.InstallLocation
    if ($installLocation) {
      $installedExecutable = Join-Path $installLocation 'Docker Desktop.exe'
      if (Test-Path -LiteralPath $installedExecutable -PathType Leaf) {
        return $installedExecutable
      }
    }
  }

  return $null
}

function Test-DockerEngine {
  if (-not $script:DockerCli) {
    return $false
  }

  # The pass/fail signal here is equivalent to running: docker info
  & $script:DockerCli info --format '{{.ServerVersion}}' *> $null
  return $LASTEXITCODE -eq 0
}

function Invoke-Docker {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [switch]$IgnoreExitCode
  )

  if (-not $script:DockerCli) {
    throw 'Docker CLI 尚不可用。'
  }

  & $script:DockerCli @Arguments
  $exitCode = $LASTEXITCODE
  if (-not $IgnoreExitCode -and $exitCode -ne 0) {
    throw "Docker 命令失败，退出码：$exitCode"
  }
}

function Invoke-Compose {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [switch]$IgnoreExitCode
  )

  $composeArguments = @(
    'compose',
    '--project-directory', $script:ProjectRoot,
    '--env-file', $script:EnvFile,
    '-f', $script:ComposeFile
  ) + $Arguments

  Invoke-Docker -Arguments $composeArguments -IgnoreExitCode:$IgnoreExitCode
}

function Install-DockerDesktop {
  Write-Step '安装 Docker Desktop 当前稳定版'

  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    throw '未找到 winget，无法自动安装 Docker Desktop 稳定版。请先安装“应用安装程序”，再重试。'
  }

  & $winget.Source install `
    --id Docker.DockerDesktop `
    --exact `
    --source winget `
    --accept-package-agreements `
    --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop 安装失败，winget 退出码：$LASTEXITCODE"
  }

  $script:DockerCli = Resolve-DockerCli
  if (-not $script:DockerCli) {
    throw 'Docker Desktop 已完成安装，但当前会话尚未发现 docker.exe。请注销或重启 Windows 后再次运行此脚本。'
  }
}

function Start-DockerDesktop {
  if (Test-DockerEngine) {
    Write-Host 'Docker 引擎已经运行。'
    return
  }

  Write-Step '启动 Docker Desktop'

  $desktopCommandStarted = $false
  if ($script:DockerCli) {
    & $script:DockerCli desktop start *> $null
    $desktopCommandStarted = $LASTEXITCODE -eq 0
  }

  if (-not $desktopCommandStarted) {
    $desktopExecutable = Resolve-DockerDesktopExecutable
    if (-not $desktopExecutable) {
      throw '找不到 Docker Desktop 启动程序。请运行“一键安装并启动后端”。'
    }
    Start-Process -FilePath $desktopExecutable -WindowStyle Hidden | Out-Null
  }
}

function Wait-DockerEngine {
  $deadline = (Get-Date).AddSeconds($DockerReadyTimeoutSeconds)
  do {
    if (Test-DockerEngine) {
      Write-Host 'Docker 引擎已就绪。' -ForegroundColor Green
      return
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "等待 Docker 引擎超时（$DockerReadyTimeoutSeconds 秒）。请打开 Docker Desktop 查看启动状态。"
}

function Initialize-DeploymentConfig {
  if (Test-Path -LiteralPath $script:EnvFile -PathType Leaf) {
    Write-Host '检测到现有 .env，保持不变。'
    return
  }

  if ($Mode -ne 'Install') {
    throw '未找到 .env。请先运行“一键安装并启动后端”。'
  }

  if (-not (Test-Path -LiteralPath $script:InitConfigScript -PathType Leaf)) {
    throw "未找到部署配置生成器：$script:InitConfigScript"
  }

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    throw '生成首次部署密钥需要 Node.js，但当前未安装。脚本不会安装或启动任何前端依赖。'
  }

  Write-Step '生成首次部署配置'
  Push-Location $script:ProjectRoot
  try {
    & $node.Source $script:InitConfigScript
    if ($LASTEXITCODE -ne 0) {
      throw "部署配置初始化失败，退出码：$LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Assert-RestartPolicies {
  $configOutput = @(Invoke-Compose -Arguments @('config', '--format', 'json')) -join [Environment]::NewLine
  try {
    $config = $configOutput | ConvertFrom-Json
  } catch {
    throw '无法解析 Docker Compose 配置，请确认 Docker Compose v2 可用。'
  }

  $requiredRestartPolicy = 'unless-stopped' # Compose equivalent: restart: unless-stopped
  foreach ($serviceName in @('db', 'app')) {
    $service = $config.services.$serviceName
    if (-not $service -or $service.restart -ne $requiredRestartPolicy) {
      throw "Compose 服务 $serviceName 必须配置 restart: unless-stopped。"
    }
  }
}

function Get-ComposeContainerId {
  param([Parameter(Mandatory = $true)][string]$ServiceName)

  $id = @(Invoke-Compose -Arguments @('ps', '-q', $ServiceName)) -join ''
  return $id.Trim()
}

function Get-ContainerState {
  param([Parameter(Mandatory = $true)][string]$ContainerId)

  $json = @(Invoke-Docker -Arguments @('inspect', '--format', '{{json .State}}', $ContainerId)) -join ''
  return $json | ConvertFrom-Json
}

function Wait-BackendServices {
  $deadline = (Get-Date).AddSeconds($ServiceReadyTimeoutSeconds)
  $lastSummary = ''

  do {
    $ready = $true
    $parts = @()
    foreach ($serviceName in @('db', 'app')) {
      $containerId = Get-ComposeContainerId -ServiceName $serviceName
      if (-not $containerId) {
        $parts += "$serviceName=missing"
        $ready = $false
        continue
      }

      $state = Get-ContainerState -ContainerId $containerId
      $health = if ($state.Health) { [string]$state.Health.Status } else { 'none' }
      $parts += "$serviceName=$($state.Status)/$health"
      if ($state.Status -ne 'running' -or $health -ne 'healthy') {
        $ready = $false
      }
    }

    $summary = $parts -join ', '
    if ($summary -ne $lastSummary) {
      Write-Host "容器状态：$summary"
      $lastSummary = $summary
    }
    if ($ready) {
      Write-Host 'Docker 后端容器已健康。' -ForegroundColor Green
      return
    }

    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  throw "等待后端容器健康超时（$ServiceReadyTimeoutSeconds 秒）。最后状态：$lastSummary"
}

function Get-AppPort {
  $port = 5000
  $line = Get-Content -LiteralPath $script:EnvFile |
    Where-Object { $_ -match '^\s*APP_PORT\s*=' } |
    Select-Object -First 1
  if ($line) {
    $rawPort = ($line -replace '^\s*APP_PORT\s*=\s*', '').Trim().Trim('"').Trim("'")
    $parsedPort = 0
    if (-not [int]::TryParse($rawPort, [ref]$parsedPort) -or $parsedPort -lt 1 -or $parsedPort -gt 65535) {
      throw "APP_PORT 无效：$rawPort"
    }
    $port = $parsedPort
  }
  return $port
}

function Test-BackendApi {
  param([Parameter(Mandatory = $true)][int]$Port)

  Write-Step '验证后端 API'
  $url = "http://127.0.0.1:$Port/api/system/info"
  $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
  $info = $response.Content | ConvertFrom-Json
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300 -or $info.product -ne '3D Manage') {
    throw '后端 API 身份验证失败。'
  }

  Write-Host "API 验证成功：$url" -ForegroundColor Green
  return $info
}

function Register-BackendStartupTask {
  Write-Step '设置 Windows 登录后自动启动'

  $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Mode Start -NonInteractive' -f $PSCommandPath
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action = New-ScheduledTaskAction `
    -Execute $powerShell `
    -Argument $arguments `
    -WorkingDirectory $script:ProjectRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

  Register-ScheduledTask `
    -TaskName $script:TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description '登录 Windows 后启动 3D Manage Docker 后端。' `
    -Force | Out-Null

  Write-Host "开机任务已设置：$script:TaskName" -ForegroundColor Green
}

function Get-LanIpv4Addresses {
  if (-not (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue)) {
    return @()
  }

  return @(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue |
    Where-Object {
      -not $_.SkipAsSource -and
      $_.IPAddress -ne '127.0.0.1' -and
      $_.InterfaceAlias -notmatch 'vEthernet|VMware|VirtualBox|Tailscale'
    } |
    Select-Object -ExpandProperty IPAddress -Unique)
}

function Show-Success {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)]$ServerInfo
  )

  Write-Host ''
  Write-Host '3D Manage Docker 后端已启动。' -ForegroundColor Green
  Write-Host "本机地址：http://127.0.0.1:$Port"
  foreach ($address in @(Get-LanIpv4Addresses)) {
    Write-Host "局域网地址：http://${address}:$Port"
  }
  if ($ServerInfo.serverId) {
    Write-Host "服务器 ID：$($ServerInfo.serverId)"
  }
  Write-Host '初始化令牌可通过“获取初始化令牌.bat”查看。'
}

function Show-Diagnostics {
  if (-not $script:DockerCli -or -not (Test-Path -LiteralPath $script:EnvFile -PathType Leaf)) {
    return
  }

  Write-Host ''
  Write-Host 'Docker 后端状态：' -ForegroundColor Yellow
  Invoke-Compose -Arguments @('ps', '-a') -IgnoreExitCode
  Write-Host ''
  Write-Host '后端最近 100 行日志：' -ForegroundColor Yellow
  Invoke-Compose -Arguments @('logs', '--tail', '100', 'app') -IgnoreExitCode
}

function Invoke-Main {
  if (-not (Test-Path -LiteralPath $script:ComposeFile -PathType Leaf)) {
    throw "未找到 Compose 配置：$script:ComposeFile"
  }

  Write-Host '3D Manage Docker 后端一键管理'
  Write-Host "项目目录：$script:ProjectRoot"
  Write-Host "运行模式：$Mode"

  $script:DockerCli = Resolve-DockerCli
  $desktopExecutable = Resolve-DockerDesktopExecutable
  if (-not $script:DockerCli -and -not $desktopExecutable) {
    if ($Mode -ne 'Install') {
      throw '未安装 Docker Desktop。请运行“一键安装并启动后端”。'
    }
    Install-DockerDesktop
  }

  if (-not $script:DockerCli) {
    $script:DockerCli = Resolve-DockerCli
  }
  if (-not $script:DockerCli) {
    throw '未找到 docker.exe。请确认 Docker Desktop 安装完整后重试。'
  }

  Start-DockerDesktop
  Wait-DockerEngine
  Initialize-DeploymentConfig
  Assert-RestartPolicies

  Write-Step '启动 Docker 后端'
  if ($Mode -eq 'Install') {
    Invoke-Compose -Arguments @('up', '-d', '--build')
  } else {
    Invoke-Compose -Arguments @('up', '-d')
  }

  Wait-BackendServices
  $port = Get-AppPort
  $serverInfo = Test-BackendApi -Port $port

  if ($Mode -eq 'Install') {
    Register-BackendStartupTask
  }

  Show-Success -Port $port -ServerInfo $serverInfo
}

try {
  Invoke-Main
  exit 0
} catch {
  Write-Host ''
  Write-Host ("错误：" + $_.Exception.Message) -ForegroundColor Red
  try {
    Show-Diagnostics
  } catch {
    Write-Host ("诊断信息获取失败：" + $_.Exception.Message) -ForegroundColor Yellow
  }
  exit 1
}
