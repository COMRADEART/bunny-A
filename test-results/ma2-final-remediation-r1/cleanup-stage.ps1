$ErrorActionPreference='Stop'
$rec=$PSScriptRoot
$stage=Join-Path $env:LOCALAPPDATA 'Bunny-A-R1-stage'
$config=Get-Content -LiteralPath (Join-Path $stage 'install.json') -Raw | ConvertFrom-Json
& (Join-Path $rec 'calculator-owned-cleanup.ps1') -LedgerPath (Join-Path $rec 'calculator-owned-ledger.json') -OutputPath (Join-Path $rec 'calculator-owned-cleanup.json')
& (Join-Path $rec 'calculator-inventory.ps1') -OutputPath (Join-Path $rec 'calculator-final.json')
$inventory=Get-Content -LiteralPath (Join-Path $rec 'calculator-final.json') -Raw | ConvertFrom-Json
if($inventory.count -ne 0) {throw 'Unexpected Calculator remains; no name-based cleanup permitted'}
$credential=Get-Content -LiteralPath (Join-Path $stage 'state\credentials\credentials.json') -Raw | ConvertFrom-Json
$health=Invoke-RestMethod 'http://127.0.0.1:46129/health'
if($health.pid -ne $credential.pid -or $health.instanceId -ne $credential.instanceId) {throw 'Fresh stage Host identity mismatch'}
& (Join-Path $rec 'stop-owned.ps1') -OwnedPid $health.pid -ExpectedExecutable (Join-Path $config.currentRelease.folder 'runtime\node.exe') -Entry (Join-Path $config.currentRelease.folder 'Bunny-Host.mjs') -OutputPath (Join-Path $rec 'stage-host-cleanup.json')
$gateway=Get-Content -LiteralPath (Join-Path $rec 'ui-gateway-owner.json') -Raw | ConvertFrom-Json
& (Join-Path $rec 'stop-owned.ps1') -OwnedPid $gateway.pid -ExpectedExecutable $gateway.exe -Entry $gateway.entry -OutputPath (Join-Path $rec 'stage-ui-cleanup.json')
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='DISPOSABLE LIVE';testOwnedCalculatorClosed=$true;finalCalculatorCount=0;stageHostStoppedWithFreshHeldIdentity=$true;stageUiStoppedWithFreshHeldIdentity=$true;productionStopped=$false;developmentHostStopped=$false;newProductionReleaseSelected=$false} | ConvertTo-Json | Set-Content (Join-Path $rec 'cleanup.json') -Encoding utf8
