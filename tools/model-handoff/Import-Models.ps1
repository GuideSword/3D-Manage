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
$session=Invoke-RestMethod -Uri ($req.Server+'/model-import/handoff/redeem') -Method Post -Body (@{ticket=$req.Ticket}|ConvertTo-Json) -ContentType 'application/json' -MaximumRedirection 0
$token=[string]$session.token; if($token -notmatch '^[A-Za-z0-9._-]{20,}$'){throw '服务器返回的导入授权无效'}
$headers=@{Authorization='Bearer '+$token}
$job=Invoke-RestMethod -Uri ($req.Server+'/model-import/jobs') -Method Post -Headers $headers -Body (@{clientJobId=([guid]::NewGuid().ToString('N')); options=@{}}|ConvertTo-Json -Depth 5) -ContentType 'application/json' -MaximumRedirection 0
$jobId=[string]$job.jobId; if(-not $jobId){$jobId=[string]$job.id}; if(-not $jobId){throw '服务器未返回导入任务编号'}
$manifestPath=[IO.Path]::Combine($env:LOCALAPPDATA,'3DManageModelHandoff','imports',$jobId)
$prepare={param($item)
 $facts=Get-ModelImportFacts $item; $payload=@{itemId=[string]$item.ItemId;relativePath=[string]$item.RelativePath;originalName=[string]$item.OriginalName;size=[long]$item.Size;sha256=([string]$item.Sha256).ToLowerInvariant();descriptionFacts="文件 $($facts.Name)，格式 $($facts.Extension)，大小 $($facts.Size) 字节，来源路径 $($facts.RelativePath)"}
 $result=Invoke-RestMethod -Uri ($req.Server+'/model-import/jobs/'+$jobId+'/items/prepare') -Method Post -Headers $headers -Body ($payload|ConvertTo-Json -Depth 10) -ContentType 'application/json' -MaximumRedirection 0
 if($result.state -eq 'duplicate' -or $result.duplicate -eq $true){$item.State='duplicate';$item.DuplicateReason='内容已存在'}
}
$upload={param($item)
 if($item.State -eq 'duplicate'){return}
 $f=Join-Path $item.SourcePath $item.RelativePath; if(-not (Test-Path -LiteralPath $f)){$f=$item.Path}; $client=[Net.Http.HttpClient]::new()
 try{$client.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$token);$form=[Net.Http.MultipartFormDataContent]::new();$stream=[IO.File]::OpenRead($f);$content=[Net.Http.StreamContent]::new($stream);$form.Add($content,'file',[IO.Path]::GetFileName($f));$resp=$client.PostAsync($req.Server+'/model-import/jobs/'+$jobId+'/items/'+$item.ItemId+'/file',$form).GetAwaiter().GetResult();if(-not $resp.IsSuccessStatusCode){throw ('上传失败: '+[int]$resp.StatusCode)}}finally{if($stream){$stream.Dispose()};$client.Dispose()}
}
$manifest=Show-ModelImportWorkbench -Root ([IO.Path]::Combine($env:LOCALAPPDATA,'3DManageModelHandoff','imports')) -ManifestPath $manifestPath -Prepare $prepare -Upload $upload -Concurrency 2
