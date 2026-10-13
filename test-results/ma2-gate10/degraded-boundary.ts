import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const release='C:/Users/allam/AppData/Local/Bunny-A-T10-stage/releases/Bunny-A-Windows-v24-T10';
const {startHost}=await import(pathToFileURL(join(release,'src/lib/bunny-host/http.server.ts')).href);
const {HostContainment}=await import(pathToFileURL(join(release,'src/lib/bunny-host/failure.server.ts')).href);
const directory=mkdtempSync(join(tmpdir(),'bunny-t10-degraded-'));
const containment=new HostContainment({diagnosticDirectory:join(directory,'logs'),runtimeDirectory:join(directory,'runtime')});
const host=await startHost({dataDirectory:directory,root:directory,port:45169,adapters:[],containment});
const base='http://127.0.0.1:45169';const cmd=(action:string,data:any={},token=host.token)=>fetch(base+'/command',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action,data})});
try{
 assert.equal((await fetch(base+'/state',{headers:{authorization:'Bearer '+host.token}})).status,200);
 const code=(await (await cmd('pairing.create')).json()).pairCode;
 const pair=await fetch(base+'/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,name:'T10 degraded disposable'})});assert.equal(pair.status,200);const device=await pair.json();
 containment.degrade('*','T10 deliberate disposable failure; new work must refuse.');
 const observations=[];
 for(const [label,token] of [['paired',device.token],['workstation',host.token]]){const response=await cmd('submit',{prompt:'Must not execute',mode:'fast'},token);const body=await response.json();assert.equal(response.status,503);assert.match(body.error,/cannot safely accept.*Host operational health/i);observations.push({label,status:response.status,refused:true});}
 const publicResponse=await fetch(base+'/command',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':'127.0.0.1'},body:JSON.stringify({action:'submit',data:{prompt:'Must not execute',mode:'fast'}})});assert.equal(publicResponse.status,401);
 assert.equal(host.manager.db.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0);
 writeFileSync('test-results/ma2-gate10/degraded-boundary-v24.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',attackId:'T10-XG-09',exactInstalledHostCode:true,degradationInjected:true,authenticatedPositiveState:200,publicUnauthenticatedStatus:401,noTaskAdmitted:true,observations,publicHttpsDegradation:'NOT TESTED; production disruption not authorized'},null,2)+'\n');
}finally{await host.close();rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
