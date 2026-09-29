[CmdletBinding()]
param([Parameter(Mandatory)][string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$deployment = Join-Path $workspace '.tmp/erp-release-acceptance'
$backup = (Resolve-Path -LiteralPath $BackupDirectory).Path
$context = Get-Content -Raw -LiteralPath (Join-Path $deployment 'fixture-context.json') | ConvertFrom-Json
if ($context.base -ne 'http://127.0.0.1:5812/api') { throw 'Refusing to test an unrelated deployment' }
$lockPath = Join-Path $deployment '.manage3d-operation.lock'
function Expect-Rejection([scriptblock]$Action, [string]$Expected) {
  $rejected = $false
  try { & $Action | Out-Null } catch {
    if ($_.Exception.Message -notmatch $Expected) { throw }
    $rejected = $true
  }
  if (-not $rejected) { throw "Guard failed: $Expected" }
}
Push-Location $workspace
try {
  & ./deploy/restore.ps1 -BackupDirectory $backup -DeploymentDirectory $deployment -ProjectName erp-release-acceptance -ConfirmedServerId $context.serverId -WhatIf
  if (Test-Path -LiteralPath $lockPath) { throw 'WhatIf acquired an operation lock' }
  # An empty-target flag must not authorize overwriting an existing organization.
  Expect-Rejection { & ./deploy/restore.ps1 -BackupDirectory $backup -DeploymentDirectory $deployment -ProjectName erp-release-acceptance -ConfirmedServerId $context.serverId -AllowEmptyTarget } 'Populated targets'
  $marker = [IO.File]::Open($lockPath, 'CreateNew', 'Write', 'Read')
  $marker.Dispose()
  try {
    Expect-Rejection { & ./deploy/backup.ps1 -DeploymentDirectory $deployment -ProjectName erp-release-acceptance -OutputDirectory .tmp/erp-guards-backups } 'already exists|being used|exists'
    if (-not (Test-Path -LiteralPath $lockPath)) { throw 'Backup removed another operation lock' }
    Expect-Rejection { & ./deploy/restore.ps1 -BackupDirectory $backup -DeploymentDirectory $deployment -ProjectName erp-release-acceptance -ConfirmedServerId $context.serverId } 'already exists|being used|exists'
    if (-not (Test-Path -LiteralPath $lockPath)) { throw 'Restore removed another operation lock' }
  } finally { Remove-Item -LiteralPath $lockPath -Force }
  node tests/ops/release-recovery.verify.cjs verify
  if ($LASTEXITCODE -ne 0) { throw 'Guard test changed target data' }
  Write-Output 'Populated-target and foreign-lock guards passed; restored data unchanged.'
} finally { Pop-Location }
