// M-A-3 T12: copied from t11/package-boot.mjs; adds the packaged full-duplex acceptance: the packaged Host opens hands-free,
// the packaged worker opens the echo-cancelled microphone (Windows Voice Capture DSP) and keeps capturing while it speaks.
import assert from 'node:assert/strict';
import {fork,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyRelease,importClosure,sourceCheck} from '../../../scripts/bunny-release.mjs';
const evidence=resolve('test-results/ma3/t12'),pkg=resolve(process.env.T12_PACKAGE_DIRECTORY ?? join(evidence,'windows-package-final/Bunny-A-Windows-MA3-T12-TEST'));
const manifest=JSON.parse(readFileSync(join(pkg,'release-manifest.json'))),source=process.env.T12_SOURCE;
assert.match(String(source),/^[0-9a-f]{40}$/);assert.equal(manifest.sourceCommit,source);assert.equal(manifest.toolingCommit,source);assert.equal(manifest.version,'1.0.0-MA3-T12-TEST');
const validation={manifest:verifyRelease(pkg),closure:importClosure(pkg),source:sourceCheck(resolve('.'),pkg)};
const parent=mkdtempSync(join(tmpdir(),'bunny-t12-package-runtime-')),state=join(parent,'state'),workspace=join(parent,'workspace');
mkdirSync(state);mkdirSync(workspace);
const node=join(pkg,'runtime/node.exe');assert.ok(existsSync(node));
const init=join(parent,'init.mjs');
writeFileSync(init,`import {HostDatabase} from ${JSON.stringify(pathToFileURL(join(pkg,'src/lib/bunny-host/persistence.server.ts')).href)};
import {createHash,randomBytes} from 'node:crypto';import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const state=${JSON.stringify(state)},db=new HostDatabase(join(state,'host.sqlite'));
const schema=db.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();db.close();
for(const name of ['credentials','settings','runtime','logs','backups','cloudflared','sessions'])mkdirSync(join(state,name));
writeFileSync(join(state,'state-layout.json'),JSON.stringify({schema:'bunny-state/2',stateRoot:state,databaseUserVersion:3,databaseSchemaSha256:createHash('sha256').update(JSON.stringify(schema)).digest('hex')}));
writeFileSync(join(state,'credentials/credentials.json'),JSON.stringify({token:randomBytes(32).toString('base64url')}));
writeFileSync(join(state,'settings/remote.json'),'{}');`);
execFileSync(node,['--experimental-strip-types',init],{windowsHide:true,stdio:'pipe'});
const socket=createServer();await new Promise(done=>socket.listen(0,'127.0.0.1',done));const port=socket.address().port;await new Promise(done=>socket.close(done));
const wrapper=join(parent,'boot.mjs');
writeFileSync(wrapper,`const {host}=await import(${JSON.stringify(pathToFileURL(join(pkg,'Bunny-Host.mjs')).href)});if(!host)throw Error('Packaged entry failed');
process.send({pid:process.pid,token:host.token});process.on('message',message=>{if(message==='close')void host.close().then(()=>process.exit(0));});`);
const env={...process.env,BUNNY_STATE_LAYOUT:'2',BUNNY_HOST_DATA_DIRECTORY:state,BUNNY_HOST_WORKSPACE:workspace,BUNNY_HOST_PORT:String(port),BUNNY_HOST_CREDENTIALS_FILE:join(state,'credentials/credentials.json'),BUNNY_REMOTE_CONFIG:join(state,'settings/remote.json')};
delete env.DATABASE_URL;delete env.BUNNY_RELEASE_ROOT;delete env.BUNNY_REMOTE_ORIGIN;
const startedAt=new Date().toISOString(),child=fork(wrapper,[],{execPath:node,execArgv:['--experimental-strip-types'],cwd:parent,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
let log='';child.stdout.on('data',bytes=>{log+=bytes;});child.stderr.on('data',bytes=>{log+=bytes;});
let forced=false;let packagedVoice=null;let packagedDuplex=null;let packagedTeam=null;
try {
 const ready=await Promise.race([new Promise((done,reject)=>{child.once('message',done);child.once('exit',code=>reject(Error('Owned packaged Host exited '+code)));}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Packaged Host readiness deadline')),45000))]);
 const response=await fetch(`http://127.0.0.1:${port}/state`,{headers:{authorization:'Bearer '+ready.token}});assert.equal(response.status,200);const snapshot=await response.json();
 assert.equal(snapshot.release.sourceCommit,source);assert.equal(snapshot.release.version,manifest.version);assert.equal(snapshot.tasks.length,0);assert.equal(snapshot.agents.agents.length,0);

 // T11 §44 packaged voice: the packaged Host verifies and launches the packaged worker (release manifest, whisper pin,
 // runtime DLLs, model, shim), inside its Windows job. One typed turn is answered from Host facts and spoken aloud.
 const command=async(action,data={})=>{const r=await fetch(`http://127.0.0.1:${port}/command`,{method:'POST',headers:{authorization:'Bearer '+ready.token,'content-type':'application/json'},body:JSON.stringify({action,data})});return {status:r.status,body:await r.json().catch(()=>({}))};};

 const project=join(parent,'offline-project');mkdirSync(project);writeFileSync(join(project,'notes.md'),'# Disposable package project\n');
 assert.equal((await command('mission.configure',{enabled:true,limits:{maxSteps:20}})).status,200);
 const added=await command('project.add',{name:'T12 packaged project',path:project});assert.equal(added.status,200);
 const created=await command('agent.create',{projectId:added.body.data.id,name:'Packaged team',objective:'Create an offline HTML dashboard and Markdown usage guide from notes.md.',team:{outputDir:'result',requirements:[{id:'R1',text:'Summary section',check:{kind:'html_id',value:'summary'}},{id:'R2',text:'Usage section',check:{kind:'markdown_heading',value:'Usage'}}]}});
 assert.equal(created.status,200,JSON.stringify(created.body));
 const initial=created.body.snapshot.agents.agents;assert.equal(initial.length,2);assert.deepEqual(initial.map(a=>a.team.role).sort(),['coordinator','planner']);
 const coordinator=initial.find(a=>a.team.role==='coordinator');
 assert.equal((await command('agent.start',{id:coordinator.id})).status,200);
 const deadlineTeam=Date.now()+240000;let teamState;
 do{await new Promise(done=>setTimeout(done,500));const current=await fetch('http://127.0.0.1:'+port+'/state',{headers:{authorization:'Bearer '+ready.token}});teamState=await current.json();}while(Date.now()<deadlineTeam&&!teamState.missions.missions.some(m=>m.id===coordinator.missionId&&m.teamView?.phase==='review'));
 const mission=teamState.missions.missions.find(m=>m.id===coordinator.missionId);assert.equal(mission.teamView.phase,'review','packaged real planner produced a Host-validated plan');
 const modelTasks=teamState.tasks.filter(t=>t.mission?.missionId===mission.id);assert.ok(modelTasks.some(t=>t.provider==='ollama'&&t.state==='completed'));
 const members=teamState.agents.agents.filter(a=>a.missionId===mission.id);assert.ok(members.length>=4);assert.equal(new Set(members.map(a=>a.id)).size,members.length);
 packagedTeam={result:'PASS',classification:'LIVE actual packaged Host, real local Ollama planning, Host validation and durable distinct Agents; execution plan deliberately left unapproved',missionId:mission.id,phase:mission.teamView.phase,members:members.map(a=>({id:a.id,role:a.team.role})),plannerTasks:modelTasks.map(t=>({id:t.id,provider:t.provider,model:t.model,state:t.state})),planReference:mission.teamView.planReference};
 assert.equal((await command('agent.stop',{id:coordinator.id})).status,200);
 const opened=await command('voice.session.open',{mode:'push_to_talk'});assert.equal(opened.status,200,JSON.stringify(opened.body));
 let vs=opened.body.data;const deadline=Date.now()+20000;
 while(Date.now()<deadline&&!(vs?.engines?.stt&&vs?.devices?.input))({body:{data:vs}}=await command('voice.state'));
 assert.equal(vs.open,true,'packaged voice session opened');assert.match(String(vs.engines.stt),/whisper/,'packaged whisper runtime verified and selected');assert.equal(vs.error?.code??null,null);
 const asked=await command('voice.text',{text:'What is my agent doing?'});assert.equal(asked.status,200);
 const turnDeadline=Date.now()+30000;
 while(Date.now()<turnDeadline&&!(vs?.timing?.completedAt&&!vs.playing&&vs.state==='IDLE')){await new Promise(done=>setTimeout(done,100));({body:{data:vs}}=await command('voice.state'));}
 assert.equal(vs.answerSource,'host_facts');assert.ok(vs.timing.firstPlaybackAt,'the packaged worker played the answer');
 const voiceTurn={answer:vs.answer,answerSource:vs.answerSource,engines:vs.engines,devices:{input:vs.devices.input?.name??null,output:vs.devices.output?.name??null,micPrivacy:vs.devices.micPrivacy},timing:vs.timing};
 const closedVoice=await command('voice.session.close',{source:'package_acceptance'});
 assert.equal(closedVoice.body.data.open,false);assert.equal(closedVoice.body.data.lastClose.source,'package_acceptance');
 // T12 packaged full duplex: hands-free opens the packaged worker's echo-cancelled microphone; a typed question is then
 // answered aloud while the microphone stays open (capturing and playing at once). No audio is retained.
 const hf=await command('voice.session.open',{mode:'hands_free'});assert.equal(hf.status,200,JSON.stringify(hf.body));
 const started=await command('voice.listen.start',{source:'hands_free'});assert.equal(started.status,200,JSON.stringify(started.body));
 const duplexDeadline=Date.now()+20000;
 while(Date.now()<duplexDeadline&&!vs?.duplex?.active){await new Promise(done=>setTimeout(done,100));({body:{data:vs}}=await command('voice.state'));}
 assert.equal(vs.duplex?.active,true,'packaged worker opened the echo-cancelled microphone');assert.equal(vs.duplex.fixture,false);
 const duplexOpen={aec:vs.duplex.aec,reference:vs.duplex.reference,grantExpiresAt:vs.duplex.grantExpiresAt,mode:vs.mode};
 const askedDuplex=await command('voice.text',{text:'What is my agent doing?'});assert.equal(askedDuplex.status,200);
 let overlapSamples=0,playingSamples=0;const duplexTurnDeadline=Date.now()+30000;const startTurn=vs.generation;
 while(Date.now()<duplexTurnDeadline){await new Promise(done=>setTimeout(done,50));({body:{data:vs}}=await command('voice.state'));
  if(vs.playing){playingSamples++;if(vs.capturing&&vs.duplex?.active)overlapSamples++;}
  if(vs.timing?.completedAt&&vs.generation>startTurn&&!vs.playing&&playingSamples>0)break;}
 assert.ok(playingSamples>0,'packaged worker played the hands-free answer');
 assert.equal(overlapSamples,playingSamples,'capture stayed open for every sampled moment of playback');
 const duplexTurn={answer:vs.answer,answerSource:vs.answerSource,playingSamples,capturingWhilePlayingSamples:overlapSamples,stillActiveAfterReply:!!vs.duplex?.active,firstPlaybackAt:vs.timing?.firstPlaybackAt??null};
 const closedDuplex=await command('voice.session.close',{source:'package_acceptance'});
 assert.equal(closedDuplex.body.data.open,false);assert.equal(closedDuplex.body.data.capturing,false);assert.equal(closedDuplex.body.data.duplex?.active??false,false);
 packagedDuplex={result:'PASS',classification:'LIVE packaged Host and packaged contained worker; real Windows Voice Capture DSP microphone open while the answer played on the real default speakers; no audio retained',open:duplexOpen,turn:duplexTurn,closeSource:closedDuplex.body.data.lastClose?.source??null,grantAfterClose:closedDuplex.body.data.duplex?.grantExpiresAt??null};
 const workers=execFileSync('powershell.exe',['-NoProfile','-Command',`@(Get-CimInstance Win32_Process -Filter "Name='bunny-voice-worker.exe'" | Where-Object { $_.ExecutablePath -like '${pkg.replaceAll("'","''")}*' }).Count`],{encoding:'utf8'}).trim();
 assert.equal(workers,'0','no packaged voice worker outlives the closed session');
 packagedVoice={result:'PASS',classification:'LIVE packaged Host, packaged contained voice worker, packaged whisper runtime; typed turn answered from Host facts and played on the real default speakers; no audio retained',worker:'native/voice/bunny-voice-worker.exe (built from the pinned source in the package build)',...voiceTurn,closeSource:closedVoice.body.data.lastClose.source,workersAfterClose:Number(workers)};
 const closed=new Promise(done=>child.once('exit',done));child.send('close');await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Packaged close deadline')),15000))]);
 // T9R-F04 J60: the packaged runtime itself launches a job-contained provider session, loading the packaged native
 // helper only after its release-manifest integrity and providerProcessContainmentPolicyVersion checks.
 assert.equal(manifest.compatibility.providerProcessContainmentPolicyVersion,1);
 assert.equal(manifest.compatibility.gitProcessOwnershipPolicyVersion,1);
 const providerScript=join(parent,'provider.cjs');
 writeFileSync(providerScript,`const {spawn}=require('child_process');process.stdin.resume();process.stdin.on('end',()=>{spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}).unref();console.log('packaged provider ok');setTimeout(()=>process.exit(0),1500);});`);
 const contained=join(parent,'contained.mjs');
 writeFileSync(contained,`const {spawnSession}=await import(${JSON.stringify(pathToFileURL(join(pkg,'src/lib/bunny-host/adapters.server.ts')).href)});
const lines=[];const session=spawnSession('claude',{command:process.execPath,args:[${JSON.stringify(providerScript)}],path:${JSON.stringify(providerScript)},kind:'node-script',source:'package'},[],{id:'p',provider:'claude',model:'m',cwd:${JSON.stringify(parent)},prompt:'package'},{event(){},session(){},output(){},raw:(s,l)=>{if(s==='stdout')lines.push(l);}},'s');
let peak=0;const timer=setInterval(()=>{peak=Math.max(peak,session.containment().activeProcesses??0);},50);
const result=await session.done;clearInterval(timer);console.log('CONTAINED '+JSON.stringify({ok:result.ok,lines,containment:session.containment(),peakActive:peak}));`);
 const containedRun=execFileSync(node,['--experimental-strip-types',contained],{windowsHide:true,encoding:'utf8',env,cwd:parent,timeout:60000});
 const packagedProvider=JSON.parse(containedRun.split(/\r?\n/).find(line=>line.startsWith('CONTAINED ')).slice(10));
 assert.equal(packagedProvider.ok,true);assert.equal(packagedProvider.containment.state,'empty');assert.ok(packagedProvider.peakActive>=2,'packaged provider and its child were job members');
 assert.ok(packagedProvider.lines.includes('packaged provider ok'));
 const after=verifyRelease(pkg);
 writeFileSync(join(evidence,'windows-package-results.json'),JSON.stringify({result:'PASS',classification:'LIVE bundled node.exe, actual packaged Bunny-Host.mjs and native dependencies in fresh installed-layout disposable state',sourceCommit:source,toolingCommit:source,release:manifest.release,version:manifest.version,validation,after,packagedTeam,packagedVoice,packagedDuplex,packagedContainedProvider:{result:'PASS',classification:'LIVE packaged runtime node.exe, packaged adapters and packaged native helper',containment:packagedProvider.containment,peakActiveProcesses:packagedProvider.peakActive},boot:{result:'PASS',pid:ready.pid,startedAt,finishedAt:new Date().toISOString(),stateDirectory:state,release:snapshot.release,health:snapshot.health,tasks:0,agents:0,gracefulClose:true},gatewayBoot:{result:'NOT TESTED',reason:'Packaged Bunny-Server.mjs fixes the gateway at 127.0.0.1:8084, occupied by protected installed production. No port takeover or package source mutation performed. The same built gateway is separately live verified on disposable test listeners.'},installPerformed:false,productionRestart:false},null,2)+'\n');
 console.log('Packaged Host boot, release identity, graceful shutdown and unchanged manifest: PASS. Production gateway port preserved.');
}catch(error){writeFileSync(join(evidence,'package-boot-failure.json'),JSON.stringify({result:'FAIL',message:error.message,startedAt,finishedAt:new Date().toISOString()},null,2));throw error;}
finally{if(child.exitCode===null){forced=true;child.kill();}writeFileSync(join(evidence,'package-runtime.log'),log);if(forced)console.error('Only the exact owned package child required cleanup.');}
