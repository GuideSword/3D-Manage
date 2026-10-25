param([string]$Uri, $Config)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Import.Core.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'Import.Ui.psm1') -Force
function ConvertFrom-ImportUri {
 param([Parameter(Mandatory)][string]$Value,[Parameter(Mandatory)][string]$AllowedServer)
 $u=[Uri]$Value
 if ($u.Scheme -cne 'manage3d-model' -or $u.Host -cne 'import' -or $u.AbsolutePath -notin @('','/') -or $u.UserInfo -or $u.Fragment -or $Value.Length -gt 4096){throw '模型导入地址无效'}
 $p=@{}; $q=$u.Query.TrimStart('?'); if(!$q){throw '模型导入参数缺失'}
 foreach($e in $q.Split('&')){$x=$e.Split('=',2);if($x.Count -ne 2){throw '模型导入参数无效'};$k=[Net.WebUtility]::UrlDecode($x[0]);if($k -notin @('server','ticket') -or $p.ContainsKey($k)){throw '模型导入参数重复或不受支持'};$p[$k]=[Net.WebUtility]::UrlDecode($x[1])}
 if($p.Count -ne 2 -or $p.ticket -notmatch '^[A-Za-z0-9_-]{43}$'){throw '导入凭据无效'}
 $s=[Uri]$p.server;$a=[Uri]$AllowedServer
 foreach($v in @($s,$a)){if(!$v.IsAbsoluteUri -or $v.Scheme -cne 'https' -or $v.UserInfo -or $v.Query -or $v.Fragment -or $v.AbsolutePath.TrimEnd('/') -notmatch '/api$'){throw '助手只允许已绑定的HTTPS ERP接口地址'}}
 if($s.AbsoluteUri.TrimEnd('/') -cne $a.AbsoluteUri.TrimEnd('/')){throw '服务器与已绑定ERP不一致'}
 @{Server=$a.AbsoluteUri.TrimEnd('/');Ticket=$p.ticket}
}
if(-not $Uri){ $Uri='manage3d-model://import' }
$req=ConvertFrom-ImportUri $Uri $Config.serverUrl
$identity=Invoke-RestMethod -Uri ($req.Server+'/system/info') -Method Get -MaximumRedirection 0 -TimeoutSec 15
if([string]$identity.serverId -cne [string]$Config.serverId){throw 'ERP服务器身份已变化，拒绝导入'}
# The ticket is intentionally retained only in this process. The workbench handles scanning and transfers.
$manifest=Show-ModelImportWorkbench -Root ([IO.Path]::Combine($env:LOCALAPPDATA,'3DManageModelHandoff','imports')) -Concurrency 2
if($manifest){$manifest | Add-Member NoteProperty Server $req.Server -Force; $manifest | Add-Member NoteProperty Ticket $req.Ticket -Force}
