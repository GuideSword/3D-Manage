[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$DeploymentDirectory,
  [Parameter(Mandatory)][string]$ProjectName,
  [Parameter(Mandatory)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required.' }

function Invoke-Native([scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "Native command failed with exit code $LASTEXITCODE" }
}

$deployment = (Resolve-Path -LiteralPath $DeploymentDirectory).Path
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$outputRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$backupPath = Join-Path $outputRoot $stamp
$resolvedBackup = [IO.Path]::GetFullPath($backupPath)
if (-not $resolvedBackup.StartsWith(([IO.Path]::GetFullPath($outputRoot) + [IO.Path]::DirectorySeparatorChar))) {
  throw 'Backup path escaped the requested output directory.'
}
New-Item -ItemType Directory -Path $resolvedBackup | Out-Null
$lockPath = Join-Path $deployment '.manage3d-operation.lock'
$lock = $null
$appWasRunning = $false
$complete = $false
try {
  $lock = [IO.File]::Open($lockPath, 'CreateNew', 'Write', 'None')
  $writer = [IO.StreamWriter]::new($lock)
  $writer.WriteLine("backup $stamp")
  $writer.Flush()

  Push-Location $deployment
  $appContainer = (& docker compose -p $ProjectName ps -q app).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Compose app service.' }
  $appWasRunning = [bool]$appContainer
  if ($appWasRunning) { Invoke-Native { docker compose -p $ProjectName stop -t 30 app } }

  Invoke-Native { docker compose -p $ProjectName run --rm --no-deps app node scripts/checkpoint-agent-db.js }
  $dbContainer = (& docker compose -p $ProjectName ps -q db).Trim()
  if (-not $dbContainer) { throw 'Database container is not running.' }
  Invoke-Native { docker compose -p $ProjectName exec -T db sh -c 'rm -f /tmp/manage3d-backup.dump && pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/manage3d-backup.dump' }
  Invoke-Native { docker cp "${dbContainer}:/tmp/manage3d-backup.dump" (Join-Path $resolvedBackup 'database.dump') }
  Invoke-Native { docker compose -p $ProjectName exec -T db pg_restore -l /tmp/manage3d-backup.dump }

  $runtime = Join-Path $deployment 'runtime'
  Invoke-Native { docker run --rm -v "${runtime}:/source:ro" -v "${resolvedBackup}:/backup" alpine:3.22 tar -czf /backup/files.tar.gz -C /source data uploads }
  Invoke-Native { docker run --rm -v "${resolvedBackup}:/backup:ro" alpine:3.22 tar -tzf /backup/files.tar.gz }

  $serverId = (& docker compose -p $ProjectName exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT data->''system''->>''serverId'' FROM app_store WHERE id=''default''"').Trim()
  if ($LASTEXITCODE -ne 0 -or -not $serverId) { throw 'Unable to read backup serverId.' }
  $dbHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $resolvedBackup 'database.dump')).Hash.ToLowerInvariant()
  $filesHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $resolvedBackup 'files.tar.gz')).Hash.ToLowerInvariant()
  $keyLine = Get-Content -LiteralPath (Join-Path $deployment '.env') | Where-Object { $_ -match '^AGENT_KEY_ENC_SECRET=' } | Select-Object -First 1
  if (-not $keyLine) { throw 'AGENT_KEY_ENC_SECRET is missing from the recovery bundle.' }
  $keyValue = $keyLine.Substring('AGENT_KEY_ENC_SECRET='.Length)
  $keyId = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($keyValue))).Substring(0,16).ToLowerInvariant()
  $manifest = [ordered]@{
    status = 'complete'; serverId = $serverId; apiVersion = '1'; storeSchemaVersion = 2
    utcTimestamp = (Get-Date).ToUniversalTime().ToString('o'); composeProject = $ProjectName
    postgresMajor = 16; storageMode = 'postgres+sqlite+filesystem'; encryptionKeyId = $keyId
    hashes = @{ databaseDumpSha256 = $dbHash; filesArchiveSha256 = $filesHash }
  }
  $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $resolvedBackup 'manifest.json') -Encoding utf8NoBOM
  $complete = $true
  Write-Output $resolvedBackup
} catch {
  @{ status = 'incomplete'; error = $_.Exception.Message; utcTimestamp = (Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resolvedBackup 'manifest.incomplete.json') -Encoding utf8NoBOM
  throw
} finally {
  try { if ($appWasRunning) { Invoke-Native { docker compose -p $ProjectName up -d app } } } finally {
    Pop-Location -ErrorAction SilentlyContinue
    if ($lock) { $lock.Dispose() }
    if (Test-Path -LiteralPath $lockPath) { Remove-Item -LiteralPath $lockPath -Force }
  }
}
