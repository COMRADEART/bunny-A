import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { chain,capStep,createMission,approveMission,waitOpenRequest,respond,getMission,cmd } from '../ma2-gate9/staging/live-shared.ts';
const root='test-results/ma2-gate9r/';
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const inventory=(name:string)=>{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'calculator-inventory.ps1','-OutputPath',root+name],{windowsHide:true});return json(root+name);};
const before=inventory('repro-inventory-before.json');
assert.equal(before.count,0,'Controlled old-runtime reproduction requires no existing Calculator; never close an unknown target.');
const open=()=>capStep('Acquire','computer.open_app',{app:'calculator'},'Acquire intended Calculator');
const mission=await createMission({title:'T9R old v20 repeated acquisition reproduction',objective:'Controlled duplicate lifecycle investigation; no sensitive action will be approved.',steps:chain([open(),open(),capStep('Pause','computer.type',{title:'Calculator',name:'Never execute',text:'T9R_NONSECRET_PROBE'},'Pause for separate approval')])});
try {
  await approveMission(mission.id);const ask=await waitOpenRequest(mission.id);assert.ok(ask.batchOffer);
  assert.equal((await respond(ask.id,'allow_batch')).status,200);
  await waitOpenRequest(mission.id,{action:'computer.type',timeoutMs:60000});
  const details=await getMission(mission.id),after=inventory('repro-inventory-after.json');
  const launches=details.runs.filter(r=>r.action==='computer.open_app');
  assert.equal(launches.length,2);assert.ok(launches.every(r=>r.status==='succeeded'));
  assert.equal(after.verifiedVisibleCount,2,'Old-runtime same-workflow repro must establish two actual visible targets.');
  const targets=after.targets.map((t:any)=>({...t,ownership:'test-owned',createdByTest:true,provenance:{test:'old-runtime repeated acquisition',missionId:mission.id,launchRunIds:launches.map(r=>r.id),controlledBeforeCount:0,controlledAfterCount:2}}));
  writeFileSync(root+'repro-owned-targets.json',JSON.stringify({preexistingHandles:[],targets},null,2)+'\n');
  writeFileSync(root+'reproduction.json',JSON.stringify({gate:'M-A-2 T9R',release:'Bunny-A-Windows-v20-T9',ok:true,productDuplicateReproduced:true,missionId:mission.id,approvalRequestId:ask.id,offer:ask.batchOffer,launchRuns:launches,canonicalBatch:details.mission.batch,before,after,cleanupProvenance:'Controlled empty inventory before two explicitly approved acquisition calls; exactly two verified Calculator windows produced. No by-name close.'},null,2)+'\n');
} finally { await cmd('mission.stop',{id:mission.id}); }
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'owned-cleanup.ps1','-LedgerPath',root+'repro-owned-targets.json','-OutputPath',root+'repro-cleanup.json'],{windowsHide:true});
assert.equal(inventory('repro-inventory-cleaned.json').count,0);
console.log('Old v20 same-Mission/two-acquire duplicate reproduced and only the two owned targets closed.');
