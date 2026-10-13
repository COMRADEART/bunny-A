// M-A-3 T9R-F02: the T9R X53 stability harness re-run against the F02 source (copied from t9r-f01/x53-stability.mjs).
// Reuses the sealed T9R PowerShell tools read-only; every output, including the owned-target ledger copy, lives here.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {ownedAcquisition,identityOf} from '../../../scripts/t9-calculator-fixture.mjs';
const tools=resolve('test-results/ma3/t9r'), root=resolve('test-results/ma3/t9r-f02/x53'),f01=resolve('test-results/ma3/t9r-f01/x53'), rows=[], source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const modes=['cold','warm','minimized','warm','cold','warm','minimized','warm','cold','warm'];
const diagnostic=path=>{execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(tools,'calculator-diagnostic.ps1'),'-OutputPath',path],{windowsHide:true,stdio:'pipe'});return JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));};
const control=(action,path)=>{const result=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(tools,'owned-target-control.ps1'),'-Action',action,'-LedgerPath',join(root,'owned-calculator-ledger.json')],{windowsHide:true,encoding:'utf8'});writeFileSync(path,result);};
mkdirSync(root,{recursive:true});if(!existsSync(join(root,'owned-calculator-ledger.json')))copyFileSync(existsSync(join(f01,'owned-calculator-ledger.json'))?join(f01,'owned-calculator-ledger.json'):join(tools,'owned-calculator-ledger.json'),join(root,'owned-calculator-ledger.json'));
const seal=()=>writeFileSync(join(root,'x53-stability-matrix.json'),JSON.stringify({sourceCommit:source,requestedRuns:10,consecutiveClean:rows.filter(r=>r.exitCode===0).length,failedAttempts:rows.filter(r=>r.exitCode!==0).length,classification:'LIVE unchanged original X53 with fresh disposable Windows Host and genuine UIA (T9R-F02 source; T9R tools reused read-only)',rows},null,2)+'\n');
for(let i=0;i<modes.length;i++){
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source,'Source revision remains pinned');
 const mode=modes[i],dir=join(root,'stability',String(i+1).padStart(2,'0')+'-'+mode);mkdirSync(dir,{recursive:true});
 let before=diagnostic(join(dir,'before-initial.json')); const originalIdentity=before.targets[0]&&identityOf(before.targets[0]);
 if(mode==='cold'){
  control('Close',join(dir,'owned-close-receipt.json'));
  const deadline=Date.now()+5000;
  do{before=diagnostic(join(dir,'before.json'));if(!before.targets.length)break;}while(Date.now()<deadline);
  assert.equal(before.targets.length,0,'Cold state requires exact previous owned target closed; no process-name termination');
 }else if(mode==='minimized'){control('Minimize',join(dir,'owned-minimize-receipt.json'));before=diagnostic(join(dir,'before.json'));assert.equal(before.targets[0].minimized,true);}
 else writeFileSync(join(dir,'before.json'),JSON.stringify(before,null,2)+'\n');
 const startedAt=new Date().toISOString();
 const result=spawnSync(process.execPath,['--experimental-strip-types','--test','--test-concurrency=1','src/lib/bunny-missions/cross-app-live.test.ts'],{windowsHide:true,encoding:'utf8',timeout:180000});
 writeFileSync(join(dir,'x53.log'),result.stdout+(result.stderr||''));
 for(const file of readdirSync('test-results/ma3/t6').filter(f=>/^integrated-.*\.json$/.test(f)))copyFileSync(join('test-results/ma3/t6',file),join(dir,file));
 const after=diagnostic(join(dir,'after.json'));
 const live=JSON.parse(readFileSync(join(dir,'integrated-acceptance.json')));
 const acquire=live.runs?.find(run=>run.action==='computer.open_app'&&run.status==='succeeded');
 const identities=acquire?.evidence?.find(e=>e.startsWith('Calculator target '));
 const readiness=acquire?.evidence?.find(e=>e.startsWith('Calculator readiness: '));
 const row={run:i+1,mode,startedAt,finishedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,sourceCommit:source,agentId:live.agentId,missionId:live.missionId,acquisition:identities,readiness,host:live.hostIdentities??live.restart,afterIdentity:after.targets[0]&&identityOf(after.targets[0]),log:dir+'/x53.log'};
 rows.push(row);seal();
 if(result.status!==0)throw Error(`X53 run ${i+1} failed; retained, not silently retried.`);
 assert.ok(acquire&&identities,'Canonical genuine acquisition required');
 if(mode==='cold'){
  const target=ownedAcquisition(before,after,{missionId:live.missionId,capabilityRunId:acquire.id});
  assert.deepEqual(identityOf(target),JSON.parse(identities.slice(identities.indexOf(': ')+2)));
  writeFileSync(join(root,'owned-calculator-ledger.json'),JSON.stringify({preexistingHandles:before.targets.map(t=>t.handle),targets:[target]},null,2)+'\n');
 }else assert.deepEqual(identityOf(after.targets[0]),originalIdentity,'Warm target retains exact frame/content identity');
 if(mode==='minimized'){assert.equal(after.targets[0].minimized,false);assert.match(readiness,/"restored":true/);}
 console.log(`X53 ${i+1}/10 ${mode}: PASS; Agent ${live.agentId}, Mission ${live.missionId}`);
}
seal();
