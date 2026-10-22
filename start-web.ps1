param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 8081,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$previousBrowser = $env:BROWSER
$previousTelemetry = $env:EXPO_NO_TELEMETRY

try {
  Set-Location -LiteralPath $PSScriptRoot
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js is missing. Install Node.js 20 or newer, then run this launcher again.'
  }
  $nodeVersion = & node.exe --version
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') { throw 'Cannot read the Node.js version.' }
  $nodeMajor = [int]$Matches[1]
  if ($nodeMajor -lt 20) { throw 'Node.js 20 or newer is required.' }

  $expo = Join-Path $PSScriptRoot 'node_modules\expo\bin\cli'
  if (-not (Test-Path -LiteralPath $expo -PathType Leaf)) {
    throw 'Dependencies are missing. Run npm ci in the project folder first, then try again.'
  }
  $portError = "Port $Port is busy. Close the previous Web terminal, or run: .\start-web.ps1 -Port 8082"
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw $portError
  }
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  try { $listener.Start() }
  catch { throw $portError }
  finally { $listener.Stop() }

  if ($NoBrowser) {
    $env:BROWSER = 'none'
  } else {
    # Prefer Edge without changing the Windows default browser.
    $edgePaths = @(
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
      "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    )
    $edge = $edgePaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ($edge) { $env:BROWSER = $edge } else { Remove-Item Env:BROWSER -ErrorAction SilentlyContinue }
  }
  $env:EXPO_NO_TELEMETRY = '1'
  Write-Host "Web: http://localhost:$Port"
  Write-Host 'Keep this terminal open. Press Ctrl+C to stop Web.'
  Write-Host 'Use your existing server address and account inside the application.'
  Write-Host 'This launcher starts the frontend only; it does not start or initialize a backend.'
  & node.exe $expo start --web --localhost --port $Port
  $webExitCode = $LASTEXITCODE
  if ($webExitCode -ne 0) { throw "Expo exited with code $webExitCode." }
} catch {
  Write-Host "Web startup failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  $env:BROWSER = $previousBrowser
  $env:EXPO_NO_TELEMETRY = $previousTelemetry
}
