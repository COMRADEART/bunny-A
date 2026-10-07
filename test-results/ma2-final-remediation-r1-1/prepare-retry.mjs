import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {fileSha256,verifyRelease,sourceCheck,importClosure} from '../../scripts/bunny-release.mjs';
import {join} from 'node:path';
const prior='test-results/ma2-final-remediation-r1',rec='test-results/ma2-final-remediation-r1-1';
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const auth=read(prior+'/authorization.json');assert.equal(auth.productionActivationAuthorized,true);
const folder=join('releases',auth.candidate.release),installed=join(process.env.LOCALAPPDATA,'Bunny-A/releases',auth.candidate.release);
assert.equal(fileSha256(folder+'.zip'),auth.candidate.zipSha256);assert.equal(fileSha256(join(folder,'release-manifest.json')),auth.candidate.manifestSha256);assert.ok(verifyRelease(folder).ok&&verifyRelease(installed).ok&&sourceCheck(process.cwd(),installed).ok&&importClosure(installed).ok);
auth.recordedAt=new Date().toISOString();auth.retryAuthorization='Direct human R1.1 request continues exact authorized scope and candidate; safe external preflight classification correction only. No additional destructive operation.';
writeFileSync(rec+'/authorization.json',JSON.stringify(auth,null,2)+'\n');
mkdirSync(rec+'/baseline',{recursive:true});for(const file of ['production.json','protected-row-ledger.json','startup.json'])copyFileSync(prior+'/baseline/'+file,rec+'/baseline/'+file);
let pre=readFileSync(prior+'/production/preflight.mjs','utf8').replaceAll("'../../../scripts/bunny-release.mjs'","'../../scripts/bunny-release.mjs'").replaceAll("'../../ma2-gate8/tools/22-rowdigest.mjs'","'../ma2-gate8/tools/22-rowdigest.mjs'").replace("const rec='test-results/ma2-final-remediation-r1',out=rec+'/pre-activation/authorized'","const rec='test-results/ma2-final-remediation-r1-1',out=rec+'/preflight'").replace("'backups','ma2-final-remediation-r1'","'backups','ma2-final-remediation-r1-1'");
writeFileSync(rec+'/production-preflight.mjs',pre);
let controller=readFileSync(prior+'/production/promote.ps1','utf8');
controller=controller.replace('$rec=Split-Path -Parent $PSScriptRoot','$rec=$PSScriptRoot').replaceAll('pre-activation\\authorized\\production.json','preflight\\production.json');
const begin=controller.indexOf('function Hold-Role('),end=controller.indexOf('\ntry {',begin);assert.ok(begin>0&&end>begin);
controller=controller.slice(0,begin)+`. (Join-Path $PSScriptRoot 'console-ownership.ps1')
function Hold-Role([string]$Role,[int]$RolePid,[string]$Executable,[string]$Entry) {Hold-R11Process $Role $RolePid $Executable $Entry}
`+controller.slice(end);
controller=controller.replace('$held=@();$records=@();','$held=@();$support=@();$records=@();');
const old=` $known=@($held | ForEach-Object pid)
 $unexpected=@($all | Where-Object { $_.ParentProcessId -in $known -and $_.ProcessId -notin $known })
 if($unexpected.Count) {throw 'Unexpected owned-role descendants; no expanded kill authority permitted'}`;
assert.ok(controller.includes(old));controller=controller.replace(old,` $support=@(Assert-R11Topology $held)
 $supportEvidence=@($support | Select-Object role,pid,parentPid,createdAt,ticks,executable,sessionId,ownerSid,facts,directKillAuthority)`);
controller=controller.replace('roles=$records;allFiveHandlesHeld','roles=$records;support=$supportEvidence;allSupportHandlesHeldForObservation=$true;supportDirectKillAuthority=$false;allFiveHandlesHeld');
controller=controller.replace(' $stops=@()',' $rechecked=@(Assert-R11Topology $held)\n foreach($s in $support){$s.process.Dispose()};$support=$rechecked\n $stops=@()');
controller=controller.replace('  $item=$held | Where-Object role -eq $name',`  $currentAll=@(Get-CimInstance Win32_Process -ErrorAction Stop)
  $knownRolePids=@($held | ForEach-Object pid);$knownSupportPids=@($support | ForEach-Object pid)
  if(@($currentAll | Where-Object { $_.ParentProcessId -in @($knownRolePids+$knownSupportPids) -and $_.ProcessId -notin @($knownRolePids+$knownSupportPids) }).Count) {throw 'New unmodelled descendant immediately before Stop'}
  foreach($s in $support | Where-Object { -not $_.process.HasExited }) {Assert-R11HeldIdentity $s ($currentAll | Where-Object ProcessId -eq $s.pid)}
  $item=$held | Where-Object role -eq $name`);
controller=controller.replace(" if(@(Get-NetTCPConnection -State Listen",` foreach($s in $support) {if(-not $s.process.WaitForExit(10000)){throw 'Console support remains after owned parents; no direct cleanup permitted'}}
 if(@(Get-NetTCPConnection -State Listen`);
controller=controller.replace('stops=$stops;noIntegerPidTaskkill','stops=$stops;supportExitedNaturally=$true;supportTerminatedDirectly=$false;noIntegerPidTaskkill');
controller=controller.replace(' foreach($item in $held) {$item.process.Dispose()}',' foreach($s in $support) {$s.process.Dispose()}\n foreach($item in $held) {$item.process.Dispose()}');
writeFileSync(rec+'/promote.ps1',controller);
writeFileSync(rec+'/package-validation.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'STATIC VERIFIED',candidate:auth.candidate,packageBytesUnchanged:true,installedBytesExact:true,allCoveredFiles:true,gitBlobsExact:true,importClosure:true,externalControllerOnly:true,packagedToolingUnchanged:true,rebuildRequired:false,reason:'Correction is solely external promotion preflight/acceptance tooling under a new evidence root. No candidate manifest-covered file, runtime or installed canonical installer/launcher byte is modified.'},null,2)+'\n');
console.log('Exact authorized candidate preserved; corrected external controller prepared without changing prior failed attempt.');
