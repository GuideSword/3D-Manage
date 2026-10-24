Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertFrom-ModelHandoffUri {
    param([Parameter(Mandatory)][string]$Value, [Parameter(Mandatory)][string]$AllowedServer)
    $uri = [Uri]$Value
    if ($Value.Length -gt 4096 -or $uri.Scheme -ne 'manage3d-model' -or $uri.Host -ne 'open' -or $uri.UserInfo -or $uri.Fragment -or ($uri.AbsolutePath -and $uri.AbsolutePath -ne '/')) { throw '模型交接地址无效' }
    $parts = @{}
    foreach ($entry in $uri.Query.TrimStart('?').Split('&')) {
        $pair = $entry.Split('=', 2)
        if ($pair.Length -ne 2) { throw '模型交接参数无效' }
        $key = [System.Net.WebUtility]::UrlDecode($pair[0])
        if ($key -notin @('server', 'ticket') -or $parts.ContainsKey($key)) { throw '模型交接参数重复或不受支持' }
        $parts[$key] = [System.Net.WebUtility]::UrlDecode($pair[1])
    }
    if ($parts.Count -ne 2 -or $parts.ticket -notmatch '^[A-Za-z0-9_-]{43}$') { throw '模型交接凭据无效' }
    $server = [Uri]$parts.server
    $allowed = [Uri]$AllowedServer
    foreach ($address in @($server, $allowed)) {
        if (-not $address.IsAbsoluteUri -or $address.Scheme -ne 'https' -or $address.UserInfo -or $address.Query -or $address.Fragment -or $address.AbsolutePath.TrimEnd('/') -notmatch '/api$') { throw '助手只允许已绑定的HTTPS ERP接口地址' }
    }
    if ($server.AbsoluteUri.TrimEnd('/') -cne $allowed.AbsoluteUri.TrimEnd('/')) { throw '服务器与已绑定ERP不一致，拒绝交接' }
    return @{ Server = $allowed.AbsoluteUri.TrimEnd('/'); Ticket = $parts.ticket }
}

function Assert-ModelDownloadMetadata {
    param([Parameter(Mandatory)]$File)
    $extension = [IO.Path]::GetExtension([string]$File.name).ToLowerInvariant()
    if ($extension -notin @('.stl', '.obj', '.3mf', '.step', '.stp')) { throw '此模型格式不能直接交给Studio，请使用普通下载后手动处理' }
    if ([string]$File.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $File.size -isnot [ValueType] -or [double]$File.size -ne [math]::Truncate([double]$File.size) -or [double]$File.size -le 0 -or [double]$File.size -gt 524288000) { throw '模型校验信息或大小无效' }
    return $extension
}

function Invoke-ModelHandoff {
    param([string]$Uri, $Config, [string]$TemporaryRoot,
        [scriptblock]$ReadServer, [scriptblock]$Post, [scriptblock]$Download, [scriptblock]$ChooseDestination, [scriptblock]$Launch)
    $request = ConvertFrom-ModelHandoffUri -Value $Uri -AllowedServer $Config.serverUrl
    if (-not [IO.Path]::IsPathRooted($Config.studioPath) -or [IO.Path]::GetFileName($Config.studioPath) -ine 'bambu-studio.exe' -or -not (Test-Path -LiteralPath $Config.studioPath -PathType Leaf)) { throw '请先配置有效的Bambu Studio程序路径' }
    $identity = & $ReadServer ($request.Server + '/system/info')
    if (-not $Config.serverId -or [string]$identity.serverId -cne [string]$Config.serverId) { throw 'ERP服务器身份已变化，拒绝交接，请重新核对绑定' }
    $exchange = & $Post ($request.Server + '/model-downloads/handoff/redeem') @{ ticket = $request.Ticket }
    $extension = Assert-ModelDownloadMetadata $exchange.file
    if ([string]$exchange.token -cnotmatch '^[A-Za-z0-9_-]{43}$') { throw '服务器返回的传输授权无效' }
    $choice = & $ChooseDestination $exchange.file
    if (-not $choice) { return @{ Status = 'cancelled' } }
    $directory = Join-Path ([IO.Path]::GetFullPath($TemporaryRoot)) ([guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $localFile = Join-Path $directory ('model' + $extension)
    try {
        & $Download ($request.Server + '/model-downloads/handoff/file') $exchange.token $localFile ([long]$exchange.file.size)
        $item = Get-Item -LiteralPath $localFile
        if ($item.Length -ne [long]$exchange.file.size -or (Get-FileHash -LiteralPath $localFile -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$exchange.file.sha256) { throw '模型大小或SHA256校验失败，未打开Studio' }
        if ($choice -is [string]) {
            $savedPath = [IO.Path]::GetFullPath($choice)
            if ([IO.Path]::GetExtension($savedPath).ToLowerInvariant() -cne $extension) { throw '保存文件扩展名必须与模型一致' }
            # FileMode.CreateNew: never overwrite an existing user file, including after a save-dialog race.
            $output = [IO.File]::Open($savedPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
            try { $source = [IO.File]::OpenRead($localFile); try { $source.CopyTo($output) } finally { $source.Dispose() } } finally { $output.Dispose() }
        }
        & $Launch $Config.studioPath $localFile
        return @{ Status = 'launched'; TemporaryDirectory = $directory }
    } catch {
        # Only this attempt's generated private file may be removed; never recurse into a user-selected path.
        if (Test-Path -LiteralPath $localFile -PathType Leaf) { Remove-Item -LiteralPath $localFile -Force }
        throw
    }
}
Export-ModuleMember -Function ConvertFrom-ModelHandoffUri, Assert-ModelDownloadMetadata, Invoke-ModelHandoff
