import assert from 'node:assert/strict';
import {BASE,cmd,health,saveRecord} from './live-client.ts';
const abort=new AbortController();let device:any;
try{
 const code=(await cmd('pairing.create')).body.pairCode;
 const paired=await fetch(BASE+'/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,name:'T10 final installed stream fixture'})});assert.equal(paired.status,200);device=await paired.json();
 const headers={authorization:'Bearer '+device.token};assert.equal((await fetch(BASE+'/state',{headers})).status,200);
 const response=await fetch(BASE+'/events?after=1000000000',{headers,signal:abort.signal});assert.equal(response.status,200);const reader=response.body!.getReader();assert.ok((await reader.read()).value?.length);
 // Start an outstanding read before revocation; it must finish as EOF, rather than emit a protected event.
 const future=reader.read().then(value=>({closed:value.done===true,errorClass:null}),error=>({closed:error instanceof TypeError,errorClass:error.name}));assert.equal((await cmd('device.revoke',{id:device.deviceId})).status,200);
 const result=await Promise.race([future,new Promise<null>(r=>setTimeout(()=>r(null),2000))]);assert.ok(result?.closed,'Existing authenticated stream closes on revocation');
 const stateAfter=await fetch(BASE+'/state',{headers});assert.equal(stateAfter.status,401);
 saveRecord('installed-stream-retest-v24.json',{recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',attackIds:['T10-T6-03','T10-T6-04','T10-T6-05'],health:await health(),positive:{pairedState:200,authenticatedSse:200},freshStateAfterRevoke:401,existingStreamClosed:true,futureProtectedDelivery:false,deviceId:device.deviceId,tokenRecorded:false});
}finally{abort.abort();if(device)await cmd('device.revoke',{id:device.deviceId});}
