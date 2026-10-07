import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {chain,capStep,cmd,createMission,approveMission,waitOpenRequest,respond,getMission,until,saveRecord,REC} from './live-client.ts';
const ps=process.env.WINDIR+'/System32/WindowsPowerShell/v1.0/powershell.exe';
const owned=JSON.parse(readFileSync(REC+'/calculator-owned-ledger.json','utf8')).targets[0];
writeFileSync(REC+'/focus-identity.json',JSON.stringify(owned));
const inventory=(name:string)=>{execFileSync(ps,['-NoProfile','-File',REC+'/calculator-inventory.ps1','-OutputPath',REC+'/'+name],{windowsHide:true});return JSON.parse(readFileSync(REC+'/'+name,'utf8').replace(/^\uFEFF/,''));};
const identity=(t:any)=>[t.handle,t.processId,t.processStartedAt,t.contentProcessId,t.contentStartedAt];
const open=()=>capStep('Acquire','computer.open_app',{app:'calculator'},'Reuse the sole test-owned target');
const blocker=()=>capStep('Pause','computer.type',{title:'Calculator',name:'Never execute',text:'R1_FOCUS_NOT_EXECUTED'},'Never approve typing');
const m=await createMission({title:'R1 focus loss and fresh approval',objective:'Bounded test-owned target lifecycle; no input into another app.',steps:chain([open(),blocker(),open()])});
try {
 await approveMission(m.id);let ask=await waitOpenRequest(m.id);assert.equal((await respond(ask.id,'allow_batch')).status,200);await waitOpenRequest(m.id,{action:'computer.type'});
 const before=await getMission(m.id);assert.equal(before.runs.length,1);
 execFileSync(ps,['-NoProfile','-File',REC+'/foreground-target.ps1','-IdentityPath',REC+'/focus-identity.json','-Minimize'],{windowsHide:true});
 const lost=inventory('focus-lost-inventory.json');assert.equal(lost.count,1);assert.equal(lost.targets[0].foreground,false);
 assert.equal((await cmd('mission.replan',{id:m.id,steps:chain([open(),open(),capStep('Read','computer.read_calculator',{title:'Calculator'},'Read only')])})).status,200);
 await approveMission(m.id);ask=await waitOpenRequest(m.id);assert.equal((await respond(ask.id,'allow_batch')).status,200);
 const fresh=await waitOpenRequest(m.id,{action:'computer.open_app'});const paused=await getMission(m.id);assert.equal(paused.runs.length,1);
 assert.equal(inventory('focus-paused-inventory.json').count,1);
 execFileSync(ps,['-NoProfile','-File',REC+'/restore-owned-fixture.ps1','-LedgerPath',REC+'/calculator-owned-ledger.json'],{windowsHide:true});
 assert.equal((await respond(fresh.id,'allow_batch')).status,200);
 const final=await until(async()=>{const d=await getMission(m.id);return ['completed','failed','stopped'].includes(d.mission.state)?d:null;},'Restored target completion');
 assert.equal(final.mission.state,'completed');const after=inventory('focus-after-inventory.json');assert.equal(after.count,1);assert.deepEqual(identity(after.targets[0]),identity(owned));
 assert.ok(final.runs.filter(r=>r.action==='computer.open_app').every((r:any)=>!r.evidence.some((s:string)=>s.startsWith('Calculator target launched:'))));
 saveRecord('focus-stage.json',{recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',missionId:m.id,originalNotForeground:true,pausedWithoutLaunching:true,runCountWhileUnready:paused.runs.length,newRequestAfterFocusLoss:fresh.id,freshApprovalRequired:true,restoredSameOwnedTarget:true,noAdditionalLaunch:true,forcedForegroundActivation:false,finalState:final.mission.state,after,events:final.events});
} finally {
 execFileSync(ps,['-NoProfile','-File',REC+'/restore-owned-fixture.ps1','-LedgerPath',REC+'/calculator-owned-ledger.json'],{windowsHide:true});
 await cmd('mission.stop',{id:m.id});
}
