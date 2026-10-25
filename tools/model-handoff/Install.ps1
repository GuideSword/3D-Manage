param([string]$ServerUrl, [string]$StudioPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
if (-not $ServerUrl) { $ServerUrl = Read-Host '请输入ERP的HTTPS接口地址，例如 https://192.168.0.32/api' }
$server = [Uri]$ServerUrl
if (-not $server.IsAbsoluteUri -or $server.Scheme -ne 'https' -or $server.UserInfo -or $server.Query -or $server.Fragment -or $server.AbsolutePath.TrimEnd('/') -notmatch '/api$') { throw '必须使用受信HTTPS的ERP接口地址' }
$identity = Invoke-RestMethod -Uri ($server.AbsoluteUri.TrimEnd('/') + '/system/info') -Method Get -MaximumRedirection 0 -TimeoutSec 15
$parsedServerId = [guid]::Empty
if (-not [guid]::TryParse([string]$identity.serverId, [ref]$parsedServerId)) { throw '服务器未返回有效ERP身份，不能安装绑定' }
if (-not $StudioPath) {
    $dialog = [Windows.Forms.OpenFileDialog]::new()
    try {
        $dialog.Title = '请选择Bambu Studio的bambu-studio.exe'
        $dialog.Filter = 'Bambu Studio|bambu-studio.exe'
        if ($dialog.ShowDialog() -ne 'OK') { return }
        $StudioPath = $dialog.FileName
    } finally { $dialog.Dispose() }
}
$studio = Get-Item -LiteralPath $StudioPath
if ($studio.Name -ine 'bambu-studio.exe' -or $studio.PSIsContainer) { throw 'Studio程序路径无效' }
$target = Join-Path $env:LOCALAPPDATA '3DManageModelHandoff/app'
$key = 'HKCU:\Software\Classes\manage3d-model'
if (Test-Path -LiteralPath $key) { throw '此协议已注册；请先检查原安装，不自动覆盖已有处理程序' }
if (([Windows.Forms.MessageBox]::Show("将安装本地助手并注册独立的manage3d-model协议。`nERP：$($server.AbsoluteUri)`nStudio：$($studio.FullName)`n不修改STL/3MF文件关联，不启动Studio。是否继续？", '安装模型交接助手', 'YesNo', 'Question')) -ne 'Yes') { return }
if (Test-Path -LiteralPath $target) { throw '安装目录已存在，拒绝覆盖；请先检查原安装' }
New-Item -ItemType Directory -Path $target | Out-Null
foreach ($name in @('Dispatch-ModelHandoff.ps1','Open-Model.ps1','Import-Models.ps1','Handoff.Core.psm1','Import.Core.psm1','Import.Ui.psm1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $target $name) }
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'model-import.exe') -PathType Leaf) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'model-import.exe') -Destination (Join-Path $target 'model-import.exe') }
@{ serverUrl = $server.AbsoluteUri.TrimEnd('/'); serverId = [string]$identity.serverId; studioPath = $studio.FullName } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'config.json') -Encoding UTF8
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$app = Join-Path $target 'model-import.exe'
$command = if (Test-Path -LiteralPath $app -PathType Leaf) { '"' + $app + '" "%1"' } else { '"' + $powershell + '" -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + (Join-Path $target 'Dispatch-ModelHandoff.ps1') + '" -Uri "%1"' }
New-Item -Path $key | Out-Null
Set-Item -LiteralPath $key -Value 'URL:3D Manage model handoff'
New-ItemProperty -LiteralPath $key -Name 'URL Protocol' -Value '' -PropertyType String | Out-Null
New-Item -Path ($key + '\shell\open\command') -Force | Out-Null
Set-Item -LiteralPath ($key + '\shell\open\command') -Value $command
Write-Output '助手已安装。返回ERP，由你点击打开Studio；此次安装没有启动Studio。'
