param([string]$Uri, $Config, [switch]$Standalone)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$scriptRoot=if($PSScriptRoot){$PSScriptRoot}else{[AppDomain]::CurrentDomain.BaseDirectory}
Import-Module (Join-Path $scriptRoot 'Import.Core.psm1') -Force
Import-Module (Join-Path $scriptRoot 'Import.Ui.psm1') -Force
if ($env:MODEL_IMPORT_STANDALONE -eq '1') { $Standalone = $true }

function Show-ImportLaunchError {
 param([Parameter(Mandatory)][string]$Message)
 if ($env:MODEL_IMPORT_HEADLESS -eq '1') { Write-Error $Message; return }
 try { Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.MessageBox]::Show($Message, 'model-import', 'OK', 'Error') | Out-Null } catch { Write-Error $Message }
}

if (-not $Config) {
 $configPath=Join-Path $env:LOCALAPPDATA '3DManageModelHandoff/app/config.json'
 if (Test-Path -LiteralPath $configPath) { $Config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } else { Show-ImportLaunchError '助手尚未安装或缺少服务器绑定配置，请先安装 Windows 模型助手。'; exit 1 }
}
if ([string]::IsNullOrWhiteSpace($Uri) -and -not $Standalone) { Show-ImportLaunchError '请从 3D-Manage 模型库点击“批量导入模型”启动 model-import。直接双击脚本没有一次性导入授权，无法开始传输。'; exit 1 }

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

function Get-StandaloneServerOptions {
 param($Config)
 $values=@()
 if ($Config.PSObject.Properties['serverBindings'] -and $Config.serverBindings) { $values += @($Config.serverBindings | ForEach-Object { $_.serverUrl }) }
 if ($Config.PSObject.Properties['serverUrls'] -and $Config.serverUrls) { $values += @($Config.serverUrls) }
 if ($Config.serverUrl) { $values += [string]$Config.serverUrl }
 @($values | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { ([string]$_).TrimEnd('/') } | Select-Object -Unique)
}

function Resolve-StandaloneServer {
 param([Parameter(Mandatory)][string]$Server, [Parameter(Mandatory)]$Config)
 $uri=[Uri]$Server
 if(!$uri.IsAbsoluteUri -or $uri.Scheme -cne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath.TrimEnd('/') -notmatch '/api$'){throw '服务器地址必须是受信 HTTPS ERP 接口地址，并以 /api 结尾'}
 $normalized=$uri.AbsoluteUri.TrimEnd('/'); $expectedId=$null
 if ($Config.PSObject.Properties['serverBindings']) { foreach($binding in @($Config.serverBindings)) { if(([string]$binding.serverUrl).TrimEnd('/') -ceq $normalized) { $expectedId=[string]$binding.serverId } } }
 if(-not $expectedId -and ([string]$Config.serverUrl).TrimEnd('/') -ceq $normalized) { $expectedId=[string]$Config.serverId }
 if(-not $expectedId) { throw '该服务器尚未绑定，请先通过安装助手绑定后再选择' }
 @{Server=$normalized;ServerId=$expectedId}
}

