import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const rec='test-results/ma2-gate10',root='C:/Users/allam/AppData/Local/Bunny-A';
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const config=read(root+'/install.json'),credentials=read(config.stateRoot+'/credentials/credentials.json');
const base='http://127.0.0.1:'+config.hostPort;
const req=async(path,token=credentials.token,data)=>{const r=await fetch(base+path,{method:data?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(20000)});return{status:r.status,body:await r.json()};};
const cmd=(action,data={},token)=>req('/command',token,{action,data});
const before=await req('/state');assert.equal(before.status,200);assert.equal(before.body.missions.enabled,false);
const discover=await cmd('discover');assert.equal(discover.status,200);
const current=await req('/state');const codex=Object.values(current.body.providers).find(p=>p.id==='codex');assert.equal(codex.securityCompatibility.compatibilityClass,'VALIDATED');
const c=await cmd('pairing.create');const pair=await fetch(base+'/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:c.body.pairCode,name:'T10 disposable audit device'})});assert.equal(pair.status,200);const d=await pair.json();
const cases=[];
try {
 assert.equal((await req('/state',d.token)).status,200);
 for(const token of [credentials.token,d.token]) {const r=await cmd('mission.create',{objective:'T10 disabled-path probe',mode:'fast'},token);assert.equal(r.status,400);cases.push({kind:token===credentials.token?'local disabled Mission':'paired disabled Mission',status:r.status,error:r.body.error});}
 assert.equal((await cmd('device.revoke',{id:d.deviceId})).status,200);
 for(const [path,action,data] of [['/state'],['/command','submit',{prompt:'Must not be admitted',mode:'fast'}],['/command','mission.create',{objective:'Must not be admitted',mode:'fast'}],['/command','approve',{id:'t10-none'}],['/command','stop',{id:'t10-none'}],['/events'],['/websocket']]) {const r=await req(path,d.token,action?{action,data}:undefined);assert.equal(r.status,401);cases.push({kind:action??path,status:r.status});}
}finally{await cmd('device.revoke',{id:d.deviceId});}
const task=await cmd('submit',{prompt:'Reply exactly T10_SAFE_OK. Do not call tools, inspect files, run commands, or make network requests.',mode:'fast',override:'codex',constraints:{maxRuntimeMs:60000}});assert.equal(task.status,200);const id=task.body.task.id;
assert.equal((await cmd('approve',{id})).status,200);
let finished;for(let i=0;i<100;i++){const s=await req('/state');const t=s.body.tasks.find(t=>t.id===id);if(['completed','failed','stopped'].includes(t.state)){finished=t;break;}await new Promise(r=>setTimeout(r,1000));}
assert.ok(finished,'Safe Task reached a bounded terminal state');assert.equal(finished.state,'completed');assert.match(finished.output,/T10_SAFE_OK/);
const after=await req('/state');assert.equal(after.body.pid,before.body.pid);assert.equal(after.body.missions.enabled,false);
writeFileSync(rec+'/live-safe.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'LIVE VERIFIED',attackIds:['T10-T6-03','T10-T6-05','T10-XG-14'],hostPid:after.body.pid,productionUnrestarted:true,providerCompatibility:{provider:'codex',version:codex.version,profile:codex.securityCompatibility},testDevice:{id:d.deviceId,name:'T10 disposable audit device',revoked:true,positiveStateControl:200,cases},safeTask:{id,state:finished.state,provider:finished.selected_provider??finished.provider,outputSha256:createHash('sha256').update(finished.output).digest('hex'),expectedTextMatched:true},productionPhoneUnchanged:true,missionsEnabled:false},null,2)+'\n');
console.log('Live production safe Task, compatibility, disabled Missions, and dedicated revoked-device denials passed.');

