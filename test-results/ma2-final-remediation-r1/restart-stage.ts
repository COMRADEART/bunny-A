import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {chain,capStep,cmd,createMission,approveMission,waitOpenRequest,respond,getMission,getState,saveRecord,health,bearer,STAGE_STATE,STAGE_ROOT,REC} from './live-client.ts';
const phase=process.argv[2];
if(phase==='prepare') {
  const prior=JSON.parse(readFileSync(REC+'/restart-before-v26.json','utf8'));
  await cmd('mission.stop',{id:prior.missionId});
  for(const m of (await getState()).missions?.missions??[]) if(m.title==='R1 fresh restart boundary'&&!['completed','failed','stopped'].includes(m.state)) await cmd('mission.stop',{id:m.id});
  const open=()=>capStep('Acquire','computer.open_app',{app:'calculator'},'Reuse the test-owned Calculator');
  const m=await createMission({title:'R1 fresh restart boundary',objective:'Harmless restart audit; never approve the separate typing request.',steps:chain([open(),capStep('Pause','computer.type',{title:'Calculator',name:'Never execute',text:'R1_RESTART_NOT_EXECUTED'},'Never approve this separate request'),open()])});
  await approveMission(m.id);
  const ask=await waitOpenRequest(m.id);
  assert.equal((await respond(ask.id,'allow_batch')).status,200);
  const pending=await waitOpenRequest(m.id,{action:'computer.type'});
  const d=await getMission(m.id);
  assert.equal(d.mission.batch?.status,'active');
  assert.equal(d.mission.batch?.usedCount,1);
  const config=JSON.parse(readFileSync(STAGE_ROOT+'/install.json','utf8'));
  const {idleCheck}=await import(pathToFileURL(config.currentRelease.folder+'/scripts/bunny-rollback-preflight.mjs').href);
  let refusal='';try{await idleCheck(46129,bearer(),STAGE_STATE);}catch(e){refusal=(e as Error).message;}
  assert.match(refusal,/active-work/);
  saveRecord('restart-active-before.json',{recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',missionId:m.id,health:await health(),oldRequestId:ask.id,pendingRequestId:pending.id,runCount:d.runs.length,batch:d.mission.batch,rollbackPreflightRefusal:refusal,detail:d});
} else if(phase==='verify') {
  const before=JSON.parse(readFileSync(REC+'/restart-active-before.json','utf8'));
  const current=await health();
  assert.notEqual(current.instanceId,before.health.instanceId);
  assert.equal(current.operationalState,'healthy');
  const after=await getMission(before.missionId);
  assert.equal(after.runs.length,before.runCount);
  assert.equal(after.mission.batch,null);
  const oldResponse=await respond(before.oldRequestId,'allow_batch');
  const pendingResponse=await respond(before.pendingRequestId,'allow_once');
  assert.ok(oldResponse.status>=400);assert.ok(pendingResponse.status>=400);
  assert.equal(after.mission.state,'waiting_for_user');
  assert.ok(after.events.some(e=>/interrupt|restart|recover/i.test(e.type+' '+e.detail)));
  assert.equal((await cmd('mission.stop',{id:before.missionId})).status,200);
  saveRecord('restart-approval-stage.json',{recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',exactInstalledRuntime:true,beforeHealth:before.health,afterHealth:current,missionId:before.missionId,runCountBefore:before.runCount,runCountAfter:after.runs.length,noGuiReplay:true,grantDidNotRevive:true,oldRequestsRefused:true,statuses:[oldResponse.status,pendingResponse.status],recoveredMissionRequiresUser:true,events:after.events});
} else throw new Error('Unknown phase');
