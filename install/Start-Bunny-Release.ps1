# Bunny-A pinned release launcher (M-A-1D). The Windows logon shortcut runs this file from an installed,
# versioned release folder. Every program it starts comes from this folder, except the dashboard gateway
# package named in deployment.json; Host state and the default task workspace come from install.json.
# Nothing here resolves a path from a development checkout, so a branch switch or an uncommitted edit there
# cannot change what runs at the next logon.
param([string]$InstallConfig,[switch]$NoIsland,[switch]$NoGateway,[switch]$NoRemote)
$ErrorActionPreference='Stop'
$release=$PSScriptRoot
if(-not $InstallConfig) {$InstallConfig=Join-Path (Split-Path -Parent (Split-Path -Parent $release)) 'install.json'}
$config=Get-Content -LiteralPath $InstallConfig -Raw | ConvertFrom-Json
$manifest=Get-Content -LiteralPath (Join-Path $release 'release-manifest.json') -Raw | ConvertFrom-Json
$state=$config.stateRoot
$data=Join-Path $state '.bunny-a'
$workspace=$config.workspace
$port=if($config.hostPort) {[int]$config.hostPort} else {43119}
$node=Join-Path $release 'runtime\node.exe'
$launchLog=Join-Path $data 'release-launch.log'
function Write-Launch([hashtable]$Fields) {
  $entry=[ordered]@{at=(Get-Date).ToUniversalTime().ToString('o');release=$manifest.release;sourceCommit=$manifest.sourceCommit;launcherPid=$PID}
  foreach($key in $Fields.Keys) {$entry[$key]=$Fields[$key]}
  try {Add-Content -LiteralPath $launchLog -Value ($entry | ConvertTo-Json -Compress) -Encoding utf8} catch {}
}
function Test-ReleaseProcess($Process,[string]$Entry) {
  $Process -and $Process.ExecutablePath -eq $node -and $Process.CommandLine.Contains((Join-Path $release $Entry))
}
foreach($folder in @($state,$data,$workspace)) {if(-not(Test-Path -LiteralPath $folder -PathType Container)) {throw "Configured Bunny-A folder is missing: $folder"}}
# A changed or missing Host, launcher or runtime file stops the launch: the release folder is a deployment
# artifact, not a workspace. (Bunny-Release-Info.ps1 also checks the dashboard build output.)
foreach($file in @($manifest.files | Where-Object {$_.origin -in @('source','tooling','runtime')})) {
  $path=Join-Path $release $file.path
  if(-not(Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256.ToUpperInvariant()) {
    Write-Launch @{event='integrity.failed';file=$file.path}
    throw "Bunny-A release file changed or missing: $($file.path). Nothing was started."
  }
}

$env:BUNNY_HOST_DATA_DIRECTORY=$data
$env:BUNNY_HOST_PORT=[string]$port
$credentialsPath=Join-Path $data 'credentials.json'
$health=$null
try {$health=Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2} catch [System.Net.WebException] {}
if($health) {
  $saved=if(Test-Path -LiteralPath $credentialsPath) {Get-Content -LiteralPath $credentialsPath -Raw | ConvertFrom-Json} else {$null}
  if($health.app -ne 'Bunny-A' -or -not $saved -or $saved.instanceId -ne $health.instanceId) {throw 'Another service holds the Bunny-A Host address. Nothing was replaced.'}
  $running=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$health.pid)
  Write-Launch @{event='host.already-running';hostPid=$health.pid;fromThisRelease=[bool](Test-ReleaseProcess $running 'Bunny-Host.mjs');executable=$running.ExecutablePath}
} else {
  # The Host's working directory is its default task folder: the separate workspace, never this release.
  $hostProcess=Start-Process -FilePath $node -ArgumentList @('--experimental-strip-types',('"'+(Join-Path $release 'Bunny-Host.mjs')+'"')) -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'host.log') -RedirectStandardError (Join-Path $data 'host-error.log') -PassThru
  for($attempt=0;$attempt -lt 120;$attempt++) {
    try {$health=Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 1;if($health.app -eq 'Bunny-A') {break}} catch {$health=$null}
    if($hostProcess.HasExited) {Write-Launch @{event='host.exited';hostPid=$hostProcess.Id};throw 'Bunny-A Host stopped. See host-error.log in the Bunny-A data folder.'}
    Start-Sleep -Milliseconds 250
  }
  if(-not $health) {Write-Launch @{event='host.unreachable';hostPid=$hostProcess.Id};throw 'Bunny-A Host did not become reachable.'}
  Write-Launch @{event='host.started';hostPid=$hostProcess.Id;workspace=$workspace;dataDirectory=$data}
}

