import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getMission,respond,health,saveRecord,cmd} from './live-client.ts';
const before=JSON.parse(readFileSync('test-results/ma2-gate10/restart-active-before-v24.json','utf8'));
const current=await health();assert.notEqual(current.instanceId,before.health.instanceId);assert.equal(current.operationalState,'healthy');
const after=await getMission(before.missionId);assert.equal(after.runs.length,before.runCount);assert.equal(after.mission.batch,null);assert.ok((await respond(before.oldRequestId,'allow_batch')).status>=400);assert.ok((await respond(before.pendingRequestId,'allow_once')).status>=400);assert.equal(after.mission.state,'waiting_for_user');assert.ok(after.events.some(e=>/interrupt|restart|recover/i.test(e.type+' '+e.detail)));
assert.equal((await cmd('mission.stop',{id:before.missionId})).status,200);
saveRecord('restart-verified-v24.json',{recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',attackIds:['T10-T3-04','T10-T3-05','T10-T9-07','T10-XG-05','T10-XG-06','T10-XG-13'],beforeHealth:before.health,afterHealth:current,missionId:before.missionId,runCountBefore:before.runCount,runCountAfter:after.runs.length,noGuiReplay:true,grantDidNotRevive:true,oldRequestsRefused:true,recoveredMissionRequiresUser:true,events:after.events});
console.log('Installed staged hard-crash recovery has no GUI replay, no revived grant, and no stale approval authority.');
