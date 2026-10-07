$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$boot=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'boot.json') -Raw | ConvertFrom-Json
$health=Invoke-RestMethod http://127.0.0.1:43119/health -TimeoutSec 5
if($health.instanceId -ne $boot.health.instanceId -or $health.operationalState -ne 'healthy') {throw 'Cannot establish completed boot before shell-only cleanup'}
$candidates=@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -eq 'pwsh.exe' -and $_.CommandLine.Contains('production-preflight.mjs >') -and $_.CommandLine.Contains('promote.ps1 -Phase activate >') -and $_.CommandLine.Contains('boot.ps1 >') -and $_.CommandLine.Contains('capture-identity.ps1 >') })
if($candidates.Count -ne 1){throw 'Unique authored completed deployment shell not found'}
$current=$candidates[0]
if($current.ExecutablePath -ne 'C:\Users\allam\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe'){throw 'Unexpected test shell executable'}
$process=[Diagnostics.Process]::GetProcessById($current.ProcessId)
try {
 $null=$process.Handle;$ticks=$process.StartTime.ToUniversalTime().Ticks
 $now=Get-CimInstance Win32_Process -Filter "ProcessId=$($current.ProcessId)" -ErrorAction Stop
 if(($ticks-($ticks%10)) -ne $now.CreationDate.ToUniversalTime().Ticks -or $process.MainModule.FileName -ne $current.ExecutablePath -or $now.CommandLine -ne $current.CommandLine){throw 'Fresh shell lifetime changed'}
 $process.Kill();$null=$process.WaitForExit(5000)
 $after=Invoke-RestMethod http://127.0.0.1:43119/health -TimeoutSec 5
 $app=Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'Bunny-A/state/runtime/windows-application.json') -Raw | ConvertFrom-Json
 if($after.instanceId -ne $boot.health.instanceId -or $app.pid -ne $boot.appPid){throw 'Production changed during shell-only cleanup'}
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED owned harness cleanup';shellPid=$current.ProcessId;shellCreationTicks=[string]$ticks;authoredExactCommandMatched=$true;currentHandleHeld=$true;noTreeTermination=$true;productionHostUnchanged=$true;productionApplicationUnchanged=$true;reason='Completed Windows PowerShell boot inherited output pipe through native GUI bootstrap; outer pwsh awaited EOF and had not dispatched final identity command'} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'completed-shell-cleanup.json') -Encoding utf8
} finally {$process.Dispose()}
