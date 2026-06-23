param(
  [int]$BackendPort = 3002,
  [int]$FrontendPort = 8081
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $Root 'backend'
$ExpoDir = Join-Path $Root '.expo'
$BackendOutLog = Join-Path $BackendDir 'backend-3002.out.log'
$BackendErrLog = Join-Path $BackendDir 'backend-3002.err.log'
$FrontendOutLog = Join-Path $ExpoDir 'expo-web.out.log'
$FrontendErrLog = Join-Path $ExpoDir 'expo-web.err.log'

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Get-Listener {
  param([int]$Port)
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Ensure-NodeModules {
  param(
    [string]$Directory,
    [string]$Label
  )

  $nodeModules = Join-Path $Directory 'node_modules'
  if (Test-Path -LiteralPath $nodeModules) {
    Write-Host "$Label dependencies found."
    return
  }

  Write-Step "Installing $Label dependencies"
  Push-Location $Directory
  try {
    npm install
  } finally {
    Pop-Location
  }
}

function Wait-Url {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $statusCode = & curl.exe -s -o NUL -w "%{http_code}" --max-time 4 $Url 2>$null
    if ($LASTEXITCODE -eq 0 -and $statusCode -match '^(2|3)\d\d$') {
      return $true
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Start-Backend {
  if (Get-Listener -Port $BackendPort) {
    Write-Host "Backend port $BackendPort is already listening; reusing it."
    return
  }

  Write-Step "Starting backend on port $BackendPort"
  $env:PORT = [string]$BackendPort
  if (-not $env:JWT_SECRET) {
    $env:JWT_SECRET = 'dev-local-secret'
  }
  if (-not $env:STORE_DRIVER) {
    $env:STORE_DRIVER = 'file'
  }

  Start-Process `
    -FilePath 'node' `
    -ArgumentList 'server.js' `
    -WorkingDirectory $BackendDir `
    -RedirectStandardOutput $BackendOutLog `
    -RedirectStandardError $BackendErrLog `
    -WindowStyle Hidden | Out-Null
}

function Start-Frontend {
  if (Get-Listener -Port $FrontendPort) {
    Write-Host "Frontend port $FrontendPort is already listening; reusing it."
    return
  }

  Write-Step "Starting Expo Web on port $FrontendPort"
  $env:EXPO_PUBLIC_API_BASE_URL = "http://localhost:$BackendPort/api"
  $env:EXPO_NO_TELEMETRY = '1'

  $npx = if (Get-Command npx.cmd -ErrorAction SilentlyContinue) { 'npx.cmd' } else { 'npx' }
  Start-Process `
    -FilePath $npx `
    -ArgumentList @('expo', 'start', '--web', '--port', [string]$FrontendPort) `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $FrontendOutLog `
    -RedirectStandardError $FrontendErrLog `
    -WindowStyle Hidden | Out-Null
}

Write-Host "3D Manage one-click startup"
Write-Host "Project: $Root"

Require-Command 'node'
Require-Command 'npm'
Require-Command 'curl.exe'

New-Item -ItemType Directory -Force -Path $ExpoDir | Out-Null

Ensure-NodeModules -Directory $Root -Label 'frontend'
Ensure-NodeModules -Directory $BackendDir -Label 'backend'

Write-Step "Initializing backend store"
npm --prefix $BackendDir run store:init

Start-Backend
Start-Frontend

Write-Step "Checking services"
$backendReady = Wait-Url -Url "http://localhost:$BackendPort/health" -TimeoutSeconds 30
$frontendReady = Wait-Url -Url "http://localhost:$FrontendPort" -TimeoutSeconds 60

if (-not $backendReady) {
  throw "Backend did not become ready. See $BackendErrLog"
}
if (-not $frontendReady) {
  throw "Frontend did not become ready. See $FrontendErrLog"
}

Write-Host ""
Write-Host "Started successfully."
Write-Host "Frontend: http://localhost:$FrontendPort"
Write-Host "Backend:  http://localhost:$BackendPort"
Write-Host "Health:   http://localhost:$BackendPort/health"
Write-Host ""
Write-Host "Default login:"
Write-Host "admin@example.com / Admin123456"
Write-Host ""
Write-Host "Logs:"
Write-Host $BackendOutLog
Write-Host $BackendErrLog
Write-Host $FrontendOutLog
Write-Host $FrontendErrLog
