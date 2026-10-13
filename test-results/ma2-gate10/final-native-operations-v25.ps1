param([ValidateSet('gateway','active-rollback','crash','cleanup')][string]$Phase)
$ErrorActionPreference='Stop'
$rec=$PSScriptRoot
$stage='C:\Users\allam\AppData\Local\Bunny-A-T10-stage'
$config=Get-Content -LiteralPath (Join-Path $stage 'install.json') -Raw | ConvertFrom-Json
$node=Join-Path $config.currentRelease.folder 'runtime\node.exe'
if($config.currentRelease.name -ne 'Bunny-A-Windows-v25-T10') {throw 'Expected final immutable candidate'}
if($Phase -eq 'gateway') {
 $old=Get-Content -LiteralPath (Join-Path $rec 'ui-v24-gateway-owner-final.json') -Raw | ConvertFrom-Json
 & (Join-Path $rec 'stop-owned.ps1') -OwnedPid $old.pid -ExpectedExecutable $old.executable -Entry 'ui-gateway-v24.mjs' -OutputPath (Join-Path $rec 'ui-v24-gateway-cleanup.json')
 $entry=Join-Path $rec 'ui-gateway-v25.mjs'
 $process=Start-Process -FilePath $node -ArgumentList @('"'+$entry+'"') -WorkingDirectory $rec -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $rec 'ui-v25-gateway.log') -RedirectStandardError (Join-Path $rec 'ui-v25-gateway-error.log')
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='DISPOSABLE LIVE';role='T10 exact installed v25 dashboard';pid=$process.Id;executable=$node;entry=$entry} | ConvertTo-Json | Set-Content (Join-Path $rec 'ui-v25-gateway-owner.json') -Encoding utf8
}
if($Phase -eq 'active-rollback') {
 $beforeHash=(Get-FileHash (Join-Path $stage 'install.json') -Algorithm SHA256).Hash
 $before=Invoke-RestMethod 'http://127.0.0.1:45129/health'
 $refused=$false
 try { & (Join-Path $config.currentRelease.folder 'scripts\install-bunny-release.ps1') -InstallRoot $stage -StartupDirectory (Join-Path $stage 'startup') -Rollback -RollbackDirectory $config.rollbackDirectory }
 catch {if($_.Exception.Message -notmatch 'quiescent') {throw};$refused=$true}
 if(-not $refused) {throw 'Active-grant rollback must refuse'}
 if((Get-FileHash (Join-Path $stage 'install.json') -Algorithm SHA256).Hash -ne $beforeHash) {throw 'Install state changed'}
 $after=Invoke-RestMethod 'http://127.0.0.1:45129/health'
 if($before.instanceId -ne $after.instanceId) {throw 'Host changed on refused rollback'}
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='DISPOSABLE LIVE';attackId='T10-XG-06';exactInstalledTooling=$true;refused=$true;installConfigUnchanged=$true;hostUnchanged=$true;before=$before;after=$after} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $rec 'installed-active-rollback-v25.json') -Encoding utf8
}
if($Phase -eq 'crash' -or $Phase -eq 'cleanup') {
 $credential=Get-Content -LiteralPath (Join-Path $stage 'state\credentials\credentials.json') -Raw | ConvertFrom-Json
 $health=Invoke-RestMethod 'http://127.0.0.1:45129/health'
 if($health.pid -ne $credential.pid -or $health.instanceId -ne $credential.instanceId) {throw 'Fresh Host credential identity mismatch'}
 & (Join-Path $rec 'stop-owned.ps1') -OwnedPid $health.pid -ExpectedExecutable $node -Entry 'Bunny-Host.mjs' -OutputPath (Join-Path $rec ('stage-v25-'+$Phase+'.json'))
}
