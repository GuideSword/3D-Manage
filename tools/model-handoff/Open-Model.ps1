param([Parameter(Mandatory)][string]$Uri)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Net.Http
$scriptRoot = if($PSScriptRoot){$PSScriptRoot}else{[AppDomain]::CurrentDomain.BaseDirectory}
Import-Module (Join-Path $scriptRoot 'Handoff.Core.psm1') -Force
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromMinutes(5)
$diagnostic = @{ stage = 'startup'; status = 0; code = 'HANDOFF_STARTUP' }
try {
    $diagnostic.stage = 'arguments'
    $diagnostic.code = 'HANDOFF_ARGUMENTS'
    $unboundArguments = Get-Variable -Name args -ValueOnly -ErrorAction SilentlyContinue
    if ($null -ne $unboundArguments -and @($unboundArguments).Count -gt 0) { throw '不接受额外交接参数' }
    $diagnostic.stage = 'configuration'
    $diagnostic.code = 'HANDOFF_CONFIGURATION'
    $configPath = Join-Path $scriptRoot 'config.json'
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw '助手配置文件不存在，请重新安装助手' }
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if (-not $config.serverUrl -or -not $config.serverId -or -not $config.studioPath) { throw '助手配置文件缺少服务器或Studio路径' }
    $diagnostic.stage = 'handoff-uri'
    $diagnostic.code = 'HANDOFF_URI'
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
    $rawMessage = [string]$_.Exception.Message
    if ($rawMessage -match '交接地址无效|交接参数|交接凭据') { $diagnostic.code = 'HANDOFF_URI' }
    elseif ($rawMessage -match '服务器与已绑定|HTTPS ERP接口地址') { $diagnostic.code = 'HANDOFF_SERVER_BINDING' }
    elseif ($rawMessage -match '配置文件|配置') { $diagnostic.code = 'HANDOFF_CONFIGURATION' }
    elseif ($rawMessage -match 'Studio程序路径') { $diagnostic.code = 'HANDOFF_STUDIO_CONFIGURATION' }
    $message = switch ($diagnostic.code) {
        'MODEL_DOWNLOAD_AUTHORIZATION_REQUIRED' { '交接授权已过期、已使用或失效。请回到 ERP 重新验证下载密码，并在一分钟内点击打开。'; break }
        'FILE_IDENTITY_UNAVAILABLE' { '服务器缺少这个模型的完整校验信息，请联系管理员补全文件资料。'; break }
        'AUTHENTICATION_REQUIRED' { '账号登录状态已失效，请在 ERP 重新登录并授权。'; break }
        'DOWNLOAD_HTTPS_REQUIRED' { '服务器拒绝了未加密的交接请求，请核对 HTTPS 配置。'; break }
        'HANDOFF_IDENTITY' { '无法核对服务器身份，请检查 HTTPS 连接和助手绑定的服务器。'; break }
        'HANDOFF_URI' { '网页传来的交接地址无效或已被系统截断。请重新授权后再点击打开。'; break }
        'HANDOFF_SERVER_BINDING' { '网页交接地址与助手绑定的服务器不一致，请确认 Web 使用的是同一个 HTTPS 地址。'; break }
        'HANDOFF_STUDIO_CONFIGURATION' { '助手保存的 Bambu Studio 路径无效，请重新安装助手并选择 bambu-studio.exe。'; break }
        'HANDOFF_AUTHORIZATION' { '交接授权兑换失败，请回到 ERP 重新授权。'; break }
        'HANDOFF_DOWNLOAD' { '模型传输或完整性校验失败，未打开 Studio。请回到 ERP 重新授权。'; break }
        'HANDOFF_STUDIO' { '模型已校验，但无法启动所配置的 Bambu Studio，请核对程序路径和运行权限。'; break }
        default { '模型交接配置或资料检查未通过，请核对助手绑定地址及 Studio 路径。' }
    }
    $safeError = @{ stage = $diagnostic.stage; code = $diagnostic.code; httpStatus = $diagnostic.status; utc = [DateTime]::UtcNow.ToString('o') }
    try { $safeError | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'last-handoff-error.json') -Encoding UTF8 } catch { }
    [Windows.Forms.MessageBox]::Show(($message + "`n错误代码：" + $diagnostic.code + '。不会自动重试打开。'), '模型交接失败', 'OK', 'Error') | Out-Null
} finally { $client.Dispose(); $handler.Dispose() }