$deploymentPath=Join-Path $data 'deployment.json'
$gatewayReady=$false
if(-not $NoGateway -and (Test-Path -LiteralPath $deploymentPath)) {
  try {
    $package=(Get-Content -LiteralPath $deploymentPath -Raw | ConvertFrom-Json).packagePath
    $server=Join-Path $package 'Bunny-Server.mjs'
    if(-not(Test-Path -LiteralPath $server)) {throw "Production Bunny-A gateway package missing: $package"}
    for($folder=Get-Item -LiteralPath $package;$folder;$folder=$folder.Parent) {if(Test-Path -LiteralPath (Join-Path $folder.FullName '.git')) {throw "Gateway package is inside a Git checkout ($($folder.FullName)); install it with install-bunny-release.ps1."}}
    $env:BUNNY_REMOTE_CONFIG=Join-Path $data 'remote.json'
    $web=$null
    try {$web=Invoke-RestMethod 'http://127.0.0.1:8084/bunny-health' -TimeoutSec 2} catch [System.Net.WebException] {}
    if($web -and $web.root -ne $state) {throw 'Another dashboard owns the address. Nothing was replaced.'}
    if(-not $web) {
      $gateway=Start-Process -FilePath $node -ArgumentList ('"'+$server+'"') -WorkingDirectory $state -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'gateway.log') -RedirectStandardError (Join-Path $data 'gateway-error.log') -PassThru
      Write-Launch @{event='gateway.started';gatewayPid=$gateway.Id;package=$package}
    } else {Write-Launch @{event='gateway.already-running';gatewayPid=$web.pid}}
    $gatewayReady=$true
  } catch {Write-Launch @{event='gateway.refused';reason=$_.Exception.Message}}
}

$consentPath=Join-Path $data 'remote-consent.json'
if(-not $NoRemote -and (Test-Path -LiteralPath $consentPath)) {
  try {
    $consent=Get-Content -LiteralPath $consentPath -Raw | ConvertFrom-Json
    if(-not $consent.enabled -or $consent.provider -ne 'Cloudflare') {throw 'Cloudflare connection is disabled.'}
    if(-not $gatewayReady) {throw 'The remote connection needs the dashboard gateway.'}
    $record=Join-Path $data 'tunnel-process.json'
    $worker=$null
    if(Test-Path -LiteralPath $record) {
      $saved=Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
      $worker=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$saved.pid) -ErrorAction SilentlyContinue
      if($worker -and -not($worker.Name -eq 'node.exe' -and $worker.CommandLine -match 'bunny-tunnel\.mjs')) {$worker=$null}
    }
    if($worker) {Write-Launch @{event='remote.already-running';tunnelPid=$worker.ProcessId;fromThisRelease=[bool](Test-ReleaseProcess $worker 'scripts\bunny-tunnel.mjs')}}
    else {
      if(-not(Test-Path -LiteralPath (Join-Path $data 'tools/cloudflared.exe'))) {throw 'Verified Cloudflare client is not installed.'}
      $env:BUNNY_ROOT=$state
      $tunnel=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $release 'scripts\bunny-tunnel.mjs')+'"') -WorkingDirectory $state -WindowStyle Hidden -RedirectStandardOutput (Join-Path $data 'tunnel.log') -RedirectStandardError (Join-Path $data 'tunnel-error.log') -PassThru
      Write-Launch @{event='remote.started';tunnelPid=$tunnel.Id}
    }
  } catch {Write-Launch @{event='remote.skipped';reason=$_.Exception.Message}}
}

if($NoIsland) {return}
# A per-user named mutex prevents duplicate islands; closing never stops Host.
$created=$false
$mutex=[Threading.Mutex]::new($true,'Local\Bunny-A-Island',[ref]$created)
if(-not $created) {$mutex.Dispose();Write-Launch @{event='island.already-running'};return}
Write-Launch @{event='island.started'}
try {& (Join-Path $release 'Bunny-Island.ps1') -Root $state}
finally {$mutex.ReleaseMutex();$mutex.Dispose()}
