param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$directory = Join-Path $workspace '.tmp/model-downloads'
$configFile = Join-Path $directory 'private-config.json'
$readyFile = Join-Path $directory 'ready.json'
if ($Stop) {
    if (-not (Test-Path -LiteralPath $configFile)) { throw 'No owned QA configuration found' }
    $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    $database = [Uri]$config.connectionString
    if ($database.Host -ne '127.0.0.1' -or $database.AbsolutePath -ne '/erp_model_downloads' -or $config.containerName -cne ('manage3d-model-downloads-' + $config.runId)) { throw 'QA configuration ownership mismatch' }
    if (Test-Path -LiteralPath $readyFile) {
        $ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
        if ($ready.runId -cne $config.runId) { throw 'QA process run ownership mismatch' }
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($ready.pid)"
        if ($processInfo) {
            if ($processInfo.Name -ne 'node.exe' -or $processInfo.CommandLine -notmatch 'tests[/\\]ops[/\\]model-downloads-ui-server.cjs') { throw 'QA process command ownership mismatch' }
            Stop-Process -Id $ready.pid
        }
    }
    $inspection = docker inspect $config.containerId | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $inspection.Config.Labels.'com.manage3d.model-downloads-qa' -cne $config.runId -or $inspection.Name -cne ('/' + $config.containerName)) { throw 'QA container ownership mismatch' }
    docker rm -f $config.containerId | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Owned QA container cleanup failed' }
    Remove-Item -LiteralPath $configFile
    if (Test-Path -LiteralPath $readyFile) { Remove-Item -LiteralPath $readyFile }
    Write-Output 'Owned QA server/database stopped; evidence and source archives retained.'
    return
}
if (Test-Path -LiteralPath $configFile) { throw 'An existing fixture configuration exists; inspect or stop it first' }
if (-not (Test-Path -LiteralPath (Join-Path $directory 'web/index.html'))) { throw 'Export Web to .tmp/model-downloads/web before starting this fixture' }
$run = [guid]::NewGuid().ToString('N'); $password = [guid]::NewGuid().ToString('N'); $jwt = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$name = 'manage3d-model-downloads-' + $run
$id = docker run -d --name $name --label "com.manage3d.model-downloads-qa=$run" -e "POSTGRES_PASSWORD=$password" -e POSTGRES_DB=erp_model_downloads -p 127.0.0.1::5432 postgres:16-alpine
if ($LASTEXITCODE -ne 0) { throw 'Unable to create QA database' }
$port = (docker port $id 5432/tcp).Trim().Split(':')[-1]
if ($LASTEXITCODE -ne 0 -or $port -notmatch '^\d+$') { throw 'Unable to inspect QA port' }
@{ runId = $run; containerName = $name; containerId = $id.Trim(); connectionString = "postgresql://postgres:${password}@127.0.0.1:${port}/erp_model_downloads"; password = $password; jwtSecret = $jwt } | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding utf8NoBOM
$databaseReady = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) { docker exec $id pg_isready -U postgres -d erp_model_downloads *> $null; if ($LASTEXITCODE -eq 0) { $databaseReady = $true; break }; Start-Sleep -Milliseconds 500 }
if (-not $databaseReady) { throw 'QA database startup failed; run with -Stop after inspection' }
$openssl = 'C:/Program Files/Git/usr/bin/openssl.exe'
& $openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=ERP Download QA Only' -addext 'subjectAltName=IP:127.0.0.1,DNS:localhost' -keyout (Join-Path $directory 'qa-key.pem') -out (Join-Path $directory 'qa-cert.pem') *> (Join-Path $directory 'certificate-generation.log')
if ($LASTEXITCODE -ne 0) { throw 'QA certificate creation failed; no system trust was installed' }
$node = (Get-Command node).Source
$script = Join-Path $workspace 'tests/ops/model-downloads-ui-server.cjs'
Start-Process -FilePath $node -ArgumentList ('"' + $script + '"') -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput (Join-Path $directory 'ui-server.log') -RedirectStandardError (Join-Path $directory 'ui-server-error.log') | Out-Null
$serverReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) { if (Test-Path -LiteralPath $readyFile) { $serverReady = $true; break }; Start-Sleep -Milliseconds 500 }
if (-not $serverReady) { throw 'QA server did not become ready; inspect sanitized fixture logs' }
(Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json).origin | Write-Output
