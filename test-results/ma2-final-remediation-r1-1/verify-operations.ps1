$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$ops=Join-Path $env:LOCALAPPDATA 'Bunny-A/state/operations'
$pointer=Get-Content -LiteralPath (Join-Path $ops 'current.json') -Raw|ConvertFrom-Json
foreach($item in @($pointer.exports)+@($pointer.installedGuardedTooling)+@($pointer.historical)){if((Get-FileHash -LiteralPath $item.path).Hash.ToLower() -ne $item.sha256){throw 'Operational or retained historical byte changed'}}
$inspectionStarted=[DateTime]::UtcNow
& $pointer.identityController -OutputName '..\identity-latest.json'
if(-not $?){throw 'Exported current identity controller failed'}
$identity=Join-Path $ops 'identity-latest.json'
$current=Get-Content -LiteralPath $identity -Raw|ConvertFrom-Json
if([DateTime]::Parse($current.recordedAt).ToUniversalTime() -lt $inspectionStarted -or $current.release.manifestSha256 -ne $pointer.release.manifestSha256 -or $current.host.operationalState -ne 'healthy'){throw 'Operational pointer not current/fresh'}
Copy-Item -LiteralPath $identity -Destination (Join-Path $PSScriptRoot 'final-production.json')
@{recordedAt=[DateTime]::UtcNow.ToString('o');classification='LIVE VERIFIED canonical operations pointer';path=(Join-Path $ops 'current.json');sha256=(Get-FileHash -LiteralPath (Join-Path $ops 'current.json')).Hash.ToLower();exportedReadOnlyControllerExecuted=$true;allExportedAndInstalledBytesMatch=$true;historicalBytesRetainedAndMatch=$true;healthyExactProduction=$true;identityOutputNeverStopAuthority=$true}|ConvertTo-Json|Set-Content (Join-Path $PSScriptRoot 'operational-pointer-verification.json') -Encoding utf8
