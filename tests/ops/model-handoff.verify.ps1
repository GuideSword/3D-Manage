$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot '../../tools/model-handoff/Handoff.Core.psm1') -Force
$root = Join-Path ([IO.Path]::GetTempPath()) ('erp-handoff-verify-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($root) | Out-Null
try {
    $fakeStudio = Join-Path $root 'bambu-studio.exe'
    [IO.File]::WriteAllText($fakeStudio, 'inert test fixture; never execute')
    $server = 'https://erp.example.test/api'
    $ticket = 'a' * 43
    $uri = 'manage3d-model://open?server=' + [Uri]::EscapeDataString($server) + '&ticket=' + $ticket
    $config = @{ serverUrl = $server; serverId = '02d3a500-0000-4000-8000-000000000004'; studioPath = $fakeStudio }
    $readServer = { param($url) if ($url -cne ($server + '/system/info')) { throw 'Wrong identity endpoint' }; return @{ serverId = $config.serverId } }
    $parsed = ConvertFrom-ModelHandoffUri -Value $uri -AllowedServer $server
    if ($parsed.Server -cne $server) { throw 'Server parse failed' }
    $rejected = 0
    foreach ($bad in @($uri.Replace('https%3A', 'http%3A'), $uri.Replace('erp.example.test', 'evil.example.test'), ($uri + '&ticket=' + $ticket), ($uri + '&command=run'), $uri.Replace($ticket, 'invalid'), $uri.Replace('manage3d-model:', 'file:'))) {
        try { ConvertFrom-ModelHandoffUri -Value $bad -AllowedServer $server | Out-Null } catch { $rejected++ }
    }
    if ($rejected -ne 6) { throw 'Unsafe URI accepted' }
    $bytes = [Text.Encoding]::UTF8.GetBytes("solid verified`nendsolid verified")
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
    $file = @{ name = 'fixture.stl'; size = $bytes.Length; sha256 = $hash }
    $post = { param($url, $body) if ($url -cne ($server + '/model-downloads/handoff/redeem') -or $body.ticket -cne $ticket) { throw 'Wrong exchange' }; return @{ token = 'b' * 43; file = $file } }
    $download = { param($url, $token, $path, $size) if ($url -cne ($server + '/model-downloads/handoff/file') -or $token -cne ('b' * 43) -or $size -ne $bytes.Length) { throw 'Wrong download' }; [IO.File]::WriteAllBytes($path, $bytes) }
    $script:launches = 0
    $launch = { param($exe, $model) if ($exe -cne $fakeStudio -or -not (Test-Path -LiteralPath $model)) { throw 'Wrong launch arguments' }; $script:launches++ }
    $result = Invoke-ModelHandoff -Uri $uri -Config $config -TemporaryRoot (Join-Path $root 'temporary') -ReadServer $readServer -Post $post -Download $download -ChooseDestination { return $true } -Launch $launch
    if ($result.Status -ne 'launched' -or $script:launches -ne 1) { throw 'Valid handoff failed' }
    $identityRejected = $false
    $script:identityPosts = 0
    try { Invoke-ModelHandoff -Uri $uri -Config $config -TemporaryRoot (Join-Path $root 'temporary') -ReadServer { return @{ serverId = 'different-server' } } -Post { $script:identityPosts++; throw 'Identity mismatch must not redeem' } -Download $download -ChooseDestination { return $true } -Launch $launch | Out-Null } catch { $identityRejected = $true }
    if (-not $identityRejected -or $script:launches -ne 1 -or $script:identityPosts -ne 0) { throw 'Changed server identity was accepted' }
    $cancelled = Invoke-ModelHandoff -Uri $uri -Config $config -TemporaryRoot (Join-Path $root 'temporary') -ReadServer $readServer -Post $post -Download { throw 'Cancel must not download' } -ChooseDestination { return $null } -Launch $launch
    if ($cancelled.Status -ne 'cancelled' -or $script:launches -ne 1) { throw 'Cancel launched a program' }
    $badHashRejected = $false
    try { Invoke-ModelHandoff -Uri $uri -Config $config -TemporaryRoot (Join-Path $root 'temporary') -ReadServer $readServer -Post $post -Download { param($url, $token, $path) [IO.File]::WriteAllBytes($path, (New-Object byte[] $bytes.Length)) } -ChooseDestination { return $true } -Launch $launch | Out-Null } catch { $badHashRejected = $true }
    if (-not $badHashRejected -or $script:launches -ne 1) { throw 'Corrupt model launched a program' }
    $existing = Join-Path $root 'existing.stl'; [IO.File]::WriteAllText($existing, 'user-owned')
    $overwriteRejected = $false
    try { Invoke-ModelHandoff -Uri $uri -Config $config -TemporaryRoot (Join-Path $root 'temporary') -ReadServer $readServer -Post $post -Download $download -ChooseDestination { return $existing } -Launch $launch | Out-Null } catch { $overwriteRejected = $true }
    if (-not $overwriteRejected -or [IO.File]::ReadAllText($existing) -cne 'user-owned' -or $script:launches -ne 1) { throw 'Existing file overwritten' }
    foreach ($name in @('Install.ps1','Dispatch-ModelHandoff.ps1','Import-Models.ps1','Open-Model.ps1','Handoff.Core.psm1','Import.Core.psm1','Import.Ui.psm1')) {
        $parseErrors = $null; $parseTokens = $null
        [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot ('../../tools/model-handoff/' + $name)), [ref]$parseTokens, [ref]$parseErrors) | Out-Null
        if ($parseErrors.Count) { throw "Helper parse failed: $name" }
    }
    Write-Output 'PASS: URI rejection, bound server, validated bytes, explicit cancellation, corrupt data, overwrite protection, script parsing. No Studio process or protocol registration was invoked.'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($resolved) -cne [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($resolved) -notlike 'erp-handoff-verify-*') { throw 'Cleanup ownership failed' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
