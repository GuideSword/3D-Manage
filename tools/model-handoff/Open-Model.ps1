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
try {
    if ($args.Count) { throw '不接受额外交接参数' }
    $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
    $readServer = {
        param($url)
        $response = $client.GetAsync($url).GetAwaiter().GetResult()
        try {
            if (-not $response.IsSuccessStatusCode) { throw '无法确认ERP服务器身份' }
            return ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json)
        } finally { $response.Dispose() }
    }
    $post = {
        param($url, $body)
        $content = [Net.Http.StringContent]::new(($body | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json')
        try {
            $response = $client.PostAsync($url, $content).GetAwaiter().GetResult()
            try {
                if (-not $response.IsSuccessStatusCode) { throw '交接授权失效或服务器拒绝访问，请回到ERP重新验证' }
                return ($response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json)
            } finally { $response.Dispose() }
        } finally { $content.Dispose() }
    }
    $download = {
        param($url, $token, $destination, $expectedSize)
        $message = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $url)
        $message.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)
        try {
            $response = $client.SendAsync($message, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            try {
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
    [Windows.Forms.MessageBox]::Show('模型交接未完成。请确认助手绑定的服务器、Studio路径及HTTPS证书有效，然后回到ERP重新授权。不会自动重试打开。', '模型交接失败', 'OK', 'Error') | Out-Null
} finally { $client.Dispose(); $handler.Dispose() }