function Invoke-StandaloneImportAttempt {
 param([Parameter(Mandatory)]$Setup,[Parameter(Mandatory)]$Config)
 $req=Resolve-StandaloneServer -Server $Setup.Server -Config $Config
 $identity=Invoke-RestMethod -Uri ($req.Server+'/system/info') -Method Get -MaximumRedirection 0 -TimeoutSec 15
 if([string]$identity.serverId -cne [string]$req.ServerId){throw 'ERP服务器身份已变化，拒绝导入'}
 $session=Invoke-RestMethod -Uri ($req.Server+'/auth/login') -Method Post -Body (@{email=$Setup.Email;password=$Setup.Password}|ConvertTo-Json) -ContentType 'application/json' -MaximumRedirection 0
 $token=[string]$session.token; if($token -notmatch '^[A-Za-z0-9._-]{20,}$'){throw '服务器返回的登录授权无效'}
 $headers=@{Authorization='Bearer '+$token;'X-Business-Rules-Version'='2'}; $jobHeaders=$headers.Clone();$jobHeaders['Idempotency-Key']=[guid]::NewGuid().ToString('N')
 $job=Invoke-RestMethod -Uri ($req.Server+'/model-import/jobs') -Method Post -Headers $jobHeaders -Body (@{clientJobId=([guid]::NewGuid().ToString('N'));options=@{extensions=$Setup.Extensions;concurrency=$Setup.Concurrency}}|ConvertTo-Json -Depth 5) -ContentType 'application/json' -MaximumRedirection 0
 $jobId=[string]$job.jobId; if(-not $jobId){$jobId=[string]$job.id}; if(-not $jobId){throw '服务器未返回导入任务编号'}
 $manifestPath=[IO.Path]::Combine($env:LOCALAPPDATA,'3DManageModelHandoff','imports',$jobId); $context=[pscustomobject]@{Server=$req.Server;JobId=$jobId;Token=$token}
 $prepare={param($item,$context)
  $extension=[IO.Path]::GetExtension([string]$item.OriginalName).ToLowerInvariant(); $payload=@{itemId=[string]$item.ItemId;relativePath=[string]$item.RelativePath;originalName=[string]$item.OriginalName;size=[long]$item.Size;sha256=([string]$item.Sha256).ToLowerInvariant();descriptionFacts="文件 $($item.OriginalName)，格式 $extension，大小 $($item.Size) 字节，来源路径 $($item.RelativePath)"}
  $prepareHeaders=@{Authorization='Bearer '+$context.Token;'X-Business-Rules-Version'='2';'Idempotency-Key'="prepare-$($item.ItemId)"}; $result=Invoke-RestMethod -Uri ($context.Server+'/model-import/jobs/'+$context.JobId+'/items/prepare') -Method Post -Headers $prepareHeaders -Body ($payload|ConvertTo-Json -Depth 10) -ContentType 'application/json' -MaximumRedirection 0
  if($result.state -eq 'duplicate' -or $result.duplicate -eq $true){$item.State='duplicate';$item.DuplicateReason='内容已存在'}
 }
 $upload={param($item,$context)
  if($item.State -eq 'duplicate'){return}; $f=Join-Path $item.SourcePath $item.RelativePath; if(-not (Test-Path -LiteralPath $f)){$f=$item.Path}; $client=[Net.Http.HttpClient]::new(); $stream=$null
  try{$client.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$context.Token);$client.DefaultRequestHeaders.Add('X-Business-Rules-Version','2');$client.DefaultRequestHeaders.Add('Idempotency-Key',"upload-$($item.ItemId)");$form=[Net.Http.MultipartFormDataContent]::new();$stream=[IO.File]::OpenRead($f);$content=[Net.Http.StreamContent]::new($stream);$form.Add($content,'file',[IO.Path]::GetFileName($f));$resp=$client.PostAsync($context.Server+'/model-import/jobs/'+$context.JobId+'/items/'+$item.ItemId+'/file',$form).GetAwaiter().GetResult();if(-not $resp.IsSuccessStatusCode){throw ('上传失败: '+[int]$resp.StatusCode)}}finally{if($stream){$stream.Dispose()};$client.Dispose()}
 }
 Show-ModelImportWorkbench -Root $Setup.Root -Extensions $Setup.Extensions -ManifestPath $manifestPath -Prepare $prepare -Upload $upload -Concurrency $Setup.Concurrency -Context $context | Out-Null
}

if ($Standalone) {
 $previous=$null
 while($true) {
  $setup=Show-StandaloneImportSetup -ServerOptions (Get-StandaloneServerOptions $Config) -DefaultServer ([string]$Config.serverUrl) -Initial $previous
  if ($setup.Cancelled) { exit 0 }
  try { Invoke-StandaloneImportAttempt -Setup $setup -Config $Config; exit 0 }
  catch { Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.MessageBox]::Show(('连接或创建导入任务失败：' + $_.Exception.Message), 'model-import', 'OK', 'Error') | Out-Null; $previous=$setup }
 }
}

