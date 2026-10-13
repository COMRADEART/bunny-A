$ErrorActionPreference='Stop'
$env:PSModulePath='C:\Windows\System32\WindowsPowerShell\v1.0\Modules'
$root=Join-Path $env:LOCALAPPDATA 'Bunny-A';$cfg=Get-Content -LiteralPath (Join-Path $root 'install.json') -Raw|ConvertFrom-Json
. (Join-Path $cfg.currentRelease.folder 'Bunny-State.ps1')
[void](Assert-BunnyRelease $cfg.currentRelease.folder $cfg.currentRelease)
$final=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'final-production.json') -Raw|ConvertFrom-Json
if($final.release.manifestSha256 -ne $cfg.currentRelease.manifestSha256){throw 'Final verified release differs'}
$ops=Join-Path $cfg.stateRoot 'operations';$version=Join-Path $ops 'ma2-r1-1-20261007'
New-Item -ItemType Directory -Path $version -Force|Out-Null
$exports=@()
foreach($name in @('console-ownership.ps1','capture-identity.ps1','authorization.json','CURRENT_OPERATIONS_R1_1.md')){
 $src=Join-Path $PSScriptRoot $name;$dst=Join-Path $version $name
 $hash=(Get-FileHash -LiteralPath $src).Hash.ToLower()
 if(Test-Path -LiteralPath $dst){if((Get-FileHash -LiteralPath $dst).Hash.ToLower() -ne $hash){throw 'Existing immutable export differs; refusing replacement'}}else{Copy-Item -LiteralPath $src -Destination $dst}
 if((Get-FileHash -LiteralPath $dst).Hash.ToLower() -ne $hash){throw 'Export byte identity mismatch'}
 $exports+=@{name=$name;path=$dst;sha256=$hash}
}
$historical=@()
$old=Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'test-results/ma2-gate8/tools/30-rollback-controller.mjs'
if(Test-Path -LiteralPath $old){$historical+=@{path=$old;sha256=(Get-FileHash -LiteralPath $old).Hash.ToLower();classification='HISTORICAL - NOT VALID FOR CURRENT PROMOTION/ROLLBACK ACCEPTANCE'}}
foreach($guide in @(Get-ChildItem -LiteralPath (Join-Path $root 'rollback') -Filter ROLLBACK.md -File -Recurse)){$historical+=@{path=$guide.FullName;sha256=(Get-FileHash -LiteralPath $guide.FullName).Hash.ToLower();classification='HISTORICAL - NOT VALID FOR CURRENT PROMOTION/ROLLBACK ACCEPTANCE'}}
$pointer=Join-Path $ops 'current.json'
if(Test-Path -LiteralPath $pointer){Copy-Item -LiteralPath $pointer -Destination (Join-Path $version 'previous-current.json')}
$installed=@()
foreach($name in @('scripts/install-bunny-release.ps1','scripts/bunny-rollback-preflight.mjs','src/lib/bunny-host/manager.server.ts','src/lib/bunny-host/process-tree.server.ts')){
 $path=Join-Path $cfg.currentRelease.folder $name
 $installed+=@{path=$path;sha256=(Get-FileHash -LiteralPath $path).Hash.ToLower()}
}
$record=@{schema='bunny-operations/1';recordedAt=[DateTime]::UtcNow.ToString('o');classification='CURRENT guarded operations';release=$cfg.currentRelease;externalOwnershipCommit='1b5c9c3d6c90e04d09cc0a8dbb3da484d82f0962';exports=$exports;installedGuardedTooling=$installed;procedure=(Join-Path $version 'CURRENT_OPERATIONS_R1_1.md');identityController=(Join-Path $version 'capture-identity.ps1');ownershipModule=(Join-Path $version 'console-ownership.ps1');identityOutputNeverStopAuthority=$true;historical=$historical;retainedHistoryNotModified=$true;productionRollbackPerformed=$false;candidateBytesUnchanged=$true;gitRuntimeDeployment=$false;independentReviewRequired=$true}
Write-BunnyJson $pointer $record
$record|ConvertTo-Json -Depth 12|Set-Content (Join-Path $PSScriptRoot 'operational-pointer.json') -Encoding utf8
