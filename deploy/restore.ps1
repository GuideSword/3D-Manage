[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][string]$BackupDirectory,
  [Parameter(Mandatory)][string]$DeploymentDirectory,
  [Parameter(Mandatory)][string]$ProjectName,
  [Parameter(Mandatory)][string]$ConfirmedServerId,
  [string]$PreRestoreBackup,
  [switch]$AllowEmptyTarget
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required.' }
function Invoke-Native([scriptblock]$Command) { & $Command; if ($LASTEXITCODE -ne 0) { throw "Native command failed with exit code $LASTEXITCODE" } }

$backup = (Resolve-Path -LiteralPath $BackupDirectory).Path
$deployment = (Resolve-Path -LiteralPath $DeploymentDirectory).Path
$manifestPath = Join-Path $backup 'manifest.json'
$dumpPath = Join-Path $backup 'database.dump'
$archivePath = Join-Path $backup 'files.tar.gz'
foreach ($required in @($manifestPath, $dumpPath, $archivePath)) { if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing backup file: $required" } }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.status -ne 'complete') { throw 'Backup is not marked complete.' }
if ($manifest.serverId -ne $ConfirmedServerId) { throw 'Confirmed serverId does not match backup manifest.' }
if ($manifest.storeSchemaVersion -gt 2 -or $manifest.postgresMajor -ne 16) { throw 'Backup schema or PostgreSQL major is incompatible.' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $dumpPath).Hash.ToLowerInvariant() -ne $manifest.hashes.databaseDumpSha256) { throw 'Database dump hash mismatch.' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant() -ne $manifest.hashes.filesArchiveSha256) { throw 'Files archive hash mismatch.' }
$keyLine = Get-Content -LiteralPath (Join-Path $deployment '.env') | Where-Object { $_ -match '^AGENT_KEY_ENC_SECRET=' } | Select-Object -First 1
if (-not $keyLine) { throw 'Recovery bundle is missing AGENT_KEY_ENC_SECRET.' }
$keyValue = $keyLine.Substring('AGENT_KEY_ENC_SECRET='.Length)
$keyId = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($keyValue))).Substring(0,16).ToLowerInvariant()
if ($keyId -ne $manifest.encryptionKeyId) { throw 'Recovery encryption key does not match the backup.' }

$entries = & docker run --rm -v "${backup}:/backup:ro" alpine:3.22 tar -tzf /backup/files.tar.gz
if ($LASTEXITCODE -ne 0) { throw 'Archive listing failed.' }
foreach ($entry in $entries) {
  if ($entry.StartsWith('/') -or $entry -match '(^|/)\.\.(/|$)' -or $entry -notmatch '^(data|uploads)(/|$)') { throw "Unsafe archive entry: $entry" }
}
$verboseEntries = & docker run --rm -v "${backup}:/backup:ro" alpine:3.22 tar -tvzf /backup/files.tar.gz
if ($LASTEXITCODE -ne 0 -or ($verboseEntries | Where-Object { $_ -match '^[lh]' })) { throw 'Archive contains a link or cannot be inspected safely.' }

$lockPath = Join-Path $deployment '.manage3d-operation.lock'; $lock = $null
try {
  $lock = [IO.File]::Open($lockPath, 'CreateNew', 'Write', 'None')
  Push-Location $deployment
  $dbContainer = (& docker compose -p $ProjectName ps -q db).Trim()
  if (-not $dbContainer) { throw 'Database container is not running.' }
  $currentId = (& docker compose -p $ProjectName exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT data->''system''->>''serverId'' FROM app_store WHERE id=''default''" 2>/dev/null || true').Trim()
  if ($currentId -and -not $AllowEmptyTarget) {
    if (-not $PreRestoreBackup -or -not (Test-Path -LiteralPath $PreRestoreBackup)) { throw 'Populated targets require a verified pre-restore backup.' }
    if ($currentId -ne $ConfirmedServerId) { throw 'Target serverId does not match the confirmed backup serverId.' }
  } elseif (-not $currentId -and -not $AllowEmptyTarget) { throw 'Use -AllowEmptyTarget for empty-host recovery.' }

  Invoke-Native { docker cp $dumpPath "${dbContainer}:/tmp/manage3d-restore.dump" }
  Invoke-Native { docker compose -p $ProjectName exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists manage3d_restore_check && createdb -U "$POSTGRES_USER" manage3d_restore_check && pg_restore -U "$POSTGRES_USER" -d manage3d_restore_check /tmp/manage3d-restore.dump' }
  $checkId = (& docker compose -p $ProjectName exec -T db sh -c 'psql -U "$POSTGRES_USER" -d manage3d_restore_check -Atc "SELECT data->''system''->>''serverId'' FROM app_store WHERE id=''default''"').Trim()
  if ($checkId -ne $ConfirmedServerId) { throw 'Isolated restore serverId verification failed.' }
  $checkCounts = (& docker compose -p $ProjectName exec -T db sh -c 'psql -U "$POSTGRES_USER" -d manage3d_restore_check -Atc "SELECT jsonb_build_object(''users'',jsonb_array_length(data->''users''),''orders'',jsonb_array_length(data->''orders''),''models'',jsonb_array_length(data->''models''),''materials'',jsonb_array_length(data->''materials''),''stockLots'',jsonb_array_length(data->''stockLots''),''inventoryTxns'',jsonb_array_length(data->''inventoryTxns''),''auditLogs'',jsonb_array_length(data->''auditLogs'')) FROM app_store WHERE id=''default''"').Trim() | ConvertFrom-Json
  foreach ($property in $manifest.collectionCounts.PSObject.Properties) {
    if ($checkCounts.($property.Name) -ne $property.Value) { throw "Isolated restore count mismatch: $($property.Name)" }
  }

  Invoke-Native { docker compose -p $ProjectName stop -t 30 app }
  $stage = Join-Path $deployment "runtime.restore-stage.$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  New-Item -ItemType Directory -Path $stage | Out-Null
  Invoke-Native { docker run --rm -v "${backup}:/backup:ro" -v "${stage}:/stage" alpine:3.22 tar -xzf /backup/files.tar.gz -C /stage --no-same-owner }
  Invoke-Native { docker compose -p $ProjectName run --rm --no-deps -v "${stage}/data:/app/data" app node scripts/verify-agent-db.js }
  Invoke-Native { docker compose -p $ProjectName exec -T db sh -c 'pg_restore -l /tmp/manage3d-restore.dump >/dev/null' }
  $prior = Join-Path $deployment "runtime.pre-restore.$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  New-Item -ItemType Directory -Path $prior | Out-Null
  foreach ($name in @('data', 'uploads')) {
    $currentPath = Join-Path (Join-Path $deployment 'runtime') $name
    if (Test-Path -LiteralPath $currentPath) { Move-Item -LiteralPath $currentPath -Destination (Join-Path $prior $name) }
    Move-Item -LiteralPath (Join-Path $stage $name) -Destination $currentPath
  }
  Remove-Item -LiteralPath $stage -Force
  Invoke-Native { docker compose -p $ProjectName exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" /tmp/manage3d-restore.dump' }
  Invoke-Native { docker compose -p $ProjectName up -d app }
  Write-Output "Restore started successfully. Prior runtime retained at $prior. All users must sign in again; rotate JWT_SECRET for complete token invalidation."
} finally {
  Pop-Location -ErrorAction SilentlyContinue
  if ($lock) { $lock.Dispose() }
  if (Test-Path -LiteralPath $lockPath) { Remove-Item -LiteralPath $lockPath -Force }
}
