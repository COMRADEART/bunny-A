$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
. (Join-Path $PSScriptRoot 'console-ownership.ps1')
$roles=@();$support=@();$sentinel=$null
$node=(Get-Command node.exe -ErrorAction Stop).Source
$wait=Join-Path $PSScriptRoot 'fixture-wait.mjs'
Set-Content -LiteralPath $wait -Encoding utf8 -Value 'import {spawn} from "node:child_process";import {writeFileSync} from "node:fs";if(process.argv.includes("foreign-parent")){const child=spawn(process.execPath,[process.argv[1],"foreign-sentinel"],{stdio:"ignore",windowsHide:true});writeFileSync(process.argv[3],JSON.stringify({pid:child.pid}));}setInterval(()=>{},1000);'
$gui=Join-Path $PSScriptRoot 'gui-fixture.exe'
if(-not (Test-Path -LiteralPath $gui)){Add-Type -TypeDefinition 'using System.Threading;public static class GuiFixture { [System.STAThread] public static void Main(){Thread.Sleep(600000);} }' -OutputAssembly $gui -OutputType WindowsApplication}
try {
 # Same hidden-console Start-Process launch shape as the canonical installed launcher.
 foreach($name in @('host','gateway','tunnel-worker','cloudflared')) {
  $child=Start-Process -FilePath $node -ArgumentList @(('"'+$wait+'"'),$name) -WindowStyle Hidden -PassThru
  $roles+=Hold-R11Process $name $child.Id $node $name
 }
 $guiProcess=Start-Process -FilePath $gui -WindowStyle Hidden -PassThru
 $roles+=Hold-R11Process 'application' $guiProcess.Id $gui $gui
 $sentinelProcess=Start-Process -FilePath $node -ArgumentList @(('"'+$wait+'"'),'unrelated-sentinel') -WindowStyle Hidden -PassThru
 $sentinel=Hold-R11Process 'fixture-owned-sentinel' $sentinelProcess.Id $node 'unrelated-sentinel'
 $support=@(Assert-R11Topology $roles)
 if($support.Count -ne 4) {throw ('Expected four real console hosts; observed '+$support.Count)}
 $proof=@($support | ForEach-Object { [pscustomobject]@{pid=$_.pid;parentPid=$_.parentPid;createdAt=$_.createdAt;facts=$_.facts;directKillAuthority=$_.directKillAuthority} })
 # Real exit race: stop only the fixture's freshly corroborated held parent, then inspect.
 $first=$roles[0];Assert-R11HeldIdentity $first (Get-CimInstance Win32_Process -Filter "ProcessId=$($first.pid)" -ErrorAction Stop)
 $first.process.Kill();$null=$first.process.WaitForExit(5000)
 $refused=$false;try{$race=@(Assert-R11Topology $roles);foreach($r in $race){$r.process.Dispose()}}catch{$refused=$true}
 if(-not $refused) {throw 'Exited parent unexpectedly conferred historical authority'}
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='DISPOSABLE LIVE';realParentExited=$true;preflightRefused=$true;staleParentNotReconstructed=$true;sentinelSurvived=(-not $sentinel.process.HasExited)} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'parent-exit-race.json') -Encoding utf8
 foreach($item in $roles | Select-Object -Skip 1) {Assert-R11HeldIdentity $item (Get-CimInstance Win32_Process -Filter "ProcessId=$($item.pid)" -ErrorAction Stop);$item.process.Kill();if(-not $item.process.WaitForExit(5000)){throw 'Owned fixture parent failed to exit'}}
 foreach($s in $support) {if(-not $s.process.WaitForExit(10000)){throw 'Console support did not naturally exit'}}
 if($sentinel.process.HasExited) {throw 'Unrelated sentinel was affected'}
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='DISPOSABLE LIVE';exactCorrectedControllerModule=$true;roles=5;guiBootstrapHasNoSupport=$true;realConsoleSupport=$proof;topologyAccepted=$true;parentStopHeldAndFresh=$true;supportNaturalExit=$true;supportDirectTermination=$false;sentinelSurvived=$true;stageTopologyAccepted=$true;fiveRoleProductionTopology='Four hidden console role processes plus a real GUI-subsystem bootstrap fixture; individual console semantics actual, service protocols not exercised in this topology fixture'} | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $PSScriptRoot 'positive-conhost-test.json') -Encoding utf8
 $trace=Join-Path $PSScriptRoot 'foreign-launch.json'
 $foreign=Start-Process -FilePath $node -ArgumentList @(('"'+$wait+'"'),'foreign-parent',('"'+$trace+'"')) -WindowStyle Hidden -PassThru
 $foreignParent=Hold-R11Process 'host' $foreign.Id $node 'foreign-parent';$roles+=$foreignParent
 for($i=0;$i -lt 30 -and -not (Test-Path -LiteralPath $trace);$i++){Start-Sleep -Milliseconds 100}
 $foreignPid=(Get-Content -LiteralPath $trace -Raw | ConvertFrom-Json).pid
 $foreignChild=Hold-R11Process 'fixture-owned-sentinel' $foreignPid $node 'foreign-sentinel';$roles+=$foreignChild
 if($foreignChild.parentPid -ne $foreignParent.pid -or [long]$foreignChild.ticks -le [long]$foreignParent.ticks){throw 'Foreign fixture child provenance failed'}
 $negative=$false;try{$n=@(Assert-R11Topology @($foreignParent));foreach($s in $n){$s.process.Dispose()}}catch{if($_.Exception.Message -notmatch 'Unmodelled'){throw};$negative=$true}
 if(-not $negative -or $foreignChild.process.HasExited -or $sentinel.process.HasExited){throw 'Foreign descendant refusal/preservation failed'}
 @{recordedAt=[DateTime]::UtcNow.ToString('o');classification='DISPOSABLE LIVE + SIMULATED signer/path/identity adversarial facts';realForeignNodeDescendantRefused=$true;foreignDescendantPreserved=$true;unrelatedSentinelSurvived=$true;noClassifierTermination=$true;factTests='focused-facts.json';fakeNamesAndSigners='Faithful synthetic mutations through the identical rule; no executable/signature forgery claimed'} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'foreign-conhost-negative.json') -Encoding utf8
 Write-Output 'Four real console support relations accepted; normal parent Stop tears support down; exit race refused; sentinel survives.'
} finally {
 foreach($s in $support){$s.process.Dispose()}
 foreach($item in @($roles)+@($sentinel)) {if($item){if(-not $item.process.HasExited){Assert-R11HeldIdentity $item (Get-CimInstance Win32_Process -Filter "ProcessId=$($item.pid)" -ErrorAction Stop);$item.process.Kill();$null=$item.process.WaitForExit(5000)};$item.process.Dispose()}}
}
