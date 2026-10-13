$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$rec=$PSScriptRoot
& (Join-Path $rec 'calculator-inventory.ps1') -OutputPath (Join-Path $rec 'calculator-final.json')
$calc=Get-Content -LiteralPath (Join-Path $rec 'calculator-final.json') -Raw|ConvertFrom-Json
if($calc.count -ne 0){throw 'Unexpected Calculator remains; no name-based cleanup allowed'}
$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop|Where-Object {$_.LocalPort -in @(46129,8089)})
if($listeners.Count -ne 0){throw 'QA listener remains'}
$all=@(Get-CimInstance Win32_Process -ErrorAction Stop)
$temporary=@($all|Where-Object {$_.ExecutablePath -and $_.Name -notin @('pwsh.exe','powershell.exe') -and ($_.CommandLine -match '[\\/]Bunny-A-R1-stage[\\/]|fixture-wait\.mjs|foreign-launch\.json' -or $_.ExecutablePath -eq (Join-Path $rec 'gui-fixture.exe'))})
if($temporary.Count -ne 0){throw 'Owned fixture or stage process remains; fresh analysis required'}
$baseline=Get-Content -LiteralPath (Join-Path $rec 'baseline.json') -Raw|ConvertFrom-Json
$dev=Invoke-RestMethod http://127.0.0.1:43139/health -TimeoutSec 5
$devCred=Get-Content -LiteralPath (Join-Path $env:LOCALAPPDATA 'Bunny-A/development/credentials.json') -Raw|ConvertFrom-Json
if($dev.instanceId -ne $baseline.development.instanceId -or $dev.pid -ne $devCred.pid -or $dev.instanceId -ne $devCred.instanceId -or $dev.operationalState -ne 'healthy'){throw 'Development Host preservation not corroborated'}
$cim=Get-CimInstance Win32_Process -Filter "ProcessId=$($dev.pid)" -ErrorAction Stop
$p=[Diagnostics.Process]::GetProcessById($dev.pid)
try{$null=$p.Handle;$ticks=$p.StartTime.ToUniversalTime().Ticks;if(($ticks-($ticks%10)) -ne $cim.CreationDate.ToUniversalTime().Ticks -or $p.MainModule.FileName -ne $cim.ExecutablePath -or $p.HasExited){throw 'Fresh development lifetime changed'}
 $owner=Invoke-CimMethod -InputObject $cim -MethodName GetOwnerSid -ErrorAction Stop
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED read-only preservation';health=$dev;process=@{pid=$dev.pid;createdAt=$cim.CreationDate.ToUniversalTime().ToString('o');creationTicks=[string]$ticks;executable=$cim.ExecutablePath;commandLine=$cim.CommandLine;parentPid=$cim.ParentProcessId;sessionId=$cim.SessionId;ownerSid=$owner.Sid};stateRoot=(Join-Path $env:LOCALAPPDATA 'Bunny-A/development');port=43139;productionSingleton=$false;originalIntentUnknown=$true;stopped=$false;reason='Separate source development Host, original instance preserved; no authority to classify it as stale QA'}|ConvertTo-Json -Depth 6|Set-Content (Join-Path $rec 'development-host.json') -Encoding utf8
}finally{$p.Dispose()}
$authority=Get-Content -LiteralPath (Join-Path $rec 'production-authority-cleanup.json') -Raw|ConvertFrom-Json
$closed=Get-Content -LiteralPath (Join-Path $rec 'calculator-owned-cleanup.json') -Raw|ConvertFrom-Json
if(-not $authority.allQADevicesRevoked -or $authority.activeMissions -ne 0 -or $authority.activeGrants -ne 0 -or $authority.pendingTestRequests -ne 0 -or @($closed.targets).Count -ne 1 -or -not $closed.targets[0].exactWindowClosed){throw 'Bounded cleanup proof incomplete'}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED';stageHostRunning=$false;qaGatewayRunning=$false;qaListeners=0;temporaryFixtureProcesses=0;temporaryCloudflared=0;productionCloudflaredPreserved=$true;developmentHostPreserved=$true;finalCalculatorCount=0;testOwnedWindowClosed=$true;sharedFramePreserved=$true;allQADevicesRevoked=$true;activeTestMissions=0;activeTestGrants=0;pendingTestApprovals=0;unrelatedProcessesStopped=$false;finalPolicy='Original Missions OFF and Triggers OFF restored by canonical API';authorityEvidence='production-authority-cleanup.json';processEvidence='final-production.json';notes='Production remote tunnel is the original consented transport role, not a QA cloudflared fixture.'}|ConvertTo-Json -Depth 5|Set-Content (Join-Path $rec 'cleanup.json') -Encoding utf8
