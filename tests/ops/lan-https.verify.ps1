param([Parameter(Mandatory = $true)][string]$MkcertPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$setup = Join-Path $root 'deploy/setup-lan-https.ps1'
$trust = Join-Path $root 'deploy/trust-lan-certificate.ps1'
$windowsPowerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('manage3d-tls-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$priorModulePath = $env:PSModulePath
try {
  $env:PSModulePath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules'
  $envPath = Join-Path $fixture '.env'
  [IO.File]::WriteAllText($envPath, "APP_PORT=15800`nTEST_SENTINEL=unchanged`n")
  $before = [IO.File]::ReadAllText($envPath)
  & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $setup -DeploymentDirectory $fixture -ServerNames '192.168.0.33' -MkcertPath $MkcertPath
  if ($LASTEXITCODE -ne 0) { throw 'Preparation failed in Windows PowerShell 5.1' }
  if ([IO.File]::ReadAllText($envPath) -ne $before) { throw 'Prepare changed deployment configuration' }
  $manifestPath = Join-Path $fixture 'runtime/tls/installation.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $clientDirectory = Join-Path $fixture 'runtime/tls/clients'
  $allowed = @('3d-manage-rootCA.cer', 'ROOT-CA-SHA256.txt', 'Install-Trust.bat', 'trust-lan-certificate.ps1')
  $files = @(Get-ChildItem -LiteralPath $clientDirectory -File | Select-Object -ExpandProperty Name)
  if ($files.Count -ne $allowed.Count -or @($files | Where-Object { $_ -notin $allowed }).Count) { throw 'Client distribution contains unexpected files' }
  & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $setup -DeploymentDirectory $fixture -ServerNames '192.168.0.33,192.168.1.10' -MkcertPath $MkcertPath
  if ($LASTEXITCODE -ne 0) { throw 'Repeat preparation failed' }
  $next = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.rootCaSha256 -ne $next.rootCaSha256) { throw 'Repeat preparation replaced the CA' }
  & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $trust -CertificatePath (Join-Path $clientDirectory '3d-manage-rootCA.cer') -ExpectedSha256 ('0' * 64) *> $null
  if ($LASTEXITCODE -eq 0) { throw 'Wrong certificate fingerprint was accepted' }
  & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $setup -DeploymentDirectory $fixture -ServerNames 'https://192.168.0.33:5800/api' -MkcertPath $MkcertPath *> $null
  if ($LASTEXITCODE -eq 0) { throw 'An API URL was accepted as a certificate hostname' }
  if ([IO.File]::ReadAllText($envPath) -ne $before) { throw 'Validation failures changed deployment configuration' }
  Write-Output 'PASS Windows PowerShell 5.1: prepare, preserved CA, public client files, fingerprint rejection, hostname validation; no system trust or container changes.'
} finally {
  $env:PSModulePath = $priorModulePath
  $resolved = [IO.Path]::GetFullPath($fixture)
  $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($resolved) -ne $expectedParent -or [IO.Path]::GetFileName($resolved) -notlike 'manage3d-tls-*') { throw 'Fixture cleanup escaped owned temp directory' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
