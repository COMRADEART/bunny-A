param([string]$OutputName='production-identity.json')
$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
. (Join-Path $PSScriptRoot 'console-ownership.ps1')
$root=Join-Path $env:LOCALAPPDATA 'Bunny-A';$cfg=Get-Content -LiteralPath (Join-Path $root 'install.json') -Raw | ConvertFrom-Json
$auth=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'authorization.json') -Raw | ConvertFrom-Json
if($cfg.currentRelease.manifestSha256 -ne $auth.candidate.manifestSha256 -or $cfg.currentRelease.packageSha256 -ne $auth.candidate.zipSha256 -or $cfg.currentRelease.sourceCommit -ne $auth.candidate.sourceCommit -or $cfg.currentRelease.toolingCommit -ne $auth.candidate.toolingCommit){throw 'Installed selection is not exact authorized candidate'}
. (Join-Path $cfg.currentRelease.folder 'Bunny-State.ps1');[void](Assert-BunnyRelease $cfg.currentRelease.folder $cfg.currentRelease)
$state=$cfg.stateRoot;$paths=Get-BunnyStatePaths $cfg
$creds=Get-Content -LiteralPath $paths.credentials -Raw | ConvertFrom-Json
$health=Invoke-RestMethod ('http://127.0.0.1:'+$cfg.hostPort+'/health') -TimeoutSec 5;$web=Invoke-RestMethod http://127.0.0.1:8084/bunny-health -TimeoutSec 5
$app=Get-Content -LiteralPath (Join-Path $state 'runtime/windows-application.json') -Raw | ConvertFrom-Json;$tunnel=Get-Content -LiteralPath $paths.tunnelProcess -Raw | ConvertFrom-Json
if($health.pid -ne $creds.pid -or $health.instanceId -ne $creds.instanceId -or $health.operationalState -ne 'healthy' -or $web.release.manifestSha256 -ne $auth.candidate.manifestSha256 -or $web.root -ne $state -or $app.manifestSha256 -ne $auth.candidate.manifestSha256 -or $app.sourceCommit -ne $auth.candidate.sourceCommit -or -not $app.loaded){throw 'Runtime health/selection/application mismatch'}
$node=Join-Path $cfg.currentRelease.folder 'runtime/node.exe';$roles=@();$support=@()
try {
 $roles+=Hold-R11Process 'host' $health.pid $node (Join-Path $cfg.currentRelease.folder 'Bunny-Host.mjs')
 $roles+=Hold-R11Process 'gateway' $web.pid $node (Join-Path $cfg.currentRelease.folder 'Bunny-Server.mjs')
 $roles+=Hold-R11Process 'application' $app.pid (Join-Path $root 'Bunny-A.exe') (Join-Path $root 'Bunny-A.exe')
 $roles+=Hold-R11Process 'tunnel-worker' $tunnel.pid $node (Join-Path $cfg.currentRelease.folder 'scripts/bunny-tunnel.mjs')
 $roles+=Hold-R11Process 'cloudflared' $tunnel.childPid $paths.cloudflared 'tunnel --no-autoupdate --url http://127.0.0.1:8084'
 if(($roles | Where-Object role -eq 'tunnel-worker').createdAt -ne $tunnel.startedAt -or ($roles | Where-Object role -eq 'cloudflared').parentPid -ne $tunnel.pid -or (Get-FileHash -LiteralPath $paths.cloudflared).Hash.ToLower() -ne $cfg.tools.cloudflared.sha256){throw 'Fresh transport ownership mismatch'}
 $support=@(Assert-R11Topology $roles)
 $shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($cfg.shortcut)
 if($shortcut.TargetPath -ne (Join-Path $root 'Bunny-A.exe') -or $shortcut.WorkingDirectory -ne $root -or $shortcut.Arguments -ne ''){throw 'Startup selection mismatch'}
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED';release=$cfg.currentRelease;host=$health;gateway=$web;application=$app;roles=@($roles | Select-Object role,pid,parentPid,createdAt,ticks,executable,entry,sessionId,ownerSid);support=@($support | Select-Object pid,parentPid,createdAt,facts,directKillAuthority);stateRoot=$state;workspace=$cfg.workspace;startup=@{path=$cfg.shortcut;target=$shortcut.TargetPath;arguments=$shortcut.Arguments;workingDirectory=$shortcut.WorkingDirectory;sha256=(Get-FileHash -LiteralPath $cfg.shortcut).Hash.ToLower()};canonicalOwnedRoles=5;unexpectedDescendants=0;allInstalledBytesVerified=$true;sharedNativeBootstrapSha256=(Get-FileHash -LiteralPath (Join-Path $root 'Bunny-A.exe')).Hash.ToLower();cloudflaredSha256=$cfg.tools.cloudflared.sha256;physicalPhoneInteractionClaimed=$false} | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $PSScriptRoot $OutputName) -Encoding utf8
} finally {foreach($s in $support){$s.process.Dispose()};foreach($r in $roles){$r.process.Dispose()}}
