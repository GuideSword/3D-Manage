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
$script:StartupLog = Join-Path $script:ProjectRoot 'runtime\backend-startup.log'
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

function Test-DockerDesktopInstalled {
  param(
    [string]$DockerCli,
    [string]$DesktopExecutable
  )

  if ($DesktopExecutable) {
    return $true
  }
  if (-not $DockerCli) {
    return $false
  }

  & $DockerCli desktop version *> $null
  return $LASTEXITCODE -eq 0
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
  $port = 5800
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

function Get-ExcludedTcpPortRanges {
  $netsh = Get-Command netsh.exe -ErrorAction SilentlyContinue
  if (-not $netsh) {
    return @()
  }

  $output = & $netsh.Source interface ipv4 show excludedportrange protocol=tcp 2>$null
  if ($LASTEXITCODE -ne 0) {
    return @()
  }

  $ranges = @()
  foreach ($line in $output) {
    if ($line -match '^\s*(\d+)\s+(\d+)') {
      $ranges += [pscustomobject]@{
        Start = [int]$matches[1]
        End = [int]$matches[2]
      }
    }
  }
  return $ranges
}

function New-PortConflict {
  param(
    [Parameter(Mandatory = $true)][string]$Kind,
    [Parameter(Mandatory = $true)][int]$Port,
    [string]$Id,
    [string]$Name,
    [string]$Path,
    [string]$Details
  )

  return [pscustomobject]@{
    Kind = $Kind
    Port = $Port
    Id = $Id
    Name = $Name
    Path = $Path
    Details = $Details
  }
}

function Get-PortConflict {
  param([Parameter(Mandatory = $true)][int]$Port)

  $currentAppId = Get-ComposeContainerId -ServiceName 'app'
  $publishedContainers = @(
    Invoke-Docker -Arguments @(
      'ps',
      '--filter', "publish=$Port",
      '--format', '{{json .}}'
    )
  )
  foreach ($containerJson in $publishedContainers) {
    if (-not $containerJson) {
      continue
    }
    $container = $containerJson | ConvertFrom-Json
    $containerId = [string]$container.ID
    if ($currentAppId -and (
      $currentAppId.StartsWith($containerId, [System.StringComparison]::OrdinalIgnoreCase) -or
      $containerId.StartsWith($currentAppId, [System.StringComparison]::OrdinalIgnoreCase)
    )) {
      return New-PortConflict -Kind 'None' -Port $Port
    }
    return New-PortConflict `
      -Kind 'Docker' `
      -Port $Port `
      -Id $containerId `
      -Name ([string]$container.Names) `
      -Details ([string]$container.Ports)
  }

  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($listener) {
    $processId = [int]$listener.OwningProcess
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    $processName = if ($process) { [string]$process.ProcessName } else { 'unknown' }
    $processPath = $null
    if ($process) {
      try {
        $processPath = [string]$process.Path
      } catch {
        $processPath = $null
      }
    }
    return New-PortConflict `
      -Kind 'Process' `
      -Port $Port `
      -Id ([string]$processId) `
      -Name $processName `
      -Path $processPath `
      -Details "PID=$processId, process=$processName"
  }

  $blockedRange = @(Get-ExcludedTcpPortRanges) | Where-Object {
    $Port -ge $_.Start -and $Port -le $_.End
  } | Select-Object -First 1
  if ($blockedRange) {
    return New-PortConflict `
      -Kind 'Excluded' `
      -Port $Port `
      -Details "Windows reserved range $($blockedRange.Start)-$($blockedRange.End)"
  }

  return New-PortConflict -Kind 'None' -Port $Port
}

function Test-ProtectedProcess {
  param([Parameter(Mandatory = $true)]$Conflict)

  $protectedNames = @(
    'Idle',
    'System',
    'Registry',
    'smss',
    'csrss',
    'wininit',
    'services',
    'lsass',
    'winlogon'
  )
  $processId = 0
  [void][int]::TryParse([string]$Conflict.Id, [ref]$processId)
  return $processId -in @(0, 4, $PID) -or $Conflict.Name -in $protectedNames
}

function Show-PortConflict {
  param([Parameter(Mandatory = $true)]$Conflict)

  Write-Host ''
  Write-Host "宿主机端口 $($Conflict.Port) 当前不可用。" -ForegroundColor Yellow
  switch ($Conflict.Kind) {
    'Docker' {
      Write-Host "占用容器：$($Conflict.Name)"
      Write-Host "容器 ID：$($Conflict.Id)"
      Write-Host "端口映射：$($Conflict.Details)"
    }
    'Process' {
      Write-Host "占用进程：$($Conflict.Name)"
      Write-Host "PID：$($Conflict.Id)"
      if ($Conflict.Path) {
        Write-Host "程序路径：$($Conflict.Path)"
      }
    }
    'Excluded' {
      Write-Host "原因：$($Conflict.Details)"
      Write-Host '这是 Windows/Hyper-V 保留端口，没有可以终止的占用进程。'
    }
  }
}

function Write-StartupConflictLog {
  param([Parameter(Mandatory = $true)]$Conflict)

  $runtimeDirectory = Split-Path -Parent $script:StartupLog
  New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
  $safeDetails = ([string]$Conflict.Details) -replace '[\r\n]+', ' '
  $message = '{0} port={1} kind={2} details={3}' -f `
    (Get-Date).ToString('o'), $Conflict.Port, $Conflict.Kind, $safeDetails
  Add-Content -LiteralPath $script:StartupLog -Value $message -Encoding UTF8
}

function Set-AppPort {
  param([Parameter(Mandatory = $true)][int]$Port)

  $lines = [System.IO.File]::ReadAllLines($script:EnvFile)
  $replacement = "APP_PORT=$Port"
  $updated = $false
  for ($index = 0; $index -lt $lines.Length; $index++) {
    if (-not $updated -and $lines[$index] -match '^\s*APP_PORT\s*=') {
      $lines[$index] = $replacement
      $updated = $true
    }
  }
  if (-not $updated) {
    $lines += $replacement
  }

  $temporary = "$($script:EnvFile).port-$PID.tmp"
  $backup = "$($script:EnvFile).port-$PID.backup"
  try {
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($temporary, [string[]]$lines, $encoding)
    [System.IO.File]::Replace($temporary, $script:EnvFile, $backup)
  } finally {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force
    }
    if (Test-Path -LiteralPath $backup) {
      Remove-Item -LiteralPath $backup -Force
    }
  }

  Write-Host "已将宿主机端口更新为 $Port。" -ForegroundColor Green
}

function Read-AlternativePort {
  param([Parameter(Mandatory = $true)][int]$CurrentPort)

  while ($true) {
    $inputValue = (Read-Host '请输入其他宿主机端口（建议 5800 或 5600）').Trim()
    $candidate = 0
    if (-not [int]::TryParse($inputValue, [ref]$candidate)) {
      Write-Host '端口必须是整数，请重新输入。' -ForegroundColor Yellow
      continue
    }
    if ($candidate -lt 1 -or $candidate -gt 65535) {
      Write-Host '端口必须在 1–65535 之间，请重新输入。' -ForegroundColor Yellow
      continue
    }
    if ($candidate -eq $CurrentPort) {
      Write-Host '新端口不能与当前端口相同，请重新输入。' -ForegroundColor Yellow
      continue
    }

    $candidateConflict = Get-PortConflict -Port $candidate
    if ($candidateConflict.Kind -ne 'None') {
      Show-PortConflict -Conflict $candidateConflict
      Write-Host '该端口仍不可用，请重新输入。' -ForegroundColor Yellow
      continue
    }
    return $candidate
  }
}

function Stop-PortConflict {
  param([Parameter(Mandatory = $true)]$Conflict)

  switch ($Conflict.Kind) {
    'Docker' {
      Write-Host "正在停止容器 $($Conflict.Name)……"
      Invoke-Docker -Arguments @('stop', [string]$Conflict.Id)
      return $true
    }
    'Process' {
      if (Test-ProtectedProcess -Conflict $Conflict) {
        Write-Host '该进程属于系统关键进程或当前脚本，禁止自动终止。' -ForegroundColor Red
        return $false
      }
      Write-Host "正在终止进程 $($Conflict.Name)（PID $($Conflict.Id)）……"
      Stop-Process -Id ([int]$Conflict.Id) -Force
      return $true
    }
    'Excluded' {
      Write-Host '系统保留端口无法通过清理进程解决，请选择 B 更换端口。' -ForegroundColor Yellow
      return $false
    }
  }

  return $false
}

function Resolve-HostPortConflict {
  param([Parameter(Mandatory = $true)][int]$Port)

  while ($true) {
    $conflict = Get-PortConflict -Port $Port
    if ($conflict.Kind -eq 'None') {
      return $Port
    }

    Show-PortConflict -Conflict $conflict
    if ($NonInteractive) {
      Write-StartupConflictLog -Conflict $conflict
      throw ('非交互启动无法处理端口 {0} 冲突。请双击“一键启动后端.bat”进行处理。' -f $Port)
    }

    Write-Host ''
    Write-Host 'A：自动清理占用方并继续'
    Write-Host 'B：自行填写其他端口'
    $choice = (Read-Host '请选择 A 或 B').Trim().ToUpperInvariant()

    switch ($choice) {
      'A' {
        $attempted = Stop-PortConflict -Conflict $conflict
        if ($attempted) {
          Start-Sleep -Seconds 1
          $remaining = Get-PortConflict -Port $Port
          if ($remaining.Kind -eq 'None') {
            Write-Host "端口 $Port 已释放。" -ForegroundColor Green
            return $Port
          }
          Write-Host '清理后端口仍不可用，将重新显示选项。' -ForegroundColor Yellow
        }
      }
      'B' {
        $newPort = Read-AlternativePort -CurrentPort $Port
        Set-AppPort -Port $newPort
        return $newPort
      }
      default {
        Write-Host '无效选项，请输入 A 或 B。' -ForegroundColor Yellow
      }
    }
  }
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
  $desktopInstalled = Test-DockerDesktopInstalled `
    -DockerCli $script:DockerCli `
    -DesktopExecutable $desktopExecutable
  if (-not $desktopInstalled) {
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
  $port = Get-AppPort
  $port = Resolve-HostPortConflict -Port $port

  Write-Step '启动 Docker 后端'
  if ($Mode -eq 'Install') {
    Invoke-Compose -Arguments @('up', '-d', '--build')
  } else {
    Invoke-Compose -Arguments @('up', '-d')
  }

  Wait-BackendServices
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
