// Independently paired test client; no workstation token used for this scoped answer.
import assert from 'node:assert/strict';
import {request} from 'node:https';
import {readFileSync,writeFileSync} from 'node:fs';
import {toJSON,fromCrossJSON} from 'seroval';
const dir='test-results/ma3/t9r/protocol',f=JSON.parse(readFileSync(dir+'/live-fixture.json')),ca=readFileSync(f.certPath);
const call=(path,method='GET',headers={},body='')=>new Promise((done,reject)=>{const q=request({hostname:'127.0.0.1',port:f.tlsPort,path,method,ca,headers:{'sec-fetch-site':'same-origin',...headers,...(body?{'content-length':Buffer.byteLength(body)}:{})}},r=>{let text='';r.on('data',b=>text+=b);r.on('end',()=>done({status:r.statusCode,headers:r.headers,text}));});q.on('error',reject);q.end(body);});
const paired=await call('/__fixture/pair');assert.equal(paired.status,302);const cookie=paired.headers['set-cookie'][0].split(';')[0];
const wire=async(id,data)=>{const r=await call('/_serverFn/'+id,'POST',{cookie,origin:f.remoteOrigin,'content-type':'application/json','x-tsr-serverFn':'true'},JSON.stringify(toJSON({data})));return fromCrossJSON(JSON.parse(r.text),{refs:new Map()}).result;};
const before=await wire(f.ids.read,{}),agent=before.snapshot.agents.agents.find(a=>a.id===f.integratedAgent),ask=agent.authorization.pending[0];
assert.equal(ask.action,'filesystem.write');assert.equal(ask.remote.answerable,true);
const answer=await wire(f.ids.command,{action:'mission.respond',data:{requestId:ask.id,decision:'allow_once'},expect:before.snapshot.hostIdentity});assert.equal(answer.ok,true);
const deadline=Date.now()+15000;let current;
do{current=await wire(f.ids.read,{});if(current.snapshot.agents.agents.find(a=>a.id===agent.id)?.state==='COMPLETED')break;await new Promise(done=>setTimeout(done,100));}while(Date.now()<deadline);
const completed=current.snapshot.agents.agents.find(a=>a.id===agent.id);assert.equal(completed.state,'COMPLETED');assert.equal(completed.missionId,agent.missionId);
writeFileSync(dir+'/paired-scoped-completion.json',JSON.stringify({result:'PASS',classification:'LIVE paired credential, trusted TLS client, built gateway and real Host; SIMULATED loopback enrollment/transport',viewer:before.snapshot.viewer,hostIdentity:before.snapshot.hostIdentity,agentId:completed.id,missionId:completed.missionId,requestId:ask.id,state:completed.state,workstationTokenUsed:false},null,2)+'\n');
console.log('Independent paired client completed the exact scoped Host request: PASS.');
