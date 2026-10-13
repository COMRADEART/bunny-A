import assert from 'node:assert/strict';
import {BASE,cmd,health,saveRecord,bearer,get} from './live-client.ts';
const abort=new AbortController();let device:any,taskId:string|undefined;
try {
 const before=await get<any>('/state'),cursor=before.body.cursor??1000000000;
 const code=(await cmd<any>('pairing.create')).body.pairCode;
 const response=await fetch(BASE+'/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,name:'R11 dedicated stage SSE device'})});assert.equal(response.status,200);device=await response.json();
 const headers={authorization:'Bearer '+device.token};assert.equal((await fetch(BASE+'/state',{headers})).status,200);
 const stream=await fetch(BASE+'/events?after=1000000000',{headers,signal:abort.signal});assert.equal(stream.status,200);const reader=stream.body!.getReader();await reader.read();
 let futureBytes=0;const ended=(async()=>{for(;;){const next=await reader.read();if(next.done)return true;futureBytes+=next.value.length;}})().catch(()=>true);
 const workstation=await fetch(BASE+'/events?after='+cursor,{headers:{authorization:'Bearer '+bearer()},signal:abort.signal});assert.equal(workstation.status,200);const liveReader=workstation.body!.getReader();await liveReader.read();
 assert.equal((await cmd('device.revoke',{id:device.deviceId})).status,200);
 assert.equal(await Promise.race([ended,new Promise<boolean>(r=>setTimeout(()=>r(false),3000))]),true,'Existing stream must close on revocation');
 const submitted=await cmd<any>('submit',{prompt:'R11 harmless post-revocation protected event',mode:'fast'});assert.equal(submitted.status,200);taskId=submitted.body.task?.id??submitted.body.data?.id??submitted.body.snapshot?.tasks?.[0]?.id;
 const next=await Promise.race([liveReader.read(),new Promise<null>(r=>setTimeout(()=>r(null),3000))]);assert.ok(next&&!next.done&&next.value.length,'Workstation stream remains authorized');
 assert.equal(futureBytes,0);const readDenied=(await fetch(BASE+'/state',{headers})).status;
 const commandDenied=(await fetch(BASE+'/command',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'approve',data:{id:'invalid-r1-no-execution'}})})).status;
 const reconnectDenied=(await fetch(BASE+'/events',{headers})).status;assert.equal(readDenied,401);assert.equal(commandDenied,401);assert.equal(reconnectDenied,401);
 saveRecord('sse-revocation-stage.json',{recordedAt:new Date().toISOString(),classification:'LIVE VERIFIED authorized harmless production fixture',health:await health(),dedicatedDeviceId:device.deviceId,authorizedStreamPositive:true,revokedExistingStreamClosed:true,safeLaterProtectedEventGenerated:true,noFutureProtectedDelivery:futureBytes===0,workstationStreamSurvived:true,readDenied,commandDenied,reconnectDenied,rawCredentialsRecorded:false,productionPhoneUsed:false});
} finally {abort.abort();if(device)await cmd('device.revoke',{id:device.deviceId});if(taskId)await cmd('stop',{id:taskId});}