if(-not $Uri){ $Uri='manage3d-model://import' }
$req=ConvertFrom-ImportUri $Uri $Config.serverUrl
$identity=Invoke-RestMethod -Uri ($req.Server+'/system/info') -Method Get -MaximumRedirection 0 -TimeoutSec 15
if([string]$identity.serverId -cne [string]$Config.serverId){throw 'ERP服务器身份已变化，拒绝导入'}
$session=Invoke-RestMethod -Uri ($req.Server+'/model-import/handoff/redeem') -Method Post -Body (@{ticket=$req.Ticket}|ConvertTo-Json) -ContentType 'application/json' -MaximumRedirection 0
$token=[string]$session.token; if($token -notmatch '^[A-Za-z0-9._-]{20,}$'){throw '服务器返回的导入授权无效'}
$headers=@{Authorization='Bearer '+$token;'X-Business-Rules-Version'='2'}; $jobHeaders=$headers.Clone();$jobHeaders['Idempotency-Key']=[guid]::NewGuid().ToString('N')
$job=Invoke-RestMethod -Uri ($req.Server+'/model-import/jobs') -Method Post -Headers $jobHeaders -Body (@{clientJobId=([guid]::NewGuid().ToString('N'));options=@{}}|ConvertTo-Json -Depth 5) -ContentType 'application/json' -MaximumRedirection 0
$jobId=[string]$job.jobId; if(-not $jobId){$jobId=[string]$job.id}; if(-not $jobId){throw '服务器未返回导入任务编号'}
$manifestPath=[IO.Path]::Combine($env:LOCALAPPDATA,'3DManageModelHandoff','imports',$jobId); $context=[pscustomobject]@{Server=$req.Server;JobId=$jobId;Token=$token}
$prepare={param($item,$context)
 $extension=[IO.Path]::GetExtension([string]$item.OriginalName).ToLowerInvariant(); $payload=@{itemId=[string]$item.ItemId;relativePath=[string]$item.RelativePath;originalName=[string]$item.OriginalName;size=[long]$item.Size;sha256=([string]$item.Sha256).ToLowerInvariant();descriptionFacts="文件 $($item.OriginalName)，格式 $extension，大小 $($item.Size) 字节，来源路径 $($item.RelativePath)"}
 $prepareHeaders=@{Authorization='Bearer '+$context.Token;'X-Business-Rules-Version'='2';'Idempotency-Key'="prepare-$($item.ItemId)"}; $result=Invoke-RestMethod -Uri ($context.Server+'/model-import/jobs/'+$context.JobId+'/items/prepare') -Method Post -Headers $prepareHeaders -Body ($payload|ConvertTo-Json -Depth 10) -ContentType 'application/json' -MaximumRedirection 0
 if($result.state -eq 'duplicate' -or $result.duplicate -eq $true){$item.State='duplicate';$item.DuplicateReason='内容已存在'}
}
$upload={param($item,$context)
 if($item.State -eq 'duplicate'){return}; $f=Join-Path $item.SourcePath $item.RelativePath; if(-not (Test-Path -LiteralPath $f)){$f=$item.Path}; $client=[Net.Http.HttpClient]::new(); $stream=$null
 try{$client.DefaultRequestHeaders.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$context.Token);$client.DefaultRequestHeaders.Add('X-Business-Rules-Version','2');$client.DefaultRequestHeaders.Add('Idempotency-Key',"upload-$($item.ItemId)");$form=[Net.Http.MultipartFormDataContent]::new();$stream=[IO.File]::OpenRead($f);$content=[Net.Http.StreamContent]::new($stream);$form.Add($content,'file',[IO.Path]::GetFileName($f));$resp=$client.PostAsync($context.Server+'/model-import/jobs/'+$context.JobId+'/items/'+$item.ItemId+'/file',$form).GetAwaiter().GetResult();if(-not $resp.IsSuccessStatusCode){throw ('上传失败: '+[int]$resp.StatusCode)}}finally{if($stream){$stream.Dispose()};$client.Dispose()}
}
Show-ModelImportWorkbench -Root ([IO.Path]::Combine($env:LOCALAPPDATA,'3DManageModelHandoff','imports')) -ManifestPath $manifestPath -Prepare $prepare -Upload $upload -Concurrency 2 -Context $context | Out-Null
exit 0
