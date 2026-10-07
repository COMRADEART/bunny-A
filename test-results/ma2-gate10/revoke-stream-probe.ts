import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startHost} from '../../src/lib/bunny-host/http.server.ts';
const directory=mkdtempSync(join(tmpdir(),'bunny-t10-sse-'));
const host=await startHost({dataDirectory:directory,port:45139,root:directory,adapters:[]});
const base='http://127.0.0.1:45139',abort=new AbortController();
const command=(action:string,data:unknown={},token=host.token)=>fetch(base+'/command',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action,data})});
try {
  const code=(await (await command('pairing.create')).json()).pairCode;
  const paired=await fetch(base+'/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,name:'T10 disposable stream probe'})});assert.equal(paired.status,200);const device=await paired.json();
  const initial=await fetch(base+'/state',{headers:{authorization:'Bearer '+device.token}});assert.equal(initial.status,200);
  const stream=await fetch(base+'/events',{headers:{authorization:'Bearer '+device.token},signal:abort.signal});assert.equal(stream.status,200);const reader=stream.body!.getReader();await reader.read();
  assert.equal((await command('device.revoke',{id:device.deviceId})).status,200);
  assert.equal((await fetch(base+'/state',{headers:{authorization:'Bearer '+device.token}})).status,401);
  host.manager.emit(host.manager.db.event('t10.safe_probe',null,'T10_POST_REVOKE_SAFE_MARKER'));
  let text='',closed=false;
  const deadline=Date.now()+2000;
  while(Date.now()<deadline){try{const next=await Promise.race([reader.read(),new Promise<null>(r=>setTimeout(()=>r(null),250))]);if(next===null)break;if(next.done){closed=true;break;}text+=new TextDecoder().decode(next.value);}catch{closed=true;break;}if(text.includes('T10_POST_REVOKE_SAFE_MARKER'))break;}
  const record={gate:'M-A-2 T10',attackId:'T10-T6-04',classification:'DISPOSABLE LIVE',positiveControl:{pairedState:200,authenticatedSse:200},freshStateAfterRevoke:401,futureProtectedEventAfterRevoke:text.includes('T10_POST_REVOKE_SAFE_MARKER'),streamClosed:closed,deviceTokenRecorded:false,productionTouched:false};
  writeFileSync('test-results/ma2-gate10/'+(process.argv[2]??'revoke-stream-probe.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
}finally{abort.abort();await host.close();rmSync(directory,{recursive:true,force:true});}
