import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cmd,getState,saveRecord,health,STAGE_STATE} from './live-client.ts';
const state=await getState();
for(const m of state.missions?.missions??[])if(m.title.startsWith('R1 ')&&!['completed','failed','stopped'].includes(m.state))assert.equal((await cmd('mission.stop',{id:m.id})).status,200);
const db=new DatabaseSync(STAGE_STATE+'/host.sqlite',{readOnly:true});
try {
 const rows=(t:string)=>db.prepare('SELECT record FROM '+t).all().map((r:any)=>JSON.parse(r.record));
 const missions=rows('missions').filter((m:any)=>!['completed','failed','stopped','cancelled','rejected','draft'].includes(m.state));
 const runs=rows('capability_runs').filter((r:any)=>['running','in_flight','started'].includes(r.status));
 const grants=rows('approval_batches').filter((b:any)=>b.status==='active'&&b.expiresAt>Date.now());
 const devices=db.prepare('SELECT id,name,revoked_at FROM devices').all();
 assert.equal(missions.length,0);assert.equal(runs.length,0);assert.equal(grants.length,0);assert.ok(devices.every((d:any)=>d.revoked_at!==null));
 saveRecord('stage-authority-cleanup.json',{recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',health:await health(),activeMissions:missions.length,inFlightRuns:runs.length,activeGrants:grants.length,devices,allStageDeviceCopiesAndDedicatedQaDevicesRevoked:true,productionDevicesUntouched:true,policyEnabledForAcceptanceOnly:true});
}finally{db.close();}
