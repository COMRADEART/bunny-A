$ErrorActionPreference='Stop'
$rec=$PSScriptRoot
$calc=Get-Content -LiteralPath (Join-Path $rec 'calculator-owned-cleanup.json') -Raw | ConvertFrom-Json
$hostStop=Get-Content -LiteralPath (Join-Path $rec 'stage-host-cleanup.json') -Raw | ConvertFrom-Json
if(-not $hostStop.stopped -or @($calc.targets).Count -ne 1 -or -not $calc.targets[0].exactWindowClosed) {throw 'Prior bounded cleanup not proven'}
& (Join-Path $rec 'calculator-inventory.ps1') -OutputPath (Join-Path $rec 'calculator-final.json')
if((Get-Content -LiteralPath (Join-Path $rec 'calculator-final.json') -Raw | ConvertFrom-Json).count -ne 0) {throw 'Unexpected Calculator remains'}
$gateway=Get-Content -LiteralPath (Join-Path $rec 'ui-gateway-owner.json') -Raw | ConvertFrom-Json
& (Join-Path $rec 'stop-owned.ps1') -OwnedPid $gateway.pid -ExpectedExecutable $gateway.exe -Entry $gateway.entry -OutputPath (Join-Path $rec 'stage-ui-cleanup.json')
if(@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in @(46129,8089)).Count -ne 0) {throw 'Stage listener remains'}
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='DISPOSABLE LIVE';testOwnedCalculatorClosed=$true;finalCalculatorCount=0;stageHostStoppedWithFreshHeldIdentity=$true;stageUiStoppedWithFreshHeldIdentity=$true;productionStopped=$false;developmentHostStopped=$false;newProductionReleaseSelected=$false;initialGatewayCleanupRefusedOnMissingExpectedExecutable=$true;refusalPreservedIn='cleanup-native-refusal.log';unrelatedSharedFramePreserved=$true} | ConvertTo-Json | Set-Content (Join-Path $rec 'cleanup.json') -Encoding utf8
