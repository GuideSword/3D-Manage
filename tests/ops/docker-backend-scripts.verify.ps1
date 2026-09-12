$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptPath = Join-Path $root 'deploy\docker-backend.ps1'
$installBat = Join-Path $root '一键安装并启动后端.bat'
$startBat = Join-Path $root '一键启动后端.bat'

foreach ($path in @($scriptPath, $installBat, $startBat)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing file: $path"
  }
}

$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
  $scriptPath,
  [ref]$tokens,
  [ref]$errors
)
if ($errors.Count -gt 0) {
  throw ($errors | ForEach-Object Message | Out-String)
}

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
  if ($script -notmatch [regex]::Escape($pattern)) {
    throw "Missing contract text: $pattern"
  }
}

if ($install -notmatch '-Mode Install') {
  throw 'Install BAT does not select Install mode.'
}
if ($start -notmatch '-Mode Start') {
  throw 'Start BAT does not select Start mode.'
}

$forbidden = @(
  'npm start',
  'expo start',
  'npx expo',
  'docker compose down',
  'down -v',
  'docker volume rm'
)
foreach ($pattern in $forbidden) {
  if ($script -match [regex]::Escape($pattern)) {
    throw "Forbidden backend-script command: $pattern"
  }
}

Write-Host 'Docker backend script contract verification passed.' -ForegroundColor Green
