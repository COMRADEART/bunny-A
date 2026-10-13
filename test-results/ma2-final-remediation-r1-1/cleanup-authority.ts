import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,existsSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cmd,health,REC,STAGE_STATE,STAGE_WORKSPACE,saveRecord} from './live-client.ts';
const pre=JSON.parse(readFileSync(REC+'/preflight/protected-row-ledger.json','utf8'));
const own=new Set<string>();
const collect=(v:any)=>{if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){if(k==='missionId'&&typeof x==='string')own.add(x);if(k==='mission'&&typeof x==='object'&&x&&(x as any).title?.startsWith('R11 '))own.add((x as any).id);collect(x);}};
for(const f of readdirSync(REC))if(f.endsWith('.json')){try{collect(JSON.parse(readFileSync(REC+'/'+f,'utf8').replace(/^\uFEFF/,'')));}catch{}}
const db=new DatabaseSync(STAGE_STATE+'/host.sqlite',{readOnly:true});
const rows=(t:string)=>db.prepare('SELECT record FROM '+t).all().map((r:any)=>JSON.parse(r.record));
try {
 const missions=rows('missions');
 const ours=missions.filter((m:any)=>own.has(m.id)&&m.title.startsWith('R11 ')&&!(m.id in pre.tables.missions.rows));
 const stopped=[];
 for(const m of ours)if(!['completed','failed','stopped','cancelled','rejected','draft'].includes(m.state)){assert.equal((await cmd('mission.stop',{id:m.id})).status,200);stopped.push(m.id);}
 const active=rows('missions').filter((m:any)=>!['completed','failed','stopped','cancelled','rejected','draft'].includes(m.state));
 const runs=rows('capability_runs').filter((r:any)=>['running','in_flight','started','queued'].includes(r.status));
 const batches=rows('approval_batches').filter((b:any)=>b.status==='active'&&b.expiresAt>Date.now());
 const requests=rows('permission_requests').filter((r:any)=>own.has(r.missionId)&&r.resolvedAt===null);
 const devices=db.prepare('SELECT id,name,revoked_at FROM devices').all();
 const qa=devices.filter((d:any)=>!pre.devices.some((p:any)=>p.id===d.id));
 for(const d of qa)if(d.revoked_at===null)assert.equal((await cmd('device.revoke',{deviceId:d.id})).status,200);
 const after=db.prepare('SELECT id,name,revoked_at FROM devices').all();
 const finalQA=after.filter((d:any)=>!pre.devices.some((p:any)=>p.id===d.id));
 assert.equal(active.length,0);assert.equal(runs.length,0);assert.equal(batches.length,0);assert.equal(requests.length,0);assert.ok(finalQA.every((d:any)=>d.revoked_at!==null));
 const markers=[];
 for(const name of ['r11-only-postcondition.txt','t10-revoke-barrier.txt']){const p=STAGE_WORKSPACE+'/'+name;if(existsSync(p)){const bytes=readFileSync(p);assert.equal(bytes.toString(),'ready');markers.push({name,sha256:createHash('sha256').update(bytes).digest('hex'),provenance:'native-matrix.ts explicitly authored finite postcondition barrier',removed:true});unlinkSync(p);}}
 saveRecord('production-authority-cleanup.json',{recordedAt:new Date().toISOString(),classification:'LIVE VERIFIED',health:await health(),ownedFixtureMissionIds:ours.map((m:any)=>m.id),stoppedDuringCleanup:stopped,activeMissions:active.length,inFlightRuns:runs.length,activeGrants:batches.length,pendingTestRequests:requests.length,temporaryDevices:finalQA,allQADevicesRevoked:true,phonePreserved:true,markerCleanup:markers,noUnrelatedWorkStopped:true});
}finally{db.close();}
