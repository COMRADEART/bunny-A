$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$health=Invoke-RestMethod http://127.0.0.1:43119/health -TimeoutSec 5
$before=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'restart-active-before.json') -Raw|ConvertFrom-Json
if($health.instanceId -eq $before.health.instanceId -or $health.operationalState -ne 'healthy'){throw 'Healthy restarted Host required'}
$root=Join-Path $env:LOCALAPPDATA 'Bunny-A'
$started=Get-Content -LiteralPath (Join-Path $root 'state/logs/release-launch.log') | ForEach-Object {$_|ConvertFrom-Json} | Where-Object {$_.event -eq 'host.started' -and $_.hostPid -eq $health.pid} | Select-Object -Last 1
if(-not $started -or (Get-CimInstance Win32_Process -Filter "ProcessId=$($started.launcherPid)")){throw 'Installed launcher completion not proven'}
$candidates=@(Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object {$_.ExecutablePath -eq 'C:\Users\allam\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe' -and $_.CommandLine.Contains('guard-and-restart.ps1 -Phase restart *>') -and $_.CommandLine.Contains('restart-stage.ts verify *>') -and $_.CommandLine.Contains('policy-on-for-restart.log')})
if($candidates.Count -ne 1){throw 'Unique authored pending outer harness required'}
$current=$candidates[0];$process=[Diagnostics.Process]::GetProcessById($current.ProcessId)
try {
 $null=$process.Handle;$ticks=$process.StartTime.ToUniversalTime().Ticks
 $now=Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ProcessId)" -ErrorAction Stop
 if(($ticks-($ticks%10)) -ne $now.CreationDate.ToUniversalTime().Ticks -or $process.MainModule.FileName -ne $current.ExecutablePath -or $now.CommandLine -ne $current.CommandLine -or $process.HasExited){throw 'Fresh shell lifetime changed'}
 $process.Kill();if(-not $process.WaitForExit(5000)){throw 'Held harness failed to exit'}
 $after=Invoke-RestMethod http://127.0.0.1:43119/health -TimeoutSec 5
 if($after.instanceId -ne $health.instanceId){throw 'Production Host changed during shell cleanup'}
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED owned harness cleanup';shellPid=$current.ProcessId;creationTicks=[string]$ticks;heldLifetimeOnly=$true;installedLauncherCompleted=$true;noTreeTermination=$true;productionHostUnchanged=$true;verificationMustRunSeparately=$true;reason='Outer harness remained waiting for inherited native console output EOF after installed launcher exited'}|ConvertTo-Json|Set-Content (Join-Path $PSScriptRoot 'restart-shell-cleanup.json') -Encoding utf8
}finally{$process.Dispose()}
