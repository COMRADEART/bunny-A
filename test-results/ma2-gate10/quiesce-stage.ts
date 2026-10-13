import assert from 'node:assert/strict';
import {getState,cmd,saveRecord,health} from './live-client.ts';
const state=await getState();let stopped=0;
for(const mission of state.missions?.missions??[])if(!['completed','failed','stopped','draft'].includes(mission.state)){assert.equal((await cmd('mission.stop',{id:mission.id})).status,200);stopped++;}
saveRecord('v24-pre-retest-quiesced.json',{recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',health:await health(),stoppedMissions:stopped,productionTouched:false});
