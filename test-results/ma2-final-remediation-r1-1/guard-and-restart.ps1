param([ValidateSet('guard','restart')][string]$Phase)
$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$root=Join-Path $env:LOCALAPPDATA 'Bunny-A'
$cfg=Get-Content -LiteralPath (Join-Path $root 'install.json') -Raw | ConvertFrom-Json
if($cfg.currentRelease.name -ne 'Bunny-A-Windows-v26-MA2-R1') {throw 'Unexpected installed production candidate'}
$health=Invoke-RestMethod ('http://127.0.0.1:'+$cfg.hostPort+'/health') -TimeoutSec 5
if($Phase -eq 'guard') {
 # Private selection fixture points to actual canonical production authority. If a bug
 # bypassed the guard, only private selection/Startup would be eligible for mutation.
 $fixtureRoot=Join-Path $cfg.stateRoot 'backups/ma2-final-remediation-r1-1/rollback-acceptance'
 $rollback=Join-Path $fixtureRoot 'prior';$startup=Join-Path $fixtureRoot 'startup'
 New-Item -ItemType Directory -Path $rollback,$startup -Force | Out-Null
 $encoded=$cfg | ConvertTo-Json -Depth 12
 [IO.File]::WriteAllText((Join-Path $fixtureRoot 'install.json'),$encoded,(New-Object Text.UTF8Encoding($false)))
 [IO.File]::WriteAllText((Join-Path $rollback 'install.json'),$encoded,(New-Object Text.UTF8Encoding($false)))
 @{arguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $cfg.currentRelease.folder 'Start-Bunny-Release.ps1')+'"';workingDirectory=$cfg.currentRelease.folder} | ConvertTo-Json | Set-Content (Join-Path $rollback 'shortcut.json') -Encoding utf8
 @{deploymentPath=$null} | ConvertTo-Json | Set-Content (Join-Path $rollback 'rollback.json') -Encoding utf8
 $before=(Get-FileHash -LiteralPath (Join-Path $root 'install.json') -Algorithm SHA256).Hash
 $fixtureBefore=(Get-FileHash -LiteralPath (Join-Path $fixtureRoot 'install.json') -Algorithm SHA256).Hash
 $refused=$false;$detail=$null
 try {& (Join-Path $cfg.currentRelease.folder 'scripts/install-bunny-release.ps1') -InstallRoot $fixtureRoot -StartupDirectory $startup -Rollback -RollbackDirectory $rollback}catch{if($_.Exception.Message -notmatch 'quiescent'){throw};$refused=$true;$detail=$_.Exception.Message}
 if(-not $refused){throw 'Installed canonical rollback guard did not refuse active authority'}
 $after=Invoke-RestMethod ('http://127.0.0.1:'+$cfg.hostPort+'/health') -TimeoutSec 5
 if($health.instanceId -ne $after.instanceId -or (Get-FileHash -LiteralPath (Join-Path $root 'install.json')).Hash -ne $before -or (Get-FileHash -LiteralPath (Join-Path $fixtureRoot 'install.json')).Hash -ne $fixtureBefore){throw 'No-mutation rollback acceptance changed selection/Host'}
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED actual canonical production authority + disposable private selection fixture';installedTooling=$cfg.currentRelease;refusedBeforeMutation=$true;reason=$detail;productionConfigUnchanged=$true;fixtureConfigUnchanged=$true;hostInstanceUnchanged=$true;actualProductionRollbackPerformed=$false;privateFixture=$fixtureRoot} | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $PSScriptRoot 'production-rollback-guard.json') -Encoding utf8
} else {
 $before=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'restart-active-before.json') -Raw | ConvertFrom-Json
 if($health.instanceId -ne $before.health.instanceId) {throw 'Restart fixture Host identity changed unexpectedly'}
 # Native read-only authority census performed immediately before held Stop.
 & (Join-Path $cfg.currentRelease.folder 'runtime/node.exe') --experimental-strip-types (Join-Path $PSScriptRoot 'restart-census.ts')
 if($LASTEXITCODE -ne 0){throw 'Restart census failed; no Stop allowed'}
 $credential=Get-Content -LiteralPath (Join-Path $cfg.stateRoot 'credentials/credentials.json') -Raw | ConvertFrom-Json
 if($credential.pid -ne $health.pid -or $credential.instanceId -ne $health.instanceId){throw 'Current health/credential mismatch'}
 . (Join-Path $PSScriptRoot 'console-ownership.ps1')
 $held=Hold-R11Process 'host' $health.pid (Join-Path $cfg.currentRelease.folder 'runtime/node.exe') (Join-Path $cfg.currentRelease.folder 'Bunny-Host.mjs')
 $support=@()
 try {
  $support=@(Assert-R11Topology @($held))
  Assert-R11HeldIdentity $held (Get-CimInstance Win32_Process -Filter "ProcessId=$($held.pid)" -ErrorAction Stop)
  $held.process.Kill();if(-not $held.process.WaitForExit(10000)){throw 'Held production Host did not stop'}
  foreach($s in $support){if(-not $s.process.WaitForExit(10000)){throw 'Host console did not naturally exit'}}
  @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED authorized controlled Host restart';stoppedPid=$held.pid;creationTicks=$held.ticks;heldLifetimeStop=$true;supportNaturalExit=$true;otherRolesNotStopped=$true;fixtureMissionId=$before.missionId} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'restart-held-stop.json') -Encoding utf8
 } finally {foreach($s in $support){$s.process.Dispose()};$held.process.Dispose()}
 & (Join-Path $cfg.currentRelease.folder 'Start-Bunny-Release.ps1') -NoIsland -NoGateway -NoRemote
}
