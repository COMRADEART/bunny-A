param([ValidateSet('inspect','activate')][string]$Phase='inspect')
$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$rec=$PSScriptRoot
$root=Join-Path $env:LOCALAPPDATA 'Bunny-A'
$auth=Get-Content -LiteralPath (Join-Path $rec 'authorization.json') -Raw | ConvertFrom-Json
if(-not $auth.productionActivationAuthorized) {throw 'Explicit authorization missing'}
$cfgPath=Join-Path $root 'install.json'
$cfg=Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
$oldRelease=$cfg.currentRelease.folder
$target=Join-Path $root ('releases\'+$auth.candidate.release)
if((Get-FileHash -LiteralPath (Join-Path $target 'release-manifest.json') -Algorithm SHA256).Hash.ToLower() -ne $auth.candidate.manifestSha256) {throw 'Authorized manifest mismatch'}
. (Join-Path $target 'Bunny-State.ps1')
$identity=[pscustomobject]@{name=$auth.candidate.release;folder=$target;sourceCommit=$auth.candidate.sourceCommit;manifestSha256=$auth.candidate.manifestSha256}
$manifest=Assert-BunnyRelease $target $identity
if($manifest.toolingCommit -ne $auth.candidate.toolingCommit -or $manifest.version -ne $auth.candidate.version) {throw 'Authorized tooling/version mismatch'}
[void](Assert-BunnyRelease $oldRelease $cfg.currentRelease)
if($cfg.currentRelease.name -ne 'Bunny-A-Windows-v17-T6') {throw 'Unexpected current production selection'}
$state=$cfg.stateRoot
$paths=Get-BunnyStatePaths $cfg
$credential=Get-Content -LiteralPath $paths.credentials -Raw | ConvertFrom-Json
$health=Invoke-RestMethod ('http://127.0.0.1:'+$cfg.hostPort+'/health') -TimeoutSec 5
$web=Invoke-RestMethod 'http://127.0.0.1:8084/bunny-health' -TimeoutSec 5
if($health.pid -ne $credential.pid -or $health.instanceId -ne $credential.instanceId -or $health.operationalState -ne 'healthy' -or $web.root -ne $state) {throw 'Fresh health/credential/root identity mismatch'}
$application=Get-Content -LiteralPath (Join-Path $state 'runtime\windows-application.json') -Raw | ConvertFrom-Json
$tunnel=Get-Content -LiteralPath $paths.tunnelProcess -Raw | ConvertFrom-Json
if($application.sourceCommit -ne $cfg.currentRelease.sourceCommit -or $application.manifestSha256 -ne $cfg.currentRelease.manifestSha256 -or -not $application.loaded -or -not $application.visible) {throw 'Application ownership anchor mismatch'}
if($tunnel.root -ne $state -or $tunnel.target -ne 'http://127.0.0.1:8084' -or -not $tunnel.startedAt) {throw 'Tunnel ownership anchor mismatch'}
$deployment=Get-Content -LiteralPath $paths.deployment -Raw | ConvertFrom-Json
if($deployment.packagePath -ne $oldRelease) {throw 'Unexpected gateway selection'}
$nativeExe=Join-Path $root 'Bunny-A.exe'
$bootstrapSha=(Get-FileHash -LiteralPath $nativeExe -Algorithm SHA256).Hash.ToLower()
$expectedBootstrap=(Get-Content -LiteralPath (Join-Path $rec 'preflight\production.json') -Raw | ConvertFrom-Json).bootstrapSha256
if($bootstrapSha -ne $expectedBootstrap) {throw 'Shared native bootstrap changed'}
if((Get-FileHash -LiteralPath $paths.cloudflared -Algorithm SHA256).Hash.ToLower() -ne $cfg.tools.cloudflared.sha256) {throw 'Cloudflared bytes changed'}
$held=@();$support=@();$records=@();$lock=$null;$lockPath=Join-Path $root 'state-migration.lock';$success=$false
. (Join-Path $PSScriptRoot 'console-ownership.ps1')
function Hold-Role([string]$Role,[int]$RolePid,[string]$Executable,[string]$Entry) {Hold-R11Process $Role $RolePid $Executable $Entry}

try {
 $held+=Hold-Role 'host' $health.pid (Join-Path $oldRelease 'runtime\node.exe') (Join-Path $oldRelease 'Bunny-Host.mjs')
 $held+=Hold-Role 'gateway' $web.pid (Join-Path $oldRelease 'runtime\node.exe') (Join-Path $oldRelease 'Bunny-Server.mjs')
 $held+=Hold-Role 'application' $application.pid $nativeExe $nativeExe
 $held+=Hold-Role 'tunnel-worker' $tunnel.pid (Join-Path $oldRelease 'runtime\node.exe') (Join-Path $oldRelease 'scripts\bunny-tunnel.mjs')
 $held+=Hold-Role 'cloudflared' $tunnel.childPid $paths.cloudflared 'tunnel --no-autoupdate --url http://127.0.0.1:8084'
 $worker=$held | Where-Object role -eq 'tunnel-worker';$cloud=$held | Where-Object role -eq 'cloudflared';$app=$held | Where-Object role -eq 'application'
 if($worker.createdAt -ne $tunnel.startedAt -or $cloud.parentPid -ne $worker.pid -or [DateTime]::Parse($cloud.createdAt).ToUniversalTime() -lt [DateTime]::Parse($worker.createdAt).ToUniversalTime()) {throw 'Fresh tunnel lifetime/child relationship mismatch'}
 if([DateTime]::Parse($application.at).ToUniversalTime() -lt [DateTime]::Parse($app.createdAt).ToUniversalTime() -or ([DateTime]::Parse($application.at).ToUniversalTime()-[DateTime]::Parse($app.createdAt).ToUniversalTime()).TotalMinutes -gt 2) {throw 'Application record does not corroborate this lifetime'}
 foreach($role in $held | Where-Object role -in @('host','gateway')) {if($role.parentPid -ne $app.pid){throw 'Native app/Host/gateway parent relationship mismatch'}}
 $all=@(Get-CimInstance Win32_Process -ErrorAction Stop)
 $support=@(Assert-R11Topology $held)
 $supportEvidence=@($support | Select-Object role,pid,parentPid,createdAt,ticks,executable,sessionId,ownerSid,facts,directKillAuthority)
 $otherOps=@($all | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-File\s+"?[^\r\n"]*(install-bunny-release|migrate-bunny-state)\.ps1' })
 if($otherOps.Count) {throw 'Installer or migration operation currently active'}
 if(Test-Path -LiteralPath $lockPath) {throw 'Existing operation lock; activation refused'}
 foreach($port in @(43119,8084)) {$listen=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop);$expected=if($port -eq 43119){$health.pid}else{$web.pid};if(-not $listen.Count -or @($listen | Where-Object OwningProcess -ne $expected).Count){throw 'Listener identity mismatch'}}
 & (Join-Path $target 'runtime\node.exe') (Join-Path $target 'scripts\bunny-rollback-preflight.mjs') $cfgPath
 if($LASTEXITCODE -ne 0) {throw 'Final canonical quiescence refused'}
 $records=@($held | Select-Object role,pid,parentPid,createdAt,ticks,executable,entry,commandLine)
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED';health=$health;gatewayHealth=$web;roles=$records;support=$supportEvidence;allSupportHandlesHeldForObservation=$true;supportDirectKillAuthority=$false;allFiveHandlesHeld=$true;freshCimCorroborated=$true;noUnexpectedChildren=$true;noOtherInstallerOrMigration=$true;canonicalQuiescent=$true;phase=$Phase} | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $PSScriptRoot ('fresh-ownership-'+$Phase+'.json')) -Encoding utf8
 if($Phase -eq 'inspect') {return}
 $pre=Get-Content -LiteralPath (Join-Path $rec 'preflight\production.json') -Raw | ConvertFrom-Json
 if((Get-FileHash -LiteralPath $cfgPath -Algorithm SHA256).Hash.ToLower() -ne $pre.configSha256 -or $health.instanceId -ne $pre.health.instanceId) {throw 'Production changed since immediate backup; refresh required'}
 $lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
 $lockBytes=[Text.Encoding]::UTF8.GetBytes('Authorized R1 promotion; startup inhibited until selection is consistent.')
 $lock.Write($lockBytes,0,$lockBytes.Length);$lock.Flush()
 $rechecked=@(Assert-R11Topology $held)
 foreach($s in $support){$s.process.Dispose()};$support=$rechecked
 $stops=@()
 foreach($name in @('tunnel-worker','cloudflared','gateway','host','application')) {
  $currentAll=@(Get-CimInstance Win32_Process -ErrorAction Stop)
  $knownRolePids=@($held | ForEach-Object pid);$knownSupportPids=@($support | ForEach-Object pid)
  if(@($currentAll | Where-Object { $_.ParentProcessId -in @($knownRolePids+$knownSupportPids) -and $_.ProcessId -notin @($knownRolePids+$knownSupportPids) }).Count) {throw 'New unmodelled descendant immediately before Stop'}
  foreach($s in $support | Where-Object { -not $_.process.HasExited }) {Assert-R11HeldIdentity $s ($currentAll | Where-Object ProcessId -eq $s.pid)}
  $item=$held | Where-Object role -eq $name
  if(-not $item.process.HasExited) {
   $now=Get-CimInstance Win32_Process -Filter "ProcessId=$($item.pid)" -ErrorAction Stop
   if(-not $now -or $now.CreationDate.ToUniversalTime().ToString('o') -ne $item.createdAt -or -not [String]::Equals($now.ExecutablePath,$item.executable,[StringComparison]::OrdinalIgnoreCase) -or -not $now.CommandLine.Contains($item.entry)) {throw 'Fresh identity failed immediately before held Stop'}
   $item.process.Kill();if(-not $item.process.WaitForExit(10000)) {throw 'Held owned process did not exit'}
   $stops+=@{role=$name;pid=$item.pid;creationTicks=$item.ticks;heldHandleTermination=$true;freshImmediatelyBeforeStop=$true;alreadyExited=$false}
  } else {$stops+=@{role=$name;pid=$item.pid;creationTicks=$item.ticks;alreadyExited=$true;noReplacementLookup=$true}}
 }
 foreach($s in $support) {if(-not $s.process.WaitForExit(10000)){throw 'Console support remains after owned parents; no direct cleanup permitted'}}
 if(@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in @(43119,8084)).Count) {throw 'Production listener remains; selection aborted'}
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED';stops=$stops;supportExitedNaturally=$true;supportTerminatedDirectly=$false;noIntegerPidTaskkill=$true;noNamesUsed=$true;failedInspectionWouldAbort=$true} | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'owned-stop.json') -Encoding utf8
 $zip=Join-Path (Get-Location).Path ('releases\'+$auth.candidate.release+'.zip')
 if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower() -ne $auth.candidate.zipSha256) {throw 'Authorized ZIP changed before install'}
 & (Join-Path $target 'scripts\install-bunny-release.ps1') -Package $zip -InstallRoot $root -DataDirectory $state -Workspace $cfg.workspace -HostPort $cfg.hostPort -StartupDirectory ([Environment]::GetFolderPath('Startup')) | Set-Content (Join-Path $PSScriptRoot 'installer-selection.json') -Encoding utf8
 $new=Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
 if($new.currentRelease.manifestSha256 -ne $auth.candidate.manifestSha256 -or $new.currentRelease.packageSha256 -ne $auth.candidate.zipSha256 -or $new.currentRelease.sourceCommit -ne $auth.candidate.sourceCommit -or $new.currentRelease.toolingCommit -ne $auth.candidate.toolingCommit) {throw 'Installer selection differs from authorization'}
 foreach($field in @('tools','stateMigration')) {if($cfg.PSObject.Properties[$field]) {$new | Add-Member -MemberType NoteProperty -Name $field -Value $cfg.$field -Force}}
 $deployment.packagePath=$target
 Write-BunnyJson $paths.deployment $deployment
 # The accepted shared native Windows entry reads and validates install.json. Preserve that
 # startup mechanism while selecting new immutable Host/gateway/Island bytes atomically.
 $shell=New-Object -ComObject WScript.Shell
 $shortcut=$shell.CreateShortcut($new.shortcut);$shortcut.TargetPath=$nativeExe;$shortcut.Arguments='';$shortcut.WorkingDirectory=$root;$shortcut.WindowStyle=7;$shortcut.Description='Start Bunny-A using the current manifest-pinned installed release.';$shortcut.Save()
 Write-BunnyJson $cfgPath $new
 [void](Assert-BunnyRelease $target $new.currentRelease)
 if($new.stateRoot -ne $state -or $new.workspace -ne $cfg.workspace -or $new.hostPort -ne $cfg.hostPort -or (Get-FileHash -LiteralPath $paths.credentials -Algorithm SHA256).Hash.ToLower() -ne $pre.credentialFileSha256) {throw 'Canonical state/credential/workspace changed during selection'}
 $record=@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED';performed=$true;authorizationObtained=$true;candidate=$new.currentRelease;previous=$cfg.currentRelease;stateRoot=$state;workspace=$new.workspace;hostPort=$new.hostPort;installer='Exact pinned candidate canonical installer';atomicWriter='Exact pinned Bunny-State.ps1 Write-BunnyJson / File.Replace';startupInhibitedDuringSelection=$true;finalConfigCommitAtomic=$true;gatewaySelectedTarget=$target;sharedNativeBootstrapPreserved=$true;bootstrapSha256=$bootstrapSha;canonicalCredentialsUnchangedBeforeBoot=$true;rollbackDirectory=$new.rollbackDirectory;gitRuntimeDeployment=$false;historicalControllerUsed=$false;bootAcceptancePending=$true}
 $record | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $rec 'activation.json') -Encoding utf8
 $record | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $PSScriptRoot 'selection.json') -Encoding utf8
 $success=$true
} finally {
 foreach($s in $support) {$s.process.Dispose()}
 foreach($item in $held) {$item.process.Dispose()}
 if($lock) {$lock.Dispose();if($success) {Remove-Item -LiteralPath $lockPath} else {Write-Output 'Startup inhibit lock retained after unsuccessful selection; no automatic unsafe recovery.'}}
}
