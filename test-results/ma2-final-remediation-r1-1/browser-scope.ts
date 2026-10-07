import assert from 'node:assert/strict';
import {chain,capStep,cmd,createMission,approveMission,waitOpenRequest,respond,getMission,saveRecord} from './live-client.ts';
const m=await createMission({title:'R11 browser inheritance refusal',objective:'Computer approval must not authorize a browser mutation; separate probe remains unapproved.',steps:chain([capStep('Acquire','computer.open_app',{app:'calculator'},'Reuse sole owned Calculator'),capStep('Acquire again','computer.open_app',{app:'calculator'},'Reuse same owned Calculator'),capStep('Escape','browser.click',{role:'button',name:'R11 NEVER EXECUTE'},'Separate browser mutation requires fresh authority')])});
try {
 await approveMission(m.id);const ask=await waitOpenRequest(m.id);assert.ok(ask.batchOffer);assert.equal((await respond(ask.id,'allow_batch')).status,200);
 const denied=await waitOpenRequest(m.id,{action:'browser.click'});assert.equal(denied.batchOffer,null);const detail=await getMission(m.id);assert.equal(detail.runs.filter(r=>r.action==='browser.click').length,0);
 saveRecord('browser-scope.json',{recordedAt:new Date().toISOString(),classification:'LIVE VERIFIED harmless unapproved probe',missionId:m.id,computerBatchDidNotAuthorizeBrowser:true,separateRequestRequired:true,noBrowserMutationExecuted:true,detail});
} finally {await cmd('mission.stop',{id:m.id});}
