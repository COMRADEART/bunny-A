$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
foreach($name in @('BUNNY_MISSIONS','BUNNY_TRIGGERS','BUNNY_HOST_DATA_DIRECTORY','BUNNY_HOST_CREDENTIALS_FILE','BUNNY_HOST_WORKSPACE','BUNNY_HOST_PORT','BUNNY_STATE_LAYOUT','DATABASE_URL')) {Remove-Item -LiteralPath ('Env:'+ $name) -ErrorAction SilentlyContinue}
$root=Join-Path $env:LOCALAPPDATA 'Bunny-A'
$cfg=Get-Content -LiteralPath (Join-Path $root 'install.json') -Raw | ConvertFrom-Json
$auth=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'authorization.json') -Raw | ConvertFrom-Json
if($cfg.currentRelease.manifestSha256 -ne $auth.candidate.manifestSha256 -or (Test-Path -LiteralPath (Join-Path $root 'state-migration.lock'))) {throw 'Boot selection or operation lock mismatch'}
$app=Start-Process -FilePath (Join-Path $root 'Bunny-A.exe') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'native-bootstrap-output.log') -RedirectStandardError (Join-Path $PSScriptRoot 'native-bootstrap-error.log') -PassThru
$applicationPath=Join-Path $cfg.stateRoot 'runtime/windows-application.json'
$ready=$false
for($i=0;$i -lt 120;$i++) {
 try {$health=Invoke-RestMethod ('http://127.0.0.1:'+$cfg.hostPort+'/health') -TimeoutSec 2;$web=Invoke-RestMethod http://127.0.0.1:8084/bunny-health -TimeoutSec 2;$application=Get-Content -LiteralPath $applicationPath -Raw | ConvertFrom-Json;if($health.operationalState -eq 'healthy' -and $web.release.manifestSha256 -eq $auth.candidate.manifestSha256 -and $application.pid -eq $app.Id -and $application.manifestSha256 -eq $auth.candidate.manifestSha256 -and $application.loaded){$ready=$true;break}}catch{}
 if($app.HasExited){throw 'Installed native application exited before readiness'}
 Start-Sleep -Milliseconds 500
}
if(-not $ready){throw 'Production native application/Host/gateway readiness failed'}
& (Join-Path $cfg.currentRelease.folder 'Start-Bunny-Release.ps1') -NoIsland
$tunnelPath=Join-Path $cfg.stateRoot 'runtime/tunnel-process.json'
$remoteReady=$false
for($i=0;$i -lt 120;$i++) {
 try {$tunnel=Get-Content -LiteralPath $tunnelPath -Raw | ConvertFrom-Json;$worker=Get-CimInstance Win32_Process -Filter "ProcessId=$($tunnel.pid)" -ErrorAction Stop;$cloud=Get-CimInstance Win32_Process -Filter "ProcessId=$($tunnel.childPid)" -ErrorAction Stop;$remote=Get-Content -LiteralPath (Join-Path $cfg.stateRoot 'settings/remote.json') -Raw | ConvertFrom-Json;if($worker -and $cloud -and $worker.CommandLine.Contains((Join-Path $cfg.currentRelease.folder 'scripts/bunny-tunnel.mjs')) -and $worker.CreationDate.ToUniversalTime().ToString('o') -eq $tunnel.startedAt -and $cloud.ParentProcessId -eq $worker.ProcessId -and $remote.tunnelPid -eq $worker.ProcessId -and $remote.url.StartsWith('https://')){$remoteReady=$true;break}}catch{}
 Start-Sleep -Milliseconds 500
}
if(-not $remoteReady){throw 'Production remote transport did not become ready'}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED';appPid=$app.Id;application=$application;health=$health;gateway=$web;tunnel=$tunnel;remote=$remote;release=$cfg.currentRelease;sharedNativeBootstrap=$true;onlyInstalledLaunchersUsed=$true} | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $PSScriptRoot 'boot.json') -Encoding utf8
Write-Output 'Installed v26 native application, Host, gateway and remote transport are ready.'
