# The installed launcher reads only installed code, application state and the separate default workspace.
param([string]$InstallConfig,[switch]$NoIsland,[switch]$NoGateway,[switch]$NoRemote,[switch]$Dashboard)
$ErrorActionPreference='Stop'
$release=$PSScriptRoot
if(-not $InstallConfig) {$InstallConfig=Join-Path (Split-Path -Parent (Split-Path -Parent $release)) 'install.json'}
$config=Get-Content -LiteralPath $InstallConfig -Raw | ConvertFrom-Json
# Check the shared helper before executing it. install.json anchors the complete manifest.
$manifestPath=Join-Path $release 'release-manifest.json'
if(-not $config.currentRelease.manifestSha256 -or (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ne $config.currentRelease.manifestSha256.ToUpperInvariant()) {throw 'Installed release manifest does not match install.json. Nothing was started.'}
$bootstrap=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$helper=@($bootstrap.files | Where-Object {$_.path -eq 'Bunny-State.ps1'})
if($helper.Count -ne 1 -or (Get-FileHash -LiteralPath (Join-Path $release 'Bunny-State.ps1') -Algorithm SHA256).Hash -ne $helper[0].sha256.ToUpperInvariant()) {throw 'Installed state helper changed or missing. Nothing was started.'}
. (Join-Path $release 'Bunny-State.ps1')
$paths=Get-BunnyStatePaths $config
$state=$paths.root
$workspace=Assert-BunnyDirectory $config.workspace
$port=if($config.hostPort) {[int]$config.hostPort} else {43119}
if(Test-Path -LiteralPath (Join-Path (Split-Path -Parent $InstallConfig) 'state-migration.lock')) {throw 'Bunny state migration is in progress. Startup was refused.'}
foreach($folder in @($state,$workspace,$paths.logs)) {if(-not(Test-Path -LiteralPath $folder -PathType Container)) {throw "Configured Bunny-A folder is missing: $folder"}}
Assert-BunnyTree $state
if(-not(Test-Path -LiteralPath $paths.database) -or -not(Test-Path -LiteralPath $paths.marker)) {throw 'Installed Bunny state is missing. Restore a verified backup; a new database was not created.'}
$layout=Get-Content -LiteralPath $paths.marker -Raw | ConvertFrom-Json
if($layout.schema -ne 'bunny-state/2' -or $layout.stateRoot -ne $state) {throw 'Installed Bunny state layout does not match install.json.'}
$manifest=Assert-BunnyRelease $release $config.currentRelease
if($manifest.compatibility.stateLayoutVersion -ne 2) {throw 'This release does not support installed state layout 2.'}
$node=Join-Path $release 'runtime\node.exe'
$launchLog=Join-Path $paths.logs 'release-launch.log'
function Write-Launch([hashtable]$Fields) {
  $entry=[ordered]@{at=(Get-Date).ToUniversalTime().ToString('o');release=$manifest.release;sourceCommit=$manifest.sourceCommit;launcherPid=$PID}
  foreach($key in $Fields.Keys) {$entry[$key]=$Fields[$key]}
  Add-Content -LiteralPath $launchLog -Value ($entry | ConvertTo-Json -Compress) -Encoding utf8
}
function Test-ReleaseProcess($Process,[string]$Entry) {
  $Process -and $Process.ExecutablePath -eq $node -and $Process.CommandLine.Contains((Join-Path $release $Entry))
}
function Get-Health([string]$Url) {try {Invoke-RestMethod $Url -TimeoutSec 2} catch [System.Net.WebException] {$null}}
function Save-PreviousLogs([string]$Name) {
  $archive=Join-Path $paths.logs 'archive'
  foreach($suffix in @('.log','-error.log')) {
    $log=Join-Path $paths.logs ($Name+$suffix)
    if(Test-Path -LiteralPath $log) {
      New-Item -ItemType Directory -Path $archive -Force | Out-Null
      Move-Item -LiteralPath $log -Destination (Join-Path $archive ((Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)+'-'+$Name+$suffix))
    }
  }
}
Set-BunnyStateEnvironment $paths $port
$env:BUNNY_HOST_WORKSPACE=$workspace
if($config.tools.cloudflared.sha256) {$env:BUNNY_CLOUDFLARED_SHA256=$config.tools.cloudflared.sha256}
$health=Get-Health "http://127.0.0.1:$port/health"
if($health) {
  $saved=if(Test-Path -LiteralPath $paths.credentials) {Get-Content -LiteralPath $paths.credentials -Raw | ConvertFrom-Json} else {$null}
  $running=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$health.pid)
  if($health.app -ne 'Bunny-A' -or -not $saved -or $saved.instanceId -ne $health.instanceId -or $saved.pid -ne $health.pid -or -not(Test-ReleaseProcess $running 'Bunny-Host.mjs')) {throw 'Host identity or installed runtime collision. Nothing was replaced.'}
  Write-Launch @{event='host.already-running';hostPid=$health.pid;fromThisRelease=$true;executable=$running.ExecutablePath}
} else {
  Save-PreviousLogs 'host'
  $hostProcess=Start-Process -FilePath $node -ArgumentList @('--experimental-strip-types',('"'+(Join-Path $release 'Bunny-Host.mjs')+'"')) -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput (Join-Path $paths.logs 'host.log') -RedirectStandardError (Join-Path $paths.logs 'host-error.log') -PassThru
  for($attempt=0;$attempt -lt 120;$attempt++) {
    $health=Get-Health "http://127.0.0.1:$port/health"
    if($health -and $health.app -eq 'Bunny-A' -and $health.pid -eq $hostProcess.Id) {break}
    if($hostProcess.HasExited) {throw 'Bunny-A Host stopped. See the installed host-error.log.'}
    Start-Sleep -Milliseconds 250
  }
  if(-not $health -or $health.pid -ne $hostProcess.Id) {throw 'Bunny-A Host did not become reachable from the installed runtime.'}
  Write-Launch @{event='host.started';hostPid=$hostProcess.Id;workspace=$workspace;dataDirectory=$state}
}
$gatewayReady=$false
if(-not $NoGateway -and (Test-Path -LiteralPath $paths.deployment)) {
  $package=(Get-Content -LiteralPath $paths.deployment -Raw | ConvertFrom-Json).packagePath
  [void](Assert-BunnyDirectory $package)
  Assert-BunnyTree $package
  $server=Join-Path $package 'Bunny-Server.mjs'
  if(-not(Test-Path -LiteralPath $server)) {throw "Production Bunny-A gateway package missing: $package"}
  $web=Get-Health 'http://127.0.0.1:8084/bunny-health'
  if($web) {
    $running=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$web.pid)
    if($web.root -ne $state -or $running.ExecutablePath -ne $node -or -not $running.CommandLine.Contains($server)) {throw 'Dashboard identity or installed runtime collision. Nothing was replaced.'}
    Write-Launch @{event='gateway.already-running';gatewayPid=$web.pid}
  } else {
    Save-PreviousLogs 'gateway'
    # The preserved v10 bridge reads credentials.json below BUNNY_HOST_DATA_DIRECTORY. The new bridge
    # also honors BUNNY_HOST_CREDENTIALS_FILE. Both receive the same installed credential file.
    $env:BUNNY_HOST_DATA_DIRECTORY=Split-Path -Parent $paths.credentials
    try {$gateway=Start-Process -FilePath $node -ArgumentList ('"'+$server+'"') -WorkingDirectory $state -WindowStyle Hidden -RedirectStandardOutput (Join-Path $paths.logs 'gateway.log') -RedirectStandardError (Join-Path $paths.logs 'gateway-error.log') -PassThru}
    finally {$env:BUNNY_HOST_DATA_DIRECTORY=$state}
    for($attempt=0;$attempt -lt 120;$attempt++) {
      $web=Get-Health 'http://127.0.0.1:8084/bunny-health'
      if($web -and $web.root -eq $state -and $web.pid -eq $gateway.Id) {break}
      if($gateway.HasExited) {throw 'Installed Bunny-A gateway stopped.'}
      Start-Sleep -Milliseconds 250
    }
    if(-not $web -or $web.pid -ne $gateway.Id) {throw 'Installed Bunny-A gateway did not become ready.'}
    Write-Launch @{event='gateway.started';gatewayPid=$gateway.Id;package=$package}
  }
  $gatewayReady=$true
}
if(-not $NoRemote -and (Test-Path -LiteralPath $paths.consent)) {
  try {
    $consent=Get-Content -LiteralPath $paths.consent -Raw | ConvertFrom-Json
    if(-not $consent.enabled -or $consent.provider -ne 'Cloudflare') {throw 'Cloudflare connection is disabled.'}
    if(-not $gatewayReady) {throw 'The remote connection needs the dashboard gateway.'}
    if(-not $env:BUNNY_CLOUDFLARED_SHA256 -or -not(Test-Path -LiteralPath $paths.cloudflared) -or (Get-FileHash -LiteralPath $paths.cloudflared -Algorithm SHA256).Hash -ne $env:BUNNY_CLOUDFLARED_SHA256.ToUpperInvariant()) {throw 'Installed Cloudflare client is missing or changed.'}
    $worker=$null
    if(Test-Path -LiteralPath $paths.tunnelProcess) {
      $saved=Get-Content -LiteralPath $paths.tunnelProcess -Raw | ConvertFrom-Json
      $worker=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$saved.pid) -ErrorAction SilentlyContinue
      if($worker -and (-not(Test-ReleaseProcess $worker 'scripts\bunny-tunnel.mjs') -or $saved.root -ne $state -or -not $saved.startedAt -or $saved.startedAt -ne $worker.CreationDate.ToUniversalTime().ToString('o'))) {throw 'Tunnel process identity collision. No process was replaced.'}
    }
    if($worker) {Write-Launch @{event='remote.already-running';tunnelPid=$worker.ProcessId;fromThisRelease=$true}}
    else {
      Save-PreviousLogs 'tunnel'
      $tunnel=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $release 'scripts\bunny-tunnel.mjs')+'"') -WorkingDirectory $state -WindowStyle Hidden -RedirectStandardOutput (Join-Path $paths.logs 'tunnel.log') -RedirectStandardError (Join-Path $paths.logs 'tunnel-error.log') -PassThru
      Write-Launch @{event='remote.started';tunnelPid=$tunnel.Id}
    }
  } catch {Write-Launch @{event='remote.skipped';reason=$_.Exception.Message}}
}
if($Dashboard -and $gatewayReady) {Start-Process 'http://127.0.0.1:8084/'}
if($NoIsland) {return}
$created=$false
$mutex=[Threading.Mutex]::new($true,'Local\Bunny-A-Island',[ref]$created)
if(-not $created) {$mutex.Dispose();Write-Launch @{event='island.already-running'};return}
Write-Launch @{event='island.started'}
try {& (Join-Path $release 'Bunny-Island.ps1') -Root $state -CredentialPath $paths.credentials -DeploymentPath $paths.deployment -PreferencePath $paths.preferences -ScreenshotDirectory (Join-Path $state 'runtime\screenshots')}
finally {$mutex.ReleaseMutex();$mutex.Dispose()}
