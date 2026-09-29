$ErrorActionPreference = 'Stop'
$erpWorkspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$erpTestName = '3d-erp-p0-test-' + [guid]::NewGuid().ToString('N').Substring(0, 10)
$erpTestContainer = docker run --rm -d --name $erpTestName --env POSTGRES_PASSWORD=erp-isolated-test --env POSTGRES_DB=erp_p0 --publish '127.0.0.1::5432' --tmpfs /var/lib/postgresql/data postgres:16-bookworm
if ($LASTEXITCODE -ne 0 -or $erpTestContainer -notmatch '^[a-f0-9]{64}$') {
  throw 'Failed to create isolated PostgreSQL test container'
}
$erpPreviousTestUrl = $env:ERP_TEST_DATABASE_URL
$erpTestExit = 1
Push-Location $erpWorkspace
try {
  $erpTestReady = $false
  for ($erpAttempt = 0; $erpAttempt -lt 30; $erpAttempt++) {
    docker exec $erpTestContainer pg_isready -U postgres -d erp_p0 | Out-Null
    if ($LASTEXITCODE -eq 0) { $erpTestReady = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $erpTestReady) { throw 'Isolated PostgreSQL test container failed readiness' }
  $erpTestPort = (docker port $erpTestContainer 5432/tcp).Split(':')[-1]
  $env:ERP_TEST_DATABASE_URL = 'postgres://postgres:erp-isolated-test@127.0.0.1:' + $erpTestPort + '/erp_p0'
  node --test tests/backend/erp-inventory.test.cjs
  $erpTestExit = $LASTEXITCODE
} finally {
  if ($null -eq $erpPreviousTestUrl) {
    Remove-Item Env:ERP_TEST_DATABASE_URL -ErrorAction SilentlyContinue
  } else {
    $env:ERP_TEST_DATABASE_URL = $erpPreviousTestUrl
  }
  # Stop only the container created above; --rm removes it and its tmpfs data.
  docker stop $erpTestContainer | Out-Null
  Pop-Location
}
exit $erpTestExit
