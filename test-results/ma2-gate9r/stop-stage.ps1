$ErrorActionPreference='Stop'
$stageRoot='C:\Users\allam\AppData\Local\Bunny-A-T9R-stage'
$config=Get-Content -LiteralPath (Join-Path $stageRoot 'install.json') -Raw | ConvertFrom-Json
$credentials=Get-Content -LiteralPath (Join-Path $stageRoot 'state\credentials\credentials.json') -Raw | ConvertFrom-Json
$health=Invoke-RestMethod 'http://127.0.0.1:45119/health' -Headers @{Authorization='Bearer '+$credentials.token}
if($health.app -ne 'Bunny-A' -or $health.pid -ne $credentials.pid -or $health.instanceId -ne $credentials.instanceId) { throw 'Stage live/credential identity mismatch.' }
$native=Get-CimInstance Win32_Process -Filter "ProcessId=$($health.pid)"
$expectedExe=Join-Path $config.currentRelease.folder 'runtime\node.exe'
$expectedEntry=Join-Path $config.currentRelease.folder 'Bunny-Host.mjs'
if(-not [String]::Equals($native.ExecutablePath,$expectedExe,[StringComparison]::OrdinalIgnoreCase) -or -not $native.CommandLine.Contains($expectedEntry)) { throw 'Installed stage executable/entry mismatch.' }
$ownedProcess=[Diagnostics.Process]::GetProcessById([int]$health.pid)
try {
  $null=$ownedProcess.Handle
  $started=$ownedProcess.StartTime.ToUniversalTime().Ticks
  if(($started-($started%10)) -ne $native.CreationDate.ToUniversalTime().Ticks) { throw 'Stage process lifetime changed.' }
  $ownedProcess.Kill()
  if(-not $ownedProcess.WaitForExit(10000)) { throw 'Stage Host did not exit.' }
} finally {$ownedProcess.Dispose()}
@{gate='M-A-2 T9R';recordedAt=[DateTime]::UtcNow.ToString('o');pid=$health.pid;instanceId=$health.instanceId;expectedExecutable=$expectedExe;expectedEntry=$expectedEntry;processStartedAt=[string]$started;nativeHandleHeld=$true;freshHealthCredentialsCimLifetime=$true;stoppedOnlyStagedHost=$true;nameOnlyTermination=$false;calculatorTargetsClosed=$false;productionStopped=$false} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'restart-owned-host-stop.json') -Encoding utf8
Write-Output 'Only the freshly corroborated staged Host stopped; no Calculator or production process terminated.'
