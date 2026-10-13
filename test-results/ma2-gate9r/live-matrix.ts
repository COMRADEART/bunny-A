import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {ownedAcquisition,safeCleanupTargets,identityOf} from '../../scripts/t9-calculator-fixture.mjs';
import {chain,capStep,cmd,createMission,approveMission,waitOpenRequest,respond,getMission,getState,until,wait,STAGE_STATE,STAGE_WORKSPACE,saveRecord,health} from './live-client.ts';
const root='test-results/ma2-gate9r/';
const release=JSON.parse(readFileSync('install/release-pin.json','utf8')).release;
const outstanding=new Map<string,any>();
const testMissions=new Set<string>();
const parse=(name:string)=>JSON.parse(readFileSync(root+name,'utf8').replace(/^\uFEFF/,''));
function inventory(name:string) {
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'calculator-inventory.ps1','-OutputPath',root+name],{windowsHide:true});
  return parse(name);
}
const open=()=>capStep('Acquire','computer.open_app',{app:'calculator'},'Acquire/reuse intended Calculator');
const focus=()=>capStep('Focus','computer.focus_window',{title:'Calculator'},'Focus intended Calculator');
const press=(automationId:string)=>capStep('Arithmetic','computer.invoke_control',{title:'Calculator',automationId},'Invoke known arithmetic control');
const result=()=>capStep('Read','computer.read_calculator',{title:'Calculator'},'Read verified result');
const blocker=()=>capStep('Pause','computer.type',{title:'Calculator',name:'Never execute',text:'T9R_NONSECRET_PROBE'},'Separate approval; never execute');
async function create(name:string,entries:any[],unchained=false) {
  const mission=await createMission({title:'T9R '+name,objective:'Disposable bounded Calculator lifecycle acceptance; no provider work.',steps:unchained?entries:chain(entries)});
  assert.ok(resolve(mission.root).toLowerCase().startsWith(resolve(STAGE_WORKSPACE).toLowerCase()),'Staged Mission root must be its separate workspace.');
  testMissions.add(mission.id);
  await approveMission(mission.id);return mission;
}
async function grant(id:string,options:any={}) {
  const ask=await waitOpenRequest(id);assert.ok(ask.batchOffer);assert.equal((await respond(ask.id,'allow_batch',options)).status,200);return ask;
}
const halt=async(id:string)=>{
  const detail=await getMission(id);
  if(['completed','failed','stopped'].includes(detail.mission.state)) return;
  assert.equal((await cmd('mission.stop',{id})).status,200);
};
function targetRecord(id:string) {
  const db=new DatabaseSync(STAGE_STATE+'/host.sqlite',{readOnly:true});
  try {const row=db.prepare('SELECT value FROM settings WHERE key=?').get('computer.target:mission:'+id) as {value:string}|undefined;return row?JSON.parse(row.value):null;} finally {db.close();}
}
function batches(id:string) {const db=new DatabaseSync(STAGE_STATE+'/host.sqlite',{readOnly:true});try{return db.prepare('SELECT record FROM approval_batches WHERE mission_id=? ORDER BY created_at').all(id).map(row=>JSON.parse(String(row.record)));}finally{db.close();}}
function identities(detail:any) {
  return detail.runs.flatMap((run:any)=>run.evidence.filter((e:string)=>e.startsWith('Calculator target ')).map((e:string)=>({runId:run.id,action:run.action,decision:e.slice(18,e.indexOf(':')),identity:JSON.parse(e.slice(e.indexOf(':')+1))})));
}
async function done(id:string) {
  return until(async()=>{const d=await getMission(id);return ['completed','failed','stopped'].includes(d.mission.state)?d:null;},'terminal mission',{timeoutMs:90000});
}
function ledger(name:string,before:any,after:any,detail:any) {
  const launches=identities(detail).filter((e:any)=>e.decision==='launched');assert.equal(launches.length,1,'One actual target launch must explain the new window.');
  const owned=ownedAcquisition(before,after,{missionId:detail.mission.id,capabilityRunId:launches[0].runId,test:name});
  const value={preexistingHandles:before.targets.map((t:any)=>t.handle),targets:[owned]};saveRecord(name+'-owned.json',value);outstanding.set(name,value);return value;
}
async function cleanup(name:string,owned:any,ids:string[]) {
  for(const id of ids) await halt(id);
  const current=inventory(name+'-cleanup-before.json');safeCleanupTargets(owned,current);
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'owned-cleanup.ps1','-LedgerPath',root+name+'-owned.json','-OutputPath',root+name+'-cleanup.json'],{windowsHide:true});
  const after=inventory(name+'-cleanup-after.json');assert.deepEqual(after.targets.map((t:any)=>t.handle).sort(),owned.preexistingHandles.slice().sort());
  outstanding.delete(name);
}
async function sequence(name:string,entries:any[]) {
  const before=inventory(name+'-before.json');assert.equal(before.count,0,'Controlled phase begins without unknown targets.');
  const mission=await create(name,entries);const ask=await grant(mission.id);const detail=await done(mission.id);
  assert.equal(detail!.mission.state,'completed',JSON.stringify(detail!.mission.steps.map(s=>s.failure)));
  const after=inventory(name+'-after.json');assert.equal(after.verifiedVisibleCount,1);const owned=ledger(name,before,after,detail);
  const events=identities(detail);assert.ok(events.every((e:any)=>JSON.stringify(e.identity)===JSON.stringify(events[0].identity)));
  const record={gate:'M-A-2 T9R',release,recordedAt:new Date().toISOString(),ok:true,missionId:mission.id,requestId:ask.id,grant:batches(mission.id),target:targetRecord(mission.id),before,after,identities:events,runs:detail!.runs};
  saveRecord(name+'-live.json',record);await cleanup(name,owned,[mission.id]);return record;
}
async function setupFixture(name:string) {
  const before=inventory(name+'-fixture-before.json');assert.equal(before.count,0);
  const fixture=await create(name+' explicit fixture setup',[open(),open()]);await grant(fixture.id);
  const detail=await done(fixture.id);assert.equal(detail!.mission.state,'completed');
  const after=inventory(name+'-fixture-after.json');const owned=ledger(name,before,after,detail);
  saveRecord(name+'-foreground-identity.json',owned.targets[0]);
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'foreground-target.ps1','-IdentityPath',root+name+'-foreground-identity.json'],{windowsHide:true});
  return {fixture,owned,before,after};
}
const phases:Record<string,()=>Promise<any>>={
  async cleanupReuse(){
    const owned=parse('same-task-reuse-owned.json');
    await cleanup('same-task-reuse',owned,[owned.targets[0].provenance.missionId]);
  },
  async cleanupExpiry(){const owned=parse('expiration-owned.json');await cleanup('expiration',owned,[owned.targets[0].provenance.missionId]);},
  async reuse(){return sequence('same-task-reuse',[open(),open(),open(),open(),open(),result()]);},
  async race(){
    const before=inventory('race-before.json');assert.equal(before.count,0);
    const mission=await create('concurrent same-workflow acquire',[{...open(),dependsOn:[]},{...open(),dependsOn:[]},{...blocker(),dependsOn:[0,1]}],true);
    const asks=await until(async()=>{const d=await getMission(mission.id);const pending=d.mission.requests.filter(r=>r.resolvedAt===null);return pending.length===2?pending:null;},'two independent pending acquisition requests');
    const first=await respond(asks![0].id,'allow_batch');assert.equal(first.status,200);const second=await respond(asks![1].id,'allow_once');assert.equal(second.status,200);
    await waitOpenRequest(mission.id,{action:'computer.type',timeoutMs:60000});const detail=await getMission(mission.id);const after=inventory('race-after.json');
    assert.equal(after.verifiedVisibleCount,1);assert.equal(detail.runs.length,2);const owned=ledger('race',before,after,detail);
    const events=identities(detail);assert.deepEqual(events[0].identity,events[1].identity);assert.equal(events.filter((e:any)=>e.decision==='launched').length,1);
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,decisions:['allow_batch','allow_once for already-pending second request'],runs:detail.runs,identities:events,target:targetRecord(mission.id),after};
    saveRecord('concurrent-acquire-live.json',record);saveRecord('race-test.json',record);await cleanup('race',owned,[mission.id]);return record;
  },
  async budget(){
    const before=inventory('budget-before.json');assert.equal(before.count,0);const mission=await create('budget transition',[open(),open(),open(),result()]);await grant(mission.id,{maxActions:2});
    const ask=await waitOpenRequest(mission.id,{action:'computer.open_app',timeoutMs:60000});const pending=await getMission(mission.id),after=inventory('budget-pending.json');
    assert.equal(pending.runs.length,2);assert.equal(after.count,1);assert.equal(batches(mission.id)[0].endReason,'exhausted');const owned=ledger('budget',before,after,pending);
    assert.equal((await respond(ask.id,'allow_batch')).status,200);const detail=await done(mission.id);assert.equal(detail!.mission.state,'completed');assert.equal(inventory('budget-final.json').count,1);
    const events=identities(detail);assert.ok(events.every((e:any)=>JSON.stringify(e.identity)===JSON.stringify(events[0].identity)));
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,canonicalBatches:batches(mission.id),pending,after,identities:events,launchCount:1,freshApprovalReusedTarget:true};saveRecord('budget-live.json',record);await cleanup('budget',owned,[mission.id]);return record;
  },
  async expiry(){
    const before=inventory('expiration-before.json');assert.equal(before.count,0);const mission=await create('expiration transition',[open(),open(),open(),result()]);
    const first=await waitOpenRequest(mission.id);assert.equal((await respond(first.id,'allow_once')).status,200);
    const ask=await waitOpenRequest(mission.id,{action:'computer.open_app',timeoutMs:60000});const initial=await getMission(mission.id),after=inventory('expiration-target.json');const owned=ledger('expiration',before,after,initial);
    assert.equal((await respond(ask.id,'allow_batch',{ttlMs:1000})).status,200);
    const settled=await until(async()=>{const d=await getMission(mission.id);return d.mission.state==='failed'||d.mission.requests.some(r=>r.resolvedAt===null)?d:null;},'expired decision or contained native expiry failure',{timeoutMs:60000});
    const containedExpiryFailure=settled!.mission.state==='failed';
    if(containedExpiryFailure) assert.equal((await cmd('mission.retry',{id:mission.id})).status,200);
    const fresh=await waitOpenRequest(mission.id,{action:'computer.open_app',timeoutMs:60000});assert.ok(batches(mission.id)[0].expiresAt<=Date.now());assert.equal(batches(mission.id)[0].status,'ended');assert.equal(inventory('expiration-pending.json').count,1);
    assert.equal((await respond(fresh.id,'allow_batch')).status,200);const detail=await done(mission.id);assert.equal(detail!.mission.state,'completed');
    const events=identities(detail);assert.ok(events.every((e:any)=>JSON.stringify(e.identity)===JSON.stringify(events[0].identity)));
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,batches:batches(mission.id),containedExpiryFailure,explicitRetryRequired:containedExpiryFailure,expirySemantics:'Expiry during an already-admitted native probe can fail the step; explicit user retry asks again. Expiry before admission asks directly. Neither path relaunches.',launchCount:1,freshApprovalReusedTarget:true,identities:events};saveRecord('expiration-live.json',record);await cleanup('expiration',owned,[mission.id]);return record;
  },
  async retry(){
    const before=inventory('retry-before.json');assert.equal(before.count,0);const marker='t9r-retry-'+Date.now()+'.txt';
    const entries=chain([open(),result(),open()]) as any[];entries[1].verification=[{kind:'file_exists',path:marker,contains:'ready'}];
    const mission=await create('read postcondition retry',entries,true);await grant(mission.id);
    await until(async()=>{const d=await getMission(mission.id);return d.events.some(e=>e.type==='mission.step.retrying')?d:null;},'one real postcondition retry',{timeoutMs:60000});
    writeFileSync(join(mission.root,marker),'ready');const detail=await done(mission.id);assert.equal(detail!.mission.state,'completed');
    const after=inventory('retry-after.json');const owned=ledger('retry',before,after,detail);const reads=detail!.runs.filter(r=>r.action==='computer.read_calculator');assert.equal(reads.length,2);assert.equal(after.count,1);
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,retryCause:'Read postcondition marker absent on first check, created on observed retry; real unchanged scheduler/Runtime',readRuns:reads,identities:identities(detail),batch:batches(mission.id),target:targetRecord(mission.id),launchCount:1};saveRecord('retry-live.json',record);await cleanup('retry',owned,[mission.id]);return record;
  },
  async stop(){
    const before=inventory('stop-before.json');assert.equal(before.count,0);const a=await create('Stop owner',[open(),blocker(),open()]);const ask=await grant(a.id);await waitOpenRequest(a.id,{action:'computer.type',timeoutMs:60000});
    const b=await create('unrelated pending work',[open(),open()]);await waitOpenRequest(b.id);const data=await getMission(a.id),after=inventory('stop-owned.json');const owned=ledger('stop',before,after,data);
    await halt(a.id);await wait(1000);const stopped=await getMission(a.id);assert.equal(stopped.runs.length,data.runs.length);assert.equal(inventory('stop-after.json').count,1);assert.equal((await getMission(b.id)).mission.state,'waiting_for_user');assert.equal((await getMission(b.id)).runs.length,0);assert.ok((await respond(ask.id,'allow_batch')).status>=400);
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:a.id,unrelatedMissionId:b.id,noFutureRuns:true,noFutureLaunches:true,unrelatedSurvives:true,batches:batches(a.id)};saveRecord('stop-live.json',record);await cleanup('stop',owned,[a.id,b.id]);return record;
  },
  async second(){
    const before=inventory('second-task-before.json');assert.equal(before.count,0);const a=await create('Task A',[open(),blocker(),open()]);await grant(a.id);await waitOpenRequest(a.id,{action:'computer.type',timeoutMs:60000});const detailA=await getMission(a.id),after=inventory('second-task-A.json');const owned=ledger('second-task',before,after,detailA);
    const b=await create('Task B',[open(),open(),result()]);const ask=await waitOpenRequest(b.id);assert.equal((await getMission(b.id)).runs.length,0);assert.equal(targetRecord(b.id),null);
    assert.equal((await respond(ask.id,'allow_batch')).status,200);const detailB=await done(b.id);assert.equal(detailB!.mission.state,'completed');assert.deepEqual(targetRecord(a.id).identity,targetRecord(b.id).identity);assert.equal(targetRecord(b.id).createdByBunny,false);assert.equal(inventory('second-task-B.json').count,1);
    const record={gate:'M-A-2 T9R',release,ok:true,missionA:a.id,missionB:b.id,inheritedRunsBeforeApproval:0,targetBeforeApproval:null,behavior:'Independent canonical records/approval; B intentionally acquires the same uniquely verified application window after its own explicit grant.',a:targetRecord(a.id),b:targetRecord(b.id),batchesA:batches(a.id),batchesB:batches(b.id)};saveRecord('second-task-live.json',record);await cleanup('second-task',owned,[a.id,b.id]);return record;
  },
  async positive(){
    const setup=await setupFixture('positive');
    const controls=['clearButton','num1Button','num3Button','num7Button','plusButton','num2Button','num6Button','num5Button','equalButton'];
    const mission=await create('137 plus 265',[open(),focus(),...controls.map(press),result()]);const ask=await grant(mission.id);const detail=await done(mission.id);
    assert.equal(detail!.mission.state,'completed',JSON.stringify(detail!.mission.steps.map(s=>s.failure)));
    assert.equal(detail!.mission.requests.length,1);assert.ok(detail!.runs.find(r=>r.action==='computer.read_calculator' && /\b402\b/.test(r.summary??'')));
    const after=inventory('positive-after.json');assert.equal(after.count,1);const events=identities(detail);assert.ok(events.every((e:any)=>JSON.stringify(e.identity)===JSON.stringify(events[0].identity)));assert.equal(events.filter((e:any)=>e.decision==='launched').length,0);
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,fixtureMissionId:setup.fixture.id,setup:'Separate explicitly approved fixture acquires one target from empty desktop; canonical grant ends on fixture completion. Foreground fixture activates only its verified identity before the positive workflow.',workflowPrompts:1,requestId:ask.id,workflowMutations:11,arithmeticControls:9,readActions:1,result:402,workflowLaunches:0,totalFixtureLaunches:1,target:targetRecord(mission.id),identities:events,batches:batches(mission.id),runs:detail!.runs};
    saveRecord('positive-calculation-live.json',record);await cleanup('positive',setup.owned,[setup.fixture.id,mission.id]);return record;
  },
  async stale(){
    const before=inventory('stale-before.json');assert.equal(before.count,0);const mission=await create('stale target replacement',[open(),open(),open(),result()]);const first=await waitOpenRequest(mission.id);assert.equal((await respond(first.id,'allow_once')).status,200);
    const ask=await waitOpenRequest(mission.id,{action:'computer.open_app',timeoutMs:60000});const initial=await getMission(mission.id),after=inventory('stale-initial.json');const old=ledger('stale-initial',before,after,initial);
    safeCleanupTargets(old,after);execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'owned-cleanup.ps1','-LedgerPath',root+'stale-initial-owned.json','-OutputPath',root+'stale-initial-cleanup.json'],{windowsHide:true});
    const absent=inventory('stale-closed.json');assert.equal(absent.count,0);assert.equal((await respond(ask.id,'allow_batch')).status,200);const detail=await done(mission.id);assert.equal(detail!.mission.state,'completed');
    outstanding.delete('stale-initial');
    const current=inventory('stale-replacement.json');assert.equal(current.count,1);const events=identities(detail);const launches=events.filter((e:any)=>e.decision==='launched');assert.equal(launches.length,2);assert.notDeepEqual(launches[0].identity,launches[1].identity);
    const newOwned={preexistingHandles:[],targets:[ownedAcquisition(absent,current,{missionId:mission.id,capabilityRunId:launches[1].runId,test:'stale replacement after proven closed native target'})]};saveRecord('stale-owned.json',newOwned);outstanding.set('stale',newOwned);
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,previousProvenInvalid:absent,controlledReplacementLaunches:1,totalLaunches:2,initial:launches[0],replacement:launches[1],target:targetRecord(mission.id),freshExplicitApproval:true};saveRecord('stale-target-live.json',record);await cleanup('stale',newOwned,[mission.id]);return record;
  },
  async ui(){
    const before=inventory('ui-before.json');assert.equal(before.count,0);const mission=await create('UI reconnect',[open(),blocker(),open()]);const ask=await grant(mission.id);await waitOpenRequest(mission.id,{action:'computer.type',timeoutMs:60000});const detail=await getMission(mission.id),after=inventory('ui-active.json');const owned=ledger('ui',before,after,detail);
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,requestId:ask.id,target:targetRecord(mission.id),batch:batches(mission.id),inventory:after,awaitingRealBrowserReload:true};saveRecord('ui-reconnect-before.json',record);return record;
  },
  async focusLoss(){
    const before=inventory('focus-loss-before.json');assert.equal(before.count,0);
    const mission=await create('focus loss reuse',[open(),blocker(),open()]);await grant(mission.id);await waitOpenRequest(mission.id,{action:'computer.type',timeoutMs:60000});
    const detail=await getMission(mission.id),initial=inventory('focus-loss-initial.json'),owned=ledger('focus-loss',before,initial,detail);
    saveRecord('focus-loss-foreground-identity.json',owned.targets[0]);
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'foreground-target.ps1','-IdentityPath',root+'focus-loss-foreground-identity.json','-Minimize'],{windowsHide:true});
    const after=inventory('focus-loss-existing.json');
    assert.equal(after.targets[0].foreground,false,'The original Calculator is valid while another application is foreground.');
    assert.equal((await cmd('mission.replan',{id:mission.id,steps:chain([open(),open(),result()])})).status,200);await approveMission(mission.id);await grant(mission.id);
    const fresh=await waitOpenRequest(mission.id,{action:'computer.open_app',timeoutMs:60000});const paused=await getMission(mission.id);
    assert.equal(paused.runs.length,1);assert.equal(inventory('focus-loss-paused.json').count,1);
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'restore-owned-fixture.ps1','-LedgerPath',root+'focus-loss-owned.json'],{windowsHide:true});
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'foreground-target.ps1','-IdentityPath',root+'focus-loss-foreground-identity.json'],{windowsHide:true});
    assert.equal((await respond(fresh.id,'allow_batch')).status,200);
    const final=await done(mission.id);assert.equal(final!.mission.state,'completed');assert.equal(inventory('focus-loss-after.json').count,1);assert.equal(identities(final).filter((e:any)=>e.decision==='launched').length,1);
    saveRecord('focus-loss-live.json',{gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,originalNotForeground:true,fixture:'Freshly verified owned Calculator minimized; another application becomes foreground. Native readiness pauses before acting; controller restores the same verified target and explicitly approves the new request. No input sent to the other app.',pausedWithoutLaunching:true,pauseRequestId:fresh.id,freshReplanApproval:true,totalLaunches:1,identities:identities(final),target:targetRecord(mission.id)});await cleanup('focus-loss',owned,[mission.id]);
  },
  async boundary(){
    const before=inventory('application-boundary-before.json');assert.equal(before.count,0);
    const mission=await create('application boundary',[open(),capStep('Other app','computer.focus_window',{title:'Notepad'},'Not Calculator'),open()]);await grant(mission.id);
    const ask=await waitOpenRequest(mission.id,{action:'computer.focus_window',timeoutMs:60000});
    const detail=await getMission(mission.id),after=inventory('application-boundary-after.json'),owned=ledger('application-boundary',before,after,detail);assert.equal(ask.batchOffer,null);assert.equal(detail.runs.length,1);assert.equal(after.count,1);
    saveRecord('application-boundary-live.json',{gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,otherApplication:'Notepad',separateApprovalRequired:true,batchOffered:false,otherApplicationRuns:0,totalLaunches:1});await cleanup('application-boundary',owned,[mission.id]);
  },
  async restartBefore(){
    const before=inventory('restart-before-inventory.json');assert.equal(before.count,0);const mission=await create('restart and replan',[open(),blocker(),open()]);const ask=await grant(mission.id);await waitOpenRequest(mission.id,{action:'computer.type',timeoutMs:60000});const detail=await getMission(mission.id),after=inventory('restart-owned-inventory.json');ledger('restart',before,after,detail);
    saveRecord('restart-before.json',{gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,requestId:ask.id,health:await health(),target:targetRecord(mission.id),batches:batches(mission.id),runCount:detail.runs.length,inventory:after});
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'stop-stage.ps1'],{windowsHide:true});
    outstanding.delete('restart'); // The next controller turn owns this explicit persisted ledger.
  },
  async restartAfter(){
    const before=parse('restart-before.json'),afterHealth=await health();assert.notEqual(afterHealth.instanceId,before.health.instanceId);assert.equal(afterHealth.operationalState,'healthy');
    const recovered=await getMission(before.missionId);assert.equal(recovered.runs.length,before.runCount);assert.equal(recovered.mission.batch,null);assert.equal(batches(before.missionId)[0].endReason,'host_restart');assert.equal(inventory('restart-recovered-inventory.json').count,1);assert.deepEqual(targetRecord(before.missionId).identity,before.target.identity);assert.ok((await respond(before.requestId,'allow_batch')).status>=400);
    assert.equal((await cmd('mission.replan',{id:before.missionId,steps:chain([open(),open(),result()])})).status,200);await approveMission(before.missionId);await grant(before.missionId);const detail=await done(before.missionId);assert.equal(detail!.mission.state,'completed');const events=identities(detail);assert.equal(events.filter((e:any)=>e.decision==='launched').length,1);assert.ok(events.filter((e:any)=>e.action==='computer.open_app').slice(0,2).every((e:any)=>e.decision==='reuse_bound'));assert.deepEqual(targetRecord(before.missionId).identity,before.target.identity);assert.equal(inventory('restart-after-inventory.json').count,1);
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:before.missionId,beforeHealth:before.health,afterHealth,grantDidNotRevive:true,noGuiReplay:true,persistedTargetRevalidatedOnFreshGrant:true,replanRequiredNewEnvelopeAndGrant:true,totalLaunches:1,identities:events,batches:batches(before.missionId)};saveRecord('restart-live.json',record);await cleanup('restart',parse('restart-owned.json'),[before.missionId]);return record;
  },
  async uiClose(){
    const before=parse('ui-reconnect-before.json');const detail=await getMission(before.missionId);const after=inventory('ui-reconnect-after.json');assert.equal(after.count,1);assert.deepEqual(identityOf(after.targets[0]),identityOf(before.inventory.targets[0]));assert.equal(detail.runs.length,1);assert.equal(batches(before.missionId)[0].usedCount,1);
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:before.missionId,realBrowserEvidence:'ui-browser.json',uiReloadCreatedAuthority:false,noAdditionalLaunch:true,runCountBeforeAndAfter:1,canonicalUsedBeforeAndAfter:1,identityBeforeAndAfter:targetRecord(before.missionId).identity};saveRecord('ui-reconnect-live.json',record);await cleanup('ui',parse('ui-owned.json'),[before.missionId]);return record;
  },
  async preexisting(){
    const before=inventory('preexisting-fixture-before.json');assert.equal(before.count,0);
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'open-preexisting-fixture.ps1'],{windowsHide:true});
    const fixture=await until(async()=>{const i=inventory('preexisting-fixture-after.json');return i.count===1&&i.verifiedVisibleCount===1?i:null;},'externally prepared pre-existing Calculator');
    saveRecord('intentionally-retained.json',{targets:fixture!.targets.map((t:any)=>({...t,ownership:'intentionally-retained user-window fixture',provenance:{fixture:'Manual QA preparation outside Bunny Runtime',launcherRecord:'preexisting-fixture-launch.json'}}))});
    saveRecord('preexisting-foreground-identity.json',fixture!.targets[0]);
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',root+'foreground-target.ps1','-IdentityPath',root+'preexisting-foreground-identity.json'],{windowsHide:true});
    const readBefore=await cmd<any>('capability.run',{action:'computer.read_calculator',params:{title:'Calculator'},confirmed:true});assert.equal(readBefore.status,200);const valueBefore=readBefore.body.data.result.output.result;
    const mission=await create('pre-existing window',[open(),focus(),open(),result()]);await grant(mission.id);const detail=await done(mission.id);assert.equal(detail!.mission.state,'completed');
    const after=inventory('preexisting-after.json');assert.equal(after.count,1);assert.deepEqual(identityOf(after.targets[0]),identityOf(fixture!.targets[0]));assert.equal(targetRecord(mission.id).createdByBunny,false);assert.ok(detail!.runs.filter(r=>r.action==='computer.open_app').every(r=>r.summary==='Reused the verified Calculator target.'));
    const readAfter=await cmd<any>('capability.run',{action:'computer.read_calculator',params:{title:'Calculator'},confirmed:true});assert.equal(readAfter.status,200);assert.equal(readAfter.body.data.result.output.result,valueBefore);await halt(mission.id);
    const record={gate:'M-A-2 T9R',release,ok:true,missionId:mission.id,scope:'Manually prepared by QA outside Bunny Runtime before the tested workflow; initial machine inventory contained no actual user Calculator. The controller explicitly launched the trusted Windows launcher once, then verified the native window and package.',behavior:'Focus/reuse only; no arithmetic value changed; original native identity and result preserved. This fixture is intentionally retained and excluded from per-test cleanup.',originalPreserved:true,noNewLaunch:true,resultBefore:valueBefore,resultAfter:readAfter.body.data.result.output.result,identity:identityOf(after.targets[0]),target:targetRecord(mission.id),intentionallyRetained:true};saveRecord('preexisting-user-window-live.json',record);return record;
  },
};
for(const phase of process.argv.slice(2)) {
  console.log('T9R '+phase+' starting');assert.equal((await health()).operationalState,'healthy');
  try {await phases[phase]();console.log('T9R '+phase+' PASS');}
  catch(error){
    saveRecord(phase+'-harness-failure.json',{gate:'M-A-2 T9R',release,ok:false,error:error instanceof Error?error.message:String(error)});
    for(const id of testMissions) await halt(id);
    for(const [name,owned] of [...outstanding]) await cleanup(name,owned,[owned.targets[0].provenance.missionId]);
    throw error;
  }
}
