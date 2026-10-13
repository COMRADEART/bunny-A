import assert from 'node:assert/strict';
import {chain,capStep,cmd,createMission,approveMission,waitOpenRequest,respond,getMission,until,saveRecord} from './live-client.ts';
const open=()=>capStep('Acquire','computer.open_app',{app:'calculator'},'Reuse the test-owned target');
const m=await createMission({title:'R1 finite time refresh',objective:'Expiry must end authority without duplicating a target.',steps:chain([open(),open(),open()])});
try {
 await approveMission(m.id);let ask=await waitOpenRequest(m.id);assert.equal((await respond(ask.id,'allow_once')).status,200);
 ask=await waitOpenRequest(m.id);assert.equal((await respond(ask.id,'allow_batch',{ttlMs:1000})).status,200);
 let settled=await until(async()=>{const d=await getMission(m.id);return d.mission.state==='failed'||d.mission.requests.some(r=>r.resolvedAt===null)?d:null;},'Expiry or contained in-flight expiry');
 const contained=settled.mission.state==='failed';if(contained)assert.equal((await cmd('mission.retry',{id:m.id})).status,200);
 const fresh=await waitOpenRequest(m.id,{action:'computer.open_app'});const expired=await getMission(m.id);assert.equal(expired.mission.batch,null);
 assert.equal((await respond(fresh.id,'allow_batch')).status,200);
 const done=await until(async()=>{const d=await getMission(m.id);return ['completed','failed','stopped'].includes(d.mission.state)?d:null;},'Fresh timed approval');assert.equal(done.mission.state,'completed');
 assert.ok(done.runs.filter(r=>r.action==='computer.open_app').every((r:any)=>!r.evidence.some((s:string)=>s.startsWith('Calculator target launched:'))));
 saveRecord('finite-time-stage.json',{recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',missionId:m.id,allowOncePreserved:true,explicitBatchTtlMs:1000,expiryEndedGrant:true,containedInFlightFailure:contained,explicitRetryRequired:contained,freshRequestId:fresh.id,freshApprovalCompleted:true,noAdditionalLaunch:true,events:done.events});
}finally{await cmd('mission.stop',{id:m.id});}
