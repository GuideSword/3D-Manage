param([Parameter(Mandatory)][string]$Uri)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Net.Http
Import-Module (Join-Path $PSScriptRoot 'Handoff.Core.psm1') -Force
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromMinutes(5)
$diagnostic = @{ stage = 'configuration'; status = 0; code = 'HANDOFF_CONFIGURATION' }
try {
    if ($args.Count) { throw '不接受额外交接参数' }
    $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
    $readServer = {
        param($url)
        $diagnostic.stage = 'identity'
        $diagnostic.code = 'HANDOFF_IDENTITY'
        $response = $client.GetAsync($url).GetAwaiter().GetResult()
        try {
            $diagnostic.status = [int]$response.StatusCode
            if (-not $response.IsSuccessStatusCode) { throw '无法确认ERP服务器身份' }
            return ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json)
        } finally { $response.Dispose() }
    }
    $post = {
        param($url, $body)
        $diagnostic.stage = 'authorization'
        $diagnostic.code = 'HANDOFF_AUTHORIZATION'
        $content = [Net.Http.StringContent]::new(($body | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json')
        try {
            $response = $client.PostAsync($url, $content).GetAwaiter().GetResult()
            try {
                $diagnostic.status = [int]$response.StatusCode
                if (-not $response.IsSuccessStatusCode) {
                    try {
                        $failure = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                        if ($failure.code -in @('MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED', 'FILE_IDENTITY_UNAVAILABLE', 'DOWNLOAD_HTTPS_REQUIRED', 'AUTHENTICATION_REQUIRED')) { $diagnostic.code = [string]$failure.code }
                    } catch { }
                }
                if (-not $response.IsSuccessStatusCode) { throw '交接授权失效或服务器拒绝访问，请回到ERP重新验证' }
                return ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json)
            } finally { $response.Dispose() }
        } finally { $content.Dispose() }
    }
    $download = {
        param($url, $token, $destination, $expectedSize)
        $diagnostic.stage = 'download'
        $diagnostic.code = 'HANDOFF_DOWNLOAD'
        $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $url)
        $message.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
        try {
            $response = $client.SendAsync($message, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            try {
                $diagnostic.status = [int]$response.StatusCode
                if ([int]$response.StatusCode -ne 200) { throw '模型下载未完成，请回到ERP重新授权' }
                $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                $output = [IO.File]::Open($destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
                try {
                    $buffer = New-Object byte[] 65536
                    [long]$total = 0
                    while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                        $total += $read
                        if ($total -gt $expectedSize) { throw '服务器返回的数据超过模型声明大小' }
                        $output.Write($buffer, 0, $read)
                    }
                } finally { $output.Dispose(); $inputStream.Dispose() }
            } finally { $response.Dispose() }
        } finally { $message.Dispose() }
    }
    $choose = {
        param($file)
        $diagnostic.stage = 'consent'
        $diagnostic.code = 'HANDOFF_METADATA_OR_CONSENT'
        $answer = [Windows.Forms.MessageBox]::Show("即将从已绑定ERP拉取模型至当前电脑并打开Studio：`n$($file.name)`n临时副本和Studio缓存可能留存在本机。`n`n是否另外保存一份？`n是：选择保存位置；否：仅使用临时副本；取消：不下载。", '确认模型拉取', 'YesNoCancel', 'Question')
        if ($answer -eq 'Cancel') { return $null }
        if ($answer -eq 'No') { return $true }
        $dialog = [Windows.Forms.SaveFileDialog]::new()
        try {
            $dialog.FileName = [IO.Path]::GetFileName([string]$file.name)
            $dialog.Filter = '模型文件|*' + [IO.Path]::GetExtension([string]$file.name)
            $dialog.OverwritePrompt = $true
            if ($dialog.ShowDialog() -ne 'OK') { return $null }
            return $dialog.FileName
        } finally { $dialog.Dispose() }
    }
    $launch = {
        param($executable, $model)
        $diagnostic.stage = 'studio'
        $diagnostic.code = 'HANDOFF_STUDIO'
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $executable
        $start.UseShellExecute = $false
        $start.Arguments = '"' + $model + '"'
        $start.WorkingDirectory = [IO.Path]::GetDirectoryName($executable)
        [Diagnostics.Process]::Start($start) | Out-Null
    }
    $result = Invoke-ModelHandoff -Uri $Uri -Config $config -TemporaryRoot (Join-Path $env:LOCALAPPDATA '3DManageModelHandoff/temporary') -ReadServer $readServer -Post $post -Download $download -ChooseDestination $choose -Launch $launch
} catch {
    # Never show raw URI, ticket, transport token or HTTP response bodies.
    $message = switch ($diagnostic.code) {
        'MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED' { '交接授权已过期、已使用或失效。请回到 ERP 重新验证下载密码，并在一分钟内点击打开。'; break }
        'FILE_IDENTITY_UNAVAILABLE' { '服务器缺少这个模型的完整校验信息，请联系管理员补全文件资料。'; break }
        'AUTHENTICATION_REQUIRED' { '账号登录状态已失效，请在 ERP 重新登录并授权。'; break }
        'DOWNLOAD_HTTPS_REQUIRED' { '服务器拒绝了未加密的交接请求，请核对 HTTPS 配置。'; break }
        'HANDOFF_IDENTITY' { '无法核对服务器身份，请检查 HTTPS 连接和助手绑定的服务器。'; break }
        'HANDOFF_AUTHORIZATION' { '交接授权兑换失败，请回到 ERP 重新授权。'; break }
        'HANDOFF_DOWNLOAD' { '模型传输或完整性校验失败，未打开 Studio。请回到 ERP 重新授权。'; break }
        'HANDOFF_STUDIO' { '模型已校验，但无法启动所配置的 Bambu Studio，请核对程序路径和运行权限。'; break }
        default { '模型交接配置或资料检查未通过，请核对助手绑定地址及 Studio 路径。' }
    }
    $safeError = @{ stage = $diagnostic.stage; code = $diagnostic.code; httpStatus = $diagnostic.status; utc = [DateTime]::UtcNow.ToString('o') }
    try { $safeError | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'last-handoff-error.json') -Encoding UTF8 } catch { }
    [Windows.Forms.MessageBox]::Show(($message + "`n错误代码：" + $diagnostic.code + '。不会自动重试打开。'), '模型交接失败', 'OK', 'Error') | Out-Null
} finally { $client.Dispose(); $handler.Dispose() }
