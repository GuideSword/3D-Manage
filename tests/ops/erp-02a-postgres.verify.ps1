param(
  [ValidateSet('foundation', 'preflight', 'core', 'import', 'commands', 'catalog', 'orders', 'inventory')][string]$Suite = 'foundation',
  [string]$RehearsalSource,
  [string]$RehearsalDecisions,
  [string]$UploadDirectory
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required.' }
if ($RehearsalSource -or $RehearsalDecisions -or $UploadDirectory) {
  if ($Suite -ne 'import' -or -not $RehearsalSource -or -not $RehearsalDecisions -or -not $UploadDirectory) {
    throw 'Rehearsal requires import suite and explicit source, decisions and upload directory.'
  }
  $RehearsalSource = (Resolve-Path -LiteralPath $RehearsalSource).Path
  $RehearsalDecisions = (Resolve-Path -LiteralPath $RehearsalDecisions).Path
  $UploadDirectory = (Resolve-Path -LiteralPath $UploadDirectory).Path
}
$erpWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$erpContainerName = 'manage3d-erp-02a-verify'
$erpCreatedId = $null
$erpPreviousUrl = $env:ERP_BUSINESS_TEST_DATABASE_URL
$erpPreviousPassword = $env:POSTGRES_PASSWORD
$erpPreviousRehearsalUrl = $env:ERP_IMPORT_REHEARSAL_DATABASE_URL
$erpRunId = [guid]::NewGuid().ToString('N')
$erpExit = 1
Push-Location $erpWorkspace
try {
  $erpExisting = docker ps -aq --filter "name=^/${erpContainerName}$"
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect test containers.' }
  if ($erpExisting) { throw 'The ERP 02A test container already exists; no existing container was changed.' }
  $env:POSTGRES_PASSWORD = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  $erpCreatedId = docker run -d --name $erpContainerName --label "com.manage3d.erp-02a-run=$erpRunId" --env POSTGRES_PASSWORD --env POSTGRES_DB=erp_02a_verify --publish '127.0.0.1::5432' --tmpfs /var/lib/postgresql/data postgres:16-bookworm
  if ($LASTEXITCODE -ne 0 -or $erpCreatedId -notmatch '^[a-f0-9]{64}$') {
    $erpCreatedId = $null
    throw 'Unable to create isolated PostgreSQL 16.'
  }
  $erpReady = $false
  for ($erpAttempt = 0; $erpAttempt -lt 60; $erpAttempt++) {
    docker exec $erpCreatedId pg_isready -h 127.0.0.1 -U postgres -d erp_02a_verify | Out-Null
    if ($LASTEXITCODE -eq 0) { $erpReady = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $erpReady) { throw 'Isolated PostgreSQL did not become ready.' }
  $erpPort = (docker port $erpCreatedId 5432/tcp).Trim().Split(':')[-1]
  if ($LASTEXITCODE -ne 0 -or $erpPort -notmatch '^\d+$') { throw 'Unable to read isolated database port.' }
  $env:ERP_BUSINESS_TEST_DATABASE_URL = "postgresql://postgres:$($env:POSTGRES_PASSWORD)@127.0.0.1:${erpPort}/erp_02a_verify"
  $erpTests = @(if ($Suite -eq 'preflight') {
    @('tests/backend/erp-preflight.test.cjs', 'tests/backend/erp-preflight-postgres.test.cjs')
  } elseif ($Suite -eq 'core') { @('tests/backend/erp-core-schema.test.cjs')
  } elseif ($Suite -eq 'import') { @('tests/backend/erp-import.test.cjs')
  } elseif ($Suite -eq 'commands') { @('tests/backend/erp-commands.test.cjs')
  } elseif ($Suite -eq 'catalog') { @('tests/backend/erp-catalog.test.cjs')
  } elseif ($Suite -eq 'orders') { @('tests/backend/erp-relational-orders.test.cjs')
  } elseif ($Suite -eq 'inventory') { @('tests/backend/erp-relational-inventory.test.cjs')
  } else { @('tests/backend/erp-decimal.test.cjs', 'tests/backend/erp-postgres.test.cjs') })
  $erpOutput = & node --test @erpTests 2>&1
  $erpExit = $LASTEXITCODE
  $erpOutput | Write-Output
  $erpEvidenceDirectory = Join-Path $erpWorkspace '.tmp/erp-02a'
  New-Item -ItemType Directory -Force -Path $erpEvidenceDirectory | Out-Null
  $erpLog = $erpOutput -join "`n"
  $erpPassed = [regex]::Match($erpLog, '(?m)^# pass (\d+)').Groups[1].Value
  $erpSkipped = [regex]::Match($erpLog, '(?m)^# skipped (\d+)').Groups[1].Value
  if ($erpSkipped -ne '0' -and $erpExit -eq 0) { $erpExit = 1 }
  $erpEvidence = [ordered]@{
    suite = $Suite
    result = $(if ($erpExit -eq 0) { 'passed' } else { 'failed' })
    utcTimestamp = [DateTimeOffset]::UtcNow.ToString('o')
    testDatabase = 'erp_02a_verify'
    postgresMajor = 16
    containerRunId = $erpRunId
    passed = $erpPassed
    skipped = $erpSkipped
    migrationSha256 = (Get-FileHash backend/business-db/migrations/0001_foundation.sql -Algorithm SHA256).Hash.ToLowerInvariant()
    migrations = @(Get-ChildItem backend/business-db/migrations/*.sql | Sort-Object Name | ForEach-Object {
      @{ filename = $_.Name; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
  }
  $erpEvidenceName = if ($Suite -ne 'foundation') { "$Suite-verification" } else { 'verification' }
  $erpOutput | Set-Content (Join-Path $erpEvidenceDirectory "$erpEvidenceName.log") -Encoding utf8
  $erpEvidence | ConvertTo-Json | Set-Content (Join-Path $erpEvidenceDirectory "$erpEvidenceName.json") -Encoding utf8
  if ($erpExit -eq 0 -and $RehearsalSource) {
    docker exec $erpCreatedId createdb -U postgres erp_import_rehearsal
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create owned rehearsal database.' }
    $env:ERP_IMPORT_REHEARSAL_DATABASE_URL = "postgresql://postgres:$($env:POSTGRES_PASSWORD)@127.0.0.1:${erpPort}/erp_import_rehearsal"
    $erpRehearsals = @()
    foreach ($erpExpectedReused in @($false, $true)) {
      $erpRehearsalOutput = & node backend/scripts/erp-import-rehearsal.js --source-file $RehearsalSource --decisions-file $RehearsalDecisions --upload-dir $UploadDirectory --target-env ERP_IMPORT_REHEARSAL_DATABASE_URL
      if ($LASTEXITCODE -ne 0) { throw 'Isolated source rehearsal failed.' }
      $erpRehearsalResult = $erpRehearsalOutput | ConvertFrom-Json
      if ($erpRehearsalResult.reused -ne $erpExpectedReused -or $erpRehearsalResult.productionCutover -ne $false) {
        throw 'Isolated source rehearsal result was invalid.'
      }
      $erpRehearsals += $erpRehearsalResult
      $erpRehearsalOutput | Write-Output
    }
    $erpRehearsals | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $erpEvidenceDirectory 'source-import-rehearsal.json') -Encoding utf8
  }
} finally {
  try {
    if ($erpCreatedId) {
      $erpLabel = docker inspect --format '{{index .Config.Labels "com.manage3d.erp-02a-run"}}' $erpCreatedId
      if ($LASTEXITCODE -eq 0 -and $erpLabel -eq $erpRunId) {
        docker rm -f $erpCreatedId | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Unable to clean up the owned ERP test container.' }
      } else { throw 'Test container ownership check failed; cleanup was refused.' }
    }
  } finally {
    if ($null -eq $erpPreviousUrl) { Remove-Item Env:ERP_BUSINESS_TEST_DATABASE_URL -ErrorAction SilentlyContinue }
    else { $env:ERP_BUSINESS_TEST_DATABASE_URL = $erpPreviousUrl }
    if ($null -eq $erpPreviousPassword) { Remove-Item Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue }
    else { $env:POSTGRES_PASSWORD = $erpPreviousPassword }
    if ($null -eq $erpPreviousRehearsalUrl) { Remove-Item Env:ERP_IMPORT_REHEARSAL_DATABASE_URL -ErrorAction SilentlyContinue }
    else { $env:ERP_IMPORT_REHEARSAL_DATABASE_URL = $erpPreviousRehearsalUrl }
    Pop-Location
  }
}
exit $erpExit
