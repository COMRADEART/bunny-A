$ErrorActionPreference='Stop'
# The completed QA shell has pending commands after a child held its pipe open.
# Stop only that freshly verified shell, never its children or the running Host.
$controllerPid=45152
$expectedExe='C:\Users\allam\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe'
$native=Get-CimInstance Win32_Process -Filter "ProcessId=$controllerPid"
if(-not $native) { throw 'Expected QA controller already absent; do not substitute another PID.' }
if(-not [String]::Equals($native.ExecutablePath,$expectedExe,[StringComparison]::OrdinalIgnoreCase) -or -not $native.CommandLine.Contains('live-matrix.ts restartBefore') -or -not $native.CommandLine.Contains('live-matrix.ts restartAfter ui') -or -not $native.CommandLine.Contains('Bunny-A-T9R-stage\releases\Bunny-A-Windows-v21-T9\Start-Bunny-Release.ps1')) { throw 'QA controller role/entry mismatch.' }
$stageHealth=Invoke-RestMethod 'http://127.0.0.1:45119/health'
$productionHealth=Invoke-RestMethod 'http://127.0.0.1:43119/health'
if($controllerPid -eq $stageHealth.pid -or $controllerPid -eq $productionHealth.pid) { throw 'Never stop a Host as a controller.' }
$ownedProcess=[Diagnostics.Process]::GetProcessById($controllerPid)
try {
  $null=$ownedProcess.Handle
  $started=$ownedProcess.StartTime.ToUniversalTime().Ticks
  if(($started-($started%10)) -ne $native.CreationDate.ToUniversalTime().Ticks) { throw 'QA controller lifetime mismatch.' }
  $ownedProcess.Kill()
  if(-not $ownedProcess.WaitForExit(10000)) { throw 'QA controller did not exit.' }
} finally {$ownedProcess.Dispose()}
$stageAfter=Invoke-RestMethod 'http://127.0.0.1:45119/health'
$productionAfter=Invoke-RestMethod 'http://127.0.0.1:43119/health'
if($stageAfter.instanceId -ne $stageHealth.instanceId -or $productionAfter.instanceId -ne $productionHealth.instanceId -or $stageAfter.operationalState -ne 'healthy' -or $productionAfter.operationalState -ne 'healthy') { throw 'Host preservation failed.' }
@{gate='M-A-2 T9R';recordedAt=[DateTime]::UtcNow.ToString('o');controllerPid=$controllerPid;expectedExecutable=$expectedExe;freshCommandRoleEntryAndLifetime=$true;nativeHandleHeld=$true;stoppedOnlyController=$true;childrenTerminated=$false;stageHostHealthyUnchanged=$true;productionHealthyUnchanged=$true;pendingReplayPrevented=$true;calculatorClosed=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'restart-controller-cleanup.json') -Encoding utf8
Write-Output 'Completed QA controller closed without terminating any child, Calculator or Host.'
