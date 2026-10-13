# Controlled M-A-2 Gate T1 migration. This file is shipped in the pinned candidate release.
# It preserves the old directory. It never kills by executable name, port, or a broad command pattern.
param(
  [string]$InstallConfig=(Join-Path $env:LOCALAPPDATA 'Bunny-A\install.json'),
  [Parameter(Mandatory=$true)][string]$CandidateRelease,
  [Parameter(Mandatory=$true)][string]$ExpectedManifestSha256,
  [Parameter(Mandatory=$true)][string]$ExpectedSourceCommit,
  [switch]$ValidateOnly,
  [switch]$NoIsland,
  # Failure injection is accepted only in a test installation below the system temporary directory.
  [ValidateSet('','after-copy','after-config','after-host')][string]$TestFailAfter=''
)
$ErrorActionPreference='Stop'
$helper=Join-Path (Split-Path -Parent $PSScriptRoot) 'Bunny-State.ps1'
if(-not(Test-Path -LiteralPath $helper)) {$helper=Join-Path (Split-Path -Parent $PSScriptRoot) 'install\Bunny-State.ps1'}
. $helper
$config=Get-Content -LiteralPath $InstallConfig -Raw | ConvertFrom-Json
$install=Assert-BunnyDirectory $config.installRoot
$CandidateRelease=Assert-BunnyDirectory (Resolve-Path -LiteralPath $CandidateRelease).Path
$manifest=Get-Content -LiteralPath (Join-Path $CandidateRelease 'release-manifest.json') -Raw | ConvertFrom-Json
$identity=[ordered]@{name=$manifest.release;folder=$CandidateRelease;version=$manifest.version;sourceCommit=$ExpectedSourceCommit;toolingCommit=$manifest.toolingCommit;manifestSha256=$ExpectedManifestSha256}
[void](Assert-BunnyRelease $CandidateRelease $identity)
if($manifest.compatibility.stateLayoutVersion -ne 2 -or $manifest.compatibility.hostSchemaUserVersion -ne 3) {throw 'Candidate must support state layout 2 and Host schema 3.'}
if($TestFailAfter -and ($env:BUNNY_MIGRATION_TEST_MODE -ne '1' -or -not(Test-BunnyInside $install ([IO.Path]::GetTempPath())))) {throw 'Failure injection is restricted to disposable test installations.'}
$node=Join-Path $CandidateRelease 'runtime\node.exe'
$dbTool=Join-Path $CandidateRelease 'scripts\bunny-state-migration.mjs'
function Invoke-StateTool([string[]]$Arguments) {
  $output=& $node $dbTool @Arguments
  if($LASTEXITCODE -ne 0) {throw ('State verification failed: '+$Arguments[0])}
  ($output -join [Environment]::NewLine) | ConvertFrom-Json
}
if($config.schema -eq 'bunny-install/2') {
  $existing=Get-BunnyStatePaths $config
  Assert-BunnyTree $existing.root
  $verified=Invoke-StateTool @('inspect',$existing.database)
  return ([ordered]@{event='already-migrated';stateRoot=$existing.root;database=$existing.database;integrity=$verified.integrity;release=$config.currentRelease.name} | ConvertTo-Json)
}
if($config.schema -ne 'bunny-install/1') {throw 'Unknown install state. No migration was attempted.'}
$source=[IO.Path]::GetFullPath($config.dataDirectory)
$state=Assert-BunnyDirectory $config.stateRoot
if(-not(Test-BunnyInside $state $install) -or $state -ne (Join-Path $install 'state') -or (Test-BunnyInside $source $state)) {throw 'Unexpected legacy state locations.'}
$junction=Join-Path $state '.bunny-a'
$link=Get-Item -LiteralPath $junction -Force
if($link.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath(@($link.Target)[0]) -ne $source) {throw 'The legacy state junction does not point to the recorded data directory.'}
if(@(Get-ChildItem -LiteralPath $state -Force | Where-Object FullName -ne $junction).Count) {throw 'The target state root contains unknown data. No migration was attempted.'}
$oldRelease=Assert-BunnyDirectory $config.currentRelease.folder
[void](Assert-BunnyRelease $oldRelease $config.currentRelease)
$oldNode=Join-Path $oldRelease 'runtime\node.exe'
$credentialPath=Join-Path $source 'credentials.json'
$credentials=Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
$port=[int]$config.hostPort
function Get-ProcessRecord([int]$Id) {
  $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$Id) -ErrorAction SilentlyContinue
  if(-not $process) {return $null}
  [pscustomobject]@{id=$Id;parent=$process.ParentProcessId;executable=$process.ExecutablePath;commandLine=$process.CommandLine;startedAt=$process.CreationDate.ToUniversalTime().ToString('o')}
}
function Assert-Idle($Snapshot) {
  if(-not $Snapshot -or -not $Snapshot.PSObject.Properties['tasks'] -or -not $Snapshot.missions.config) {throw 'Host state is unknown. No migration was attempted.'}
  if(@($Snapshot.tasks | Where-Object {$_.state -notin @('completed','failed','stopped')}).Count -or @($Snapshot.missions.missions | Where-Object {$_.state -in @('ready','running','waiting_for_user','verifying')}).Count) {throw 'State migration refused: active tasks or Missions exist.'}
}
$health=Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 3
$hostRecord=Get-ProcessRecord ([int]$health.pid)
if($health.app -ne 'Bunny-A' -or $health.pid -ne $credentials.pid -or $health.instanceId -ne $credentials.instanceId -or $hostRecord.executable -ne $oldNode -or -not $hostRecord.commandLine.Contains((Join-Path $oldRelease 'Bunny-Host.mjs'))) {throw 'Production Host identity mismatch. No process was stopped.'}
$snapshot=Invoke-RestMethod "http://127.0.0.1:$port/state" -Headers @{Authorization=('Bearer '+$credentials.token)} -TimeoutSec 5
Assert-Idle $snapshot
$owned=New-Object System.Collections.ArrayList
$islandEntry=Join-Path $oldRelease 'Start-Bunny-Release.ps1'
foreach($process in Get-CimInstance Win32_Process -Filter "Name='powershell.exe'") {
  if($process.ExecutablePath -eq (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -and $process.CommandLine.Contains(('-File "'+$islandEntry+'"'))) {[void]$owned.Add((Get-ProcessRecord ([int]$process.ProcessId)))}
}
$hadIsland=$owned.Count -gt 0
$tunnelRecord=Join-Path $source 'tunnel-process.json'
if(Test-Path -LiteralPath $tunnelRecord) {
  $saved=Get-Content -LiteralPath $tunnelRecord -Raw | ConvertFrom-Json
  $worker=Get-ProcessRecord ([int]$saved.pid)
  $child=Get-ProcessRecord ([int]$saved.childPid)
  if($worker) {
    if($worker.executable -ne $oldNode -or -not $worker.commandLine.Contains((Join-Path $oldRelease 'scripts\bunny-tunnel.mjs'))) {throw 'Tunnel ownership is unknown. No process was stopped.'}
    if($child) {if($child.parent -ne $worker.id -or $child.executable -ne (Join-Path $source 'tools\cloudflared.exe')) {throw 'Cloudflare process ownership is unknown.'};[void]$owned.Add($child)}
    [void]$owned.Add($worker)
  } elseif($child -and $child.executable -eq (Join-Path $source 'tools\cloudflared.exe')) {throw 'An orphaned Cloudflare process needs ownership verification before migration.'}
}
$web=$null
if(Test-Path -LiteralPath (Join-Path $source 'deployment.json')) {try {$web=Invoke-RestMethod 'http://127.0.0.1:8084/bunny-health' -TimeoutSec 2} catch [System.Net.WebException] {}}
if($web) {
  $deployment=Get-Content -LiteralPath (Join-Path $source 'deployment.json') -Raw | ConvertFrom-Json
  [void](Assert-BunnyDirectory $deployment.packagePath)
  $gateway=Get-ProcessRecord ([int]$web.pid)
  if($web.root -ne $config.stateRoot -or $gateway.executable -ne $oldNode -or -not $gateway.commandLine.Contains((Join-Path $deployment.packagePath 'Bunny-Server.mjs'))) {throw 'Gateway ownership is unknown. No process was stopped.'}
  [void]$owned.Add($gateway)
}
[void]$owned.Add($hostRecord)
$preflight=[ordered]@{source=$source;target=$state;release=$identity;oldRelease=$config.currentRelease;host=$health;ownedProcesses=@($owned);tasks=$snapshot.tasks.Count;missionsEnabled=$snapshot.missions.config.enabled;triggersEnabled=$snapshot.missions.config.triggersEnabled;state=(Invoke-StateTool @('preflight',$source,$state))}
if($ValidateOnly) {return ($preflight | ConvertTo-Json -Depth 10)}
$stamp=(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$records=Join-Path $install ('backups\state-migration-'+$stamp)
$backup=Join-Path $records 'cutover'
$stage=Join-Path $install ('state-stage-'+$stamp)
$lockPath=Join-Path $install 'state-migration.lock'
$lock=[IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$stopped=$false;$switched=$false;$committed=$false;$newHost=$null;$newGateway=$null
function Close-MigrationLock {
  if($script:lock) {$script:lock.Dispose();$script:lock=$null;Remove-Item -LiteralPath $lockPath}
}
function Stop-Owned($Recorded) {
  $current=Get-ProcessRecord ([int]$Recorded.id)
  if(-not $current) {return}
  if($current.startedAt -ne $Recorded.startedAt -or $current.executable -ne $Recorded.executable -or $current.commandLine -ne $Recorded.commandLine) {throw "Process identity changed: $($Recorded.id). No process was stopped."}
  Stop-Process -Id $Recorded.id -ErrorAction Stop
  Wait-Process -Id $Recorded.id -Timeout 10 -ErrorAction SilentlyContinue
}
function Save-Phase([string]$Phase) {Write-BunnyJson (Join-Path $records 'transaction.json') ([ordered]@{phase=$Phase;at=(Get-Date).ToUniversalTime().ToString('o');source=$source;state=$state;backup=$backup;candidate=$identity})}
function Set-Shortcut([string]$Launcher,[string]$Folder) {
  $shell=New-Object -ComObject WScript.Shell;$shortcut=$shell.CreateShortcut($config.shortcut)
  $shortcut.TargetPath=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$Launcher+'"'
  $shortcut.WorkingDirectory=$Folder;$shortcut.WindowStyle=7;$shortcut.Description='Start the pinned Bunny-A installed release.';$shortcut.Save()
}
try {
  New-Item -ItemType Directory -Path $records -Force | Out-Null
  Write-BunnyJson (Join-Path $records 'preflight.json') $preflight
  Copy-Item -LiteralPath $InstallConfig -Destination (Join-Path $records 'install-before.json')
  if(Test-Path -LiteralPath $config.shortcut) {Copy-Item -LiteralPath $config.shortcut -Destination (Join-Path $records 'Bunny-A-before.lnk')}
  $onlineBackup=Invoke-StateTool @('snapshot',(Join-Path $source 'host.sqlite'),(Join-Path $records 'host-before-stop.sqlite'))
  Write-BunnyJson (Join-Path $records 'backup-before-stop.json') $onlineBackup
  Save-Phase 'verified-backup'
  Assert-Idle (Invoke-RestMethod "http://127.0.0.1:$port/state" -Headers @{Authorization=('Bearer '+$credentials.token)} -TimeoutSec 5)
  $stopped=$true
  foreach($process in $owned) {Stop-Owned $process}
  Save-Phase 'owned-processes-stopped'
  $request=Join-Path $records 'prepare.json'
  Write-BunnyJson $request ([ordered]@{source=$source;target=$state;stage=$stage;backup=$backup})
  $migration=Invoke-StateTool @('prepare',$request)
  Save-Phase 'verified-stage'
  if($TestFailAfter -eq 'after-copy') {throw 'Test failure after copy.'}
  # Verify that no writer reappeared in the source while the copy was in progress.
  $sourceCheck=Invoke-StateTool @('compare',(Join-Path $source 'host.sqlite'),(Join-Path $backup 'host.sqlite'))
  if(-not $sourceCheck.ok) {throw 'The source changed after shutdown. No state was switched.'}
  $toolPath=Join-Path $stage 'cloudflared\cloudflared.exe'
  if(Test-Path -LiteralPath $toolPath) {
    $version=& $toolPath --version
    if($LASTEXITCODE -ne 0) {throw 'Copied Cloudflare client version check failed.'}
    $toolRecord=Get-Content -LiteralPath (Join-Path $stage 'cloudflared\tool.json') -Raw | ConvertFrom-Json
    $toolRecord | Add-Member NoteProperty version ($version -join ' ') -Force
    Write-BunnyJson (Join-Path $stage 'cloudflared\tool.json') $toolRecord
  }
  # Delete only the verified junction itself. The source data and its verified backup stay intact.
  $currentLink=Get-Item -LiteralPath $junction -Force
  if($currentLink.LinkType -ne 'Junction' -or [IO.Path]::GetFullPath(@($currentLink.Target)[0]) -ne $source) {throw 'Legacy state junction changed during migration.'}
  [IO.Directory]::Delete($junction)
  [IO.Directory]::Delete($state)
  if(-not(Test-BunnyInside (Resolve-Path -LiteralPath $stage).Path $install) -or $stage -eq $install) {throw 'State stage escaped the application directory.'}
  Move-Item -LiteralPath $stage -Destination $state
  $switched=$true
  $next=[ordered]@{schema='bunny-install/2';stateLayoutVersion=2;installedAt=(Get-Date).ToUniversalTime().ToString('o');installRoot=$install;stateRoot=$state;dataDirectory=$state;dataDirectoryInsideGitCheckout=$null;workspace=$config.workspace;hostPort=$port;shortcut=$config.shortcut;currentRelease=$identity;previousReleases=@($config.previousReleases)+@($config.currentRelease);stateMigration=$records;rollbackDirectory=$records;tools=[ordered]@{cloudflared=$migration.tool}}
  Write-BunnyJson $InstallConfig $next
  Set-Shortcut (Join-Path $CandidateRelease 'Start-Bunny-Release.ps1') $CandidateRelease
  Save-Phase 'configuration-switched'
  if($TestFailAfter -eq 'after-config') {throw 'Test failure after configuration switch.'}
  Close-MigrationLock
  & (Join-Path $CandidateRelease 'Start-Bunny-Release.ps1') -InstallConfig $InstallConfig -NoIsland -NoRemote
  $newHealth=Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 3
  $newHost=Get-ProcessRecord ([int]$newHealth.pid)
  if($web) {$newWeb=Invoke-RestMethod 'http://127.0.0.1:8084/bunny-health' -TimeoutSec 3;$newGateway=Get-ProcessRecord ([int]$newWeb.pid)}
  if($TestFailAfter -eq 'after-host') {throw 'Test failure after Host restart.'}
  $options=Join-Path $records 'preservation-options.json'
  Write-BunnyJson $options ([ordered]@{rebases=@($migration.rebases);live=$true})
  $preserved=Invoke-StateTool @('compare',(Join-Path $backup 'host.sqlite'),(Join-Path $state 'host.sqlite'),$options)
  if(-not $preserved.ok) {throw 'Restarted Host failed row-preservation verification.'}
  $newCredentials=Get-Content -LiteralPath (Join-Path $state 'credentials\credentials.json') -Raw | ConvertFrom-Json
  if($newCredentials.token -ne $credentials.token) {throw 'Host credential changed during migration.'}
  $newSnapshot=Invoke-RestMethod "http://127.0.0.1:$port/state" -Headers @{Authorization=('Bearer '+$credentials.token)} -TimeoutSec 5
  if($newSnapshot.missions.config.enabled -ne $snapshot.missions.config.enabled -or $newSnapshot.missions.config.triggersEnabled -ne $snapshot.missions.config.triggersEnabled) {throw 'Mission feature flags changed during migration.'}
  Assert-BunnyTree $state
  Write-BunnyJson (Join-Path $records 'preservation-live.json') $preserved
  $retired=[ordered]@{schema='bunny-retired-state/1';retiredAt=(Get-Date).ToUniversalTime().ToString('o');canonicalState=$state;backup=$records;note='Production state moved outside Git. Use separate development state.'}
  $retiredOriginal=Join-Path $records 'retired-original-state'
  # The exact source recorded at preflight is moved only after live verification. Retain it outside Git.
  if((Resolve-Path -LiteralPath $source).Path -ne $source -or -not(Test-BunnyInside $retiredOriginal $records) -or $retiredOriginal -eq $records -or (Test-Path -LiteralPath $retiredOriginal)) {throw 'Retired state move failed its path checks.'}
  Move-Item -LiteralPath $source -Destination $retiredOriginal
  New-Item -ItemType Directory -Path $source | Out-Null
  Write-BunnyJson (Join-Path $source 'state-retired.json') $retired
  Write-BunnyJson (Join-Path $records 'install-after.json') $next
  @"
# Bunny state migration recovery

Canonical state: $state
Verified database snapshot: $backup\host.sqlite
Complete state copy: $backup\original-state
Original directory retained: $retiredOriginal
Pinned prior release: $oldRelease
Pinned candidate: $CandidateRelease
Database schema: 3

Do not restore the old repository junction.
Do not use an older repo-bound shortcut.

The controller tests restore a copy under the application backup directory after a failed cutover.
The recovery Host uses the pinned prior release. The recovery database and project paths stay outside Git.
See transaction.json for the completed phase. See recovery-rebases.json if recovery ran.

For a later database restore, first stop only verified Bunny processes with no active work.
Make a new SQLite VACUUM INTO backup with the installed scripts\bunny-state-migration.mjs tool.
Check the restore snapshot with its inspect command. Check all rows with its compare command.
Restore host.sqlite with Host stopped. Remove only its old WAL/SHM siblings before opening the restored database.
Keep state-layout.json with the matching schema fingerprint. Keep credentials, settings and device records.
Start $CandidateRelease\Start-Bunny-Release.ps1 with -NoRemote for local verification.

T8 must verify a later release rollback separately. This T1 record does not claim T8 acceptance.
"@ | Set-Content -LiteralPath (Join-Path $records 'RECOVERY.md') -Encoding utf8
  $committed=$true
  Save-Phase 'committed'
  if($hadIsland -and -not $NoIsland) {Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"'+(Join-Path $CandidateRelease 'Start-Bunny-Release.ps1')+'"'),'-NoRemote') -WorkingDirectory $CandidateRelease -WindowStyle Hidden | Out-Null}
  [ordered]@{event='migration-complete';release=$identity;host=$newHealth;stateRoot=$state;database=(Join-Path $state 'host.sqlite');backup=$records;oldStateRetained=$retiredOriginal;repositoryMarker=$source;preservation=$preserved;remoteAcceptance='NOT TESTED'} | ConvertTo-Json -Depth 10
} catch {
  $failure=$_.Exception.Message
  Close-MigrationLock
  if($stopped -and -not $committed) {
    if($switched -and -not $newHost) {
      # A launcher can fail after starting Host. Recover only a Host proven by the new credential file.
      try {
        $candidateHealth=Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2
        $candidateCredentials=Get-Content -LiteralPath (Join-Path $state 'credentials\credentials.json') -Raw | ConvertFrom-Json
        $candidateProcess=Get-ProcessRecord ([int]$candidateHealth.pid)
        if($candidateHealth.instanceId -eq $candidateCredentials.instanceId -and $candidateCredentials.pid -eq $candidateHealth.pid -and $candidateProcess.executable -eq $node -and $candidateProcess.commandLine.Contains((Join-Path $CandidateRelease 'Bunny-Host.mjs'))) {$newHost=$candidateProcess}
      } catch {}
    }
    if($switched -and -not $newGateway -and $web) {
      try {$candidateWeb=Invoke-RestMethod 'http://127.0.0.1:8084/bunny-health' -TimeoutSec 2;$candidateProcess=Get-ProcessRecord ([int]$candidateWeb.pid);if($candidateWeb.root -eq $state -and $candidateProcess.executable -eq $node -and $candidateProcess.commandLine.Contains((Join-Path $deployment.packagePath 'Bunny-Server.mjs'))) {$newGateway=$candidateProcess}} catch {}
    }
    if($newGateway) {Stop-Owned $newGateway}
    if($newHost) {Stop-Owned $newHost}
    # Recovery uses a new copy of the saved legacy layout outside Git. It never restores the repo junction.
    $recovery=Join-Path $records 'recovery';$recoveryData=Join-Path $recovery 'data';$recoveryState=Join-Path $recovery 'state'
    New-Item -ItemType Directory -Path $recoveryState -Force | Out-Null
    $recoverySource=if(Test-Path -LiteralPath (Join-Path $backup 'original-state\host.sqlite')) {Join-Path $backup 'original-state'} else {$source}
    [void](Assert-BunnyDirectory $recoveryData)
    Copy-Item -LiteralPath $recoverySource -Destination $recoveryData -Recurse
    Get-ChildItem -LiteralPath $recoveryData -Recurse -File -Force | ForEach-Object {$_.IsReadOnly=$false}
    [void](Invoke-StateTool @('inspect',(Join-Path $recoveryData 'host.sqlite')))
    $recoveryRebases=Invoke-StateTool @('rebase',(Join-Path $recoveryData 'host.sqlite'),$source,$recoveryData)
    $recoveryOptions=Join-Path $records 'recovery-rebases.json'
    Write-BunnyJson $recoveryOptions $recoveryRebases
    [void](Invoke-StateTool @('compare',(Join-Path $recoverySource 'host.sqlite'),(Join-Path $recoveryData 'host.sqlite'),$recoveryOptions))
    New-Item -ItemType Junction -Path (Join-Path $recoveryState '.bunny-a') -Target $recoveryData | Out-Null
    $config.stateRoot=$recoveryState;$config.dataDirectory=$recoveryData;$config.dataDirectoryInsideGitCheckout=$null
    Write-BunnyJson $InstallConfig $config
    if(Test-Path -LiteralPath (Join-Path $records 'Bunny-A-before.lnk')) {Copy-Item -LiteralPath (Join-Path $records 'Bunny-A-before.lnk') -Destination $config.shortcut -Force}
    Remove-Item Env:BUNNY_STATE_LAYOUT,Env:BUNNY_HOST_CREDENTIALS_FILE -ErrorAction SilentlyContinue
    & (Join-Path $oldRelease 'Start-Bunny-Release.ps1') -InstallConfig $InstallConfig -NoIsland -NoRemote
    Save-Phase 'rolled-back-to-pinned-external-recovery'
  }
  throw ("Bunny state migration failed: "+$failure+". Recovery evidence: "+$records)
} finally {Close-MigrationLock}
