// Disposable loopback-only acceptance fixture. No installed state, public tunnel, firewall or live provider.
import assert from 'node:assert/strict';
import {fork,execFileSync} from 'node:child_process';
import {createServer,request as httpRequest} from 'node:http';
import {createServer as tlsServer} from 'node:https';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const evidence=resolve('test-results/ma3/t9r/continuity');
const parent=mkdtempSync(join(tmpdir(),'bunny-t9-live-'));
const data=join(parent,'state'),workspace=join(parent,'workspace'),projectA=join(parent,'project-a'),projectB=join(parent,'project-b');
for(const p of [data,workspace,projectA,projectB])mkdirSync(p);
writeFileSync(join(projectA,'seed.txt'),'T9 verified receipt');
writeFileSync(join(projectB,'secret.txt'),'Other Project fixture');
const hostPort=43559,gatewayPort=43659,phonePort=43660,tlsPort=43661;
const remoteOrigin=`https://remote.bunny.test:${phonePort}`;
const save=(name,value)=>writeFileSync(join(evidence,name),JSON.stringify(value,null,2)+'\n');
let child,ready;
const boot=async()=>{
 child=fork(resolve('test-results/ma3/t9r/held-host-worker.mjs'),[data,workspace,String(hostPort)],{execArgv:['--experimental-strip-types'],stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});child.on('message',message=>{if(message.kind==='held-write')save('held-write.json',{...message,observedAt:new Date().toISOString()});});
 ready=await new Promise((done,reject)=>{child.once('message',done);child.once('exit',()=>reject(Error('Disposable Host exited')));});
};
const closeHost=()=>new Promise((done,reject)=>{const timeout=setTimeout(()=>reject(Error('Owned fixture did not close')),10000);child.once('exit',()=>{clearTimeout(timeout);done();});child.send('close');});
const api=async(action,params={},token=ready.token,extra={})=>{
 const response=await fetch(`http://127.0.0.1:${hostPort}/command`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({action,data:params,...extra})});
 return {status:response.status,body:await response.json()};
};
const ok=async(action,params={},token=ready.token,extra={})=>{const r=await api(action,params,token,extra);assert.equal(r.status,200,r.body.error);return r.body;};
const state=async(token=ready.token)=>{const r=await fetch(`http://127.0.0.1:${hostPort}/state`,{headers:{authorization:`Bearer ${token}`}});return {status:r.status,body:await r.json()};};
const until=async(fn,label)=>{for(let i=0;i<400;i++){const v=await fn();if(v)return v;await new Promise(done=>setTimeout(done,50));}throw Error(`Timed out: ${label}`);};
const readStep=(name='Read receipt')=>({role:name,objective:name,access:'read',executor:{kind:'capability',action:'filesystem.read',params:{path:'seed.txt'}},verification:[{kind:'capability',action:'filesystem.compare',params:{path:'seed.txt',content:'T9 verified receipt'},expect:{field:'matches',equals:true}}],crossApp:true});
const writeStep={role:'Write reviewed receipt',objective:'Write the bounded result',access:'write',executor:{kind:'capability',action:'filesystem.write',params:{path:'result.txt',content:'T9 phone approved receipt'}},verification:[{kind:'capability',action:'filesystem.compare',params:{path:'result.txt',content:'T9 phone approved receipt'},expect:{field:'matches',equals:true}}],dependsOn:[0],crossApp:true};
await boot();
await ok('mission.configure',{enabled:true});
const pa=(await ok('project.add',{name:'Phone receipt studio',path:projectA})).data;
const pb=(await ok('project.add',{name:'Isolated research',path:projectB})).data;
const make=async(name,steps=[readStep(),writeStep],separate=false)=>{let projectId=pa.id;if(separate){const path=join(parent,name.toLowerCase().replaceAll(' ','-'));mkdirSync(path);writeFileSync(join(path,'seed.txt'),'T9 verified receipt');projectId=(await ok('project.add',{name,path})).data.id;}const r=await ok('agent.create',{projectId,name,objective:'Read a real Project, request permission, and independently verify the receipt.',steps});return r.snapshot.agents.agents.find(a=>a.name===name);};
const propose=async(id)=>{const r=await ok('agent.authorization.propose',{id});return r.snapshot.agents.agents.find(a=>a.id===id).authorization;};
const begin=async(id,askWrite=false)=>{let e=await propose(id);if(askWrite){const r=await ok('agent.authorization.adjust',{id,revision:e.revision,patch:{capabilities:e.capabilities.filter(c=>c!=='filesystem.write')}});e=r.snapshot.agents.agents.find(a=>a.id===id).authorization;}await ok('agent.authorization.approve',{id,revision:e.revision});};
const integrated=await make('Phone receipt Agent');await begin(integrated.id,true);
await until(async()=>{const s=(await state()).body;return s.agents.agents.find(a=>a.id===integrated.id&&a.authorization?.pending.length);},'pending write');
const review=await make('Windows approval boundary',[readStep()]);await propose(review.id);
const stop=await make('Phone Stop fixture',undefined,true);await begin(stop.id,true);
await until(async()=> (await state()).body.agents.agents.find(a=>a.id===stop.id&&a.authorization?.pending.length),'stop waiting');
const completed=await make('Verified receipt history',[readStep()],true);await begin(completed.id);
await until(async()=> (await state()).body.agents.agents.find(a=>a.id===completed.id&&a.state==='COMPLETED'),'verified history');
const denial=await make('Remote denial fixture',undefined,true);await begin(denial.id,true);
await until(async()=> (await state()).body.agents.agents.find(a=>a.id===denial.id&&a.authorization?.pending.length),'denial waiting');
process.env.BUNNY_HOST_DATA_DIRECTORY=data;process.env.BUNNY_HOST_CREDENTIALS_FILE=join(data,'credentials.json');
process.env.BUNNY_REMOTE_ORIGIN=remoteOrigin;
delete process.env.BUNNY_STATE_LAYOUT;delete process.env.BUNNY_RELEASE_ROOT;delete process.env.DATABASE_URL;
const {middleware}=await import(pathToFileURL(resolve('.output/server/index.mjs')));
const gateway=createServer((req,res)=>{res.setHeader('x-frame-options','DENY');res.setHeader('content-security-policy',"frame-ancestors 'none'");res.setHeader('referrer-policy','no-referrer');res.on('error',()=>res.destroy());Promise.resolve(middleware(req,res)).catch(()=>{res.writeHead(500);res.end('Fixture gateway error');});});
await new Promise(done=>gateway.listen(gatewayPort,'127.0.0.1',done));
const ssrFiles=readdirSync('.output/server/_ssr');
const hostFile=ssrFiles.map(f=>join('.output/server/_ssr',f)).find(f=>f.endsWith('.mjs')&&readFileSync(f,'utf8').includes('name: "commandBunnyHost"'));
const compiled=readFileSync(hostFile,'utf8');
const ids={read:compiled.match(/id: "([a-f0-9]+)",\s*name: "readBunnyHost"/)[1],command:compiled.match(/id: "([a-f0-9]+)",\s*name: "commandBunnyHost"/)[1]};
const seroval=await import('seroval');
const gatewayPair=code=>new Promise((done,reject)=>{const body=JSON.stringify({code,name:'T9 independently paired client'});const q=httpRequest({hostname:'127.0.0.1',port:gatewayPort,path:'/api/bunny-pair',method:'POST',headers:{host:`remote.bunny.test:${phonePort}`,'x-forwarded-proto':'https','content-type':'application/json',origin:remoteOrigin,'sec-fetch-site':'same-origin','content-length':Buffer.byteLength(body)}},r=>{let b='';r.on('data',x=>b+=x);r.on('end',()=>done({status:r.statusCode,headers:{get:name=>Array.isArray(r.headers[name])?r.headers[name][0]:r.headers[name]},body:b}));});q.on('error',reject);q.end(body);});
const forwardedHeaders=headers=>{const h={...headers,host:`remote.bunny.test:${phonePort}`,'x-forwarded-proto':'https'};delete h['x-bunny-actor'];delete h['x-forwarded-host'];delete h['x-forwarded-for'];delete h['cf-connecting-ip'];if(h.origin===`http://127.0.0.1:${phonePort}`)h.origin=remoteOrigin;return h;};
let browserSeeded=false;
const proxy=(req,res)=>{
 // Browser-only loopback origin has no trusted HTTPS certificate. Seed a real paired credential once
 // in this test adapter; this is not evidence of the physical-phone pairing UI or browser TLS trust.
 if(req.url==='/'&&!browserSeeded){browserSeeded=true;(async()=>{const code=(await ok('pairing.create')).pairCode;const r=await gatewayPair(code);assert.equal(r.status,200,r.body);save('live-browser-device.json',JSON.parse(r.body));const cookie=r.headers.get('set-cookie');res.setHeader('set-cookie',cookie);req.headers.cookie=cookie.split(';')[0];proxy(req,res);})().catch(()=>{res.writeHead(500);res.end('Test adapter enrollment failed');});return;}
 if(req.url==='/__fixture/pair'){
  (async()=>{
   const code=(await ok('pairing.create')).pairCode;
   const r=await gatewayPair(code);
   assert.equal(r.status,200);res.writeHead(302,{'set-cookie':r.headers.get('set-cookie'),location:'/'});res.end();
  })().catch(()=>{res.writeHead(500);res.end('Fixture pairing failed');});return;
 }
 const upstream=httpRequest({hostname:'127.0.0.1',port:gatewayPort,path:req.url,method:req.method,headers:forwardedHeaders(req.headers)},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});req.on('close',()=>{if(!req.complete)upstream.destroy();});res.on('close',()=>upstream.destroy());req.pipe(upstream);
};
const phone=createServer(proxy);await new Promise(done=>phone.listen(phonePort,'127.0.0.1',done));
const cert=join(parent,'cert.pem'),key=join(parent,'key.pem');
execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=remote.bunny.test','-addext','subjectAltName=DNS:remote.bunny.test,IP:127.0.0.1'],{stdio:'ignore',windowsHide:true});
const tls=tlsServer({key:readFileSync(key),cert:readFileSync(cert)},proxy);await new Promise(done=>tls.listen(tlsPort,'127.0.0.1',done));
save('live-fixture.json',{classification:'LIVE disposable Windows Host and built gateway; browser transport SIMULATED by loopback TLS-termination adapter',parent,data,workspace,projectA,projectB,projectId:pa.id,otherProjectId:pb.id,hostPort,gatewayPort,phonePort,tlsPort,remoteOrigin,certPath:cert,ids,integratedAgent:integrated.id,reviewAgent:review.id,stopAgent:stop.id,completedAgent:completed.id,denialAgent:denial.id,providerCalls:0,physicalPhone:false,publicTunnel:false});
save('live-initial-state.json',(await state()).body);
console.log('T9 fixture ready: disposable Host, built gateway, independently authenticated loopback phone adapter.');
let busy=false;
const timer=setInterval(async()=>{
 if(busy)return;const commandPath=join(evidence,'fixture-request.json');if(!existsSync(commandPath))return;
 const request=JSON.parse(readFileSync(commandPath));if(existsSync(join(evidence,`fixture-response-${request.id}.json`)))return;busy=true;
 try{
  let result;
  if(request.action==='restart'){
   const before=(await state()).body;const oldPid=ready.pid;await closeHost();await new Promise(done=>setTimeout(done,6500));await boot();const after=(await state()).body;
   result={before,after,oldPid,newPid:ready.pid,oldEpoch:before.hostIdentity.epoch,newEpoch:after.hostIdentity.epoch,stableHostId:before.hostIdentity.hostId===after.hostIdentity.hostId};
  }else if(request.action==='disconnect'){await closeHost();result={disconnected:true};}
  else if(request.action==='reconnect'){await boot();result={reconnected:true};}
  else if(request.action==='release-held'){child.send('release-held');result={released:true};}else if(request.action==='snapshot')result=(await state()).body;
  // Phone-only network loss: close only the test client's transport listeners and sockets. Host and gateway stay up.
  else if(request.action==='client-network-off'){for(const s of [phone,tls]){s.closeAllConnections();await new Promise(done=>s.close(()=>done()));}result={clientTransport:'closed',hostPid:ready.pid,hostRunning:true,at:new Date().toISOString()};}
  else if(request.action==='client-network-on'){await new Promise(done=>phone.listen(phonePort,'127.0.0.1',done));await new Promise(done=>tls.listen(tlsPort,'127.0.0.1',done));result={clientTransport:'open',hostPid:ready.pid,at:new Date().toISOString()};}
  else if(request.action==='close'){clearInterval(timer);await closeHost();for(const s of [phone,tls,gateway]){s.closeAllConnections();s.close();}result={closed:true};save(`fixture-response-${request.id}.json`,result);process.exit(0);}
  else result=await api(request.action,request.data??{});
  save(`fixture-response-${request.id}.json`,result);
 }catch(e){save(`fixture-response-${request.id}.json`,{error:e.message});}finally{busy=false;}
},200);
