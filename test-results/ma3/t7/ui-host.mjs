// Disposable real Host for interactive browser acceptance. No production paths or providers.
import assert from 'node:assert/strict';
import {fork,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,renameSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const evidence=resolve('test-results/ma3/t7');
const parent=mkdtempSync(join(tmpdir(),'bunny-t7-ui-'));
const data=join(parent,'state'),workspace=join(parent,'workspace');
const registerRoot=join(parent,'existing-application'),historyRoot=join(parent,'history-project'),missingRoot=join(parent,'missing-root'),replacementRoot=join(parent,'replacement-root');
for(const path of [data,workspace,registerRoot,historyRoot,missingRoot])mkdirSync(path);
writeFileSync(join(registerRoot,'preserve.txt'),'Existing user content stays in place.');
writeFileSync(join(historyRoot,'result.txt'),'Verified UI receipt.');
execFileSync('git',['init'],{cwd:registerRoot,windowsHide:true});
const port=43148;
const child=fork(resolve('scripts/fixtures/project-host-worker.mjs'),[data,workspace,String(port)],{execArgv:['--experimental-strip-types'],stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
child.stdout.on('data',b=>process.stdout.write(b));child.stderr.on('data',b=>process.stderr.write(b));
const ready=await new Promise((done,reject)=>{child.once('message',done);child.once('exit',()=>reject(Error('Disposable Host exited')));});
const api=async(action,data={})=>{const response=await fetch(`http://127.0.0.1:${port}/command`,{method:'POST',headers:{authorization:`Bearer ${ready.token}`,'content-type':'application/json'},body:JSON.stringify({action,data})});const result=await response.json();assert.equal(response.status,200,result.error);return result;};
await api('mission.configure',{enabled:true});
const history=(await api('project.add',{name:'Acceptance history',path:historyRoot,description:'Verified Mission and durable workspace history.'})).data;
const done=(await api('agent.create',{projectId:history.id,name:'Verified history Agent',objective:'Read and verify the approved receipt',steps:[{role:'Verify receipt',objective:'Read the approved receipt',access:'read',executor:{kind:'capability',action:'filesystem.read',params:{path:'result.txt'}},verification:[{kind:'capability',action:'filesystem.compare',params:{path:'result.txt',content:'Verified UI receipt.'},expect:{field:'matches',equals:true}}],crossApp:true}]})).agents.agents[0];
const proposal=await api('agent.authorization.propose',{id:done.id});await api('agent.authorization.approve',{id:done.id,revision:proposal.agents.agents.find(a=>a.id===done.id).authorization.revision});
for(let n=0;n<200;n++){const view=(await api('project.get',{id:history.id})).data;if(view.agents[0]?.state==='COMPLETED')break;await new Promise(done=>setTimeout(done,50));}
const final=(await api('project.get',{id:history.id})).data;assert.equal(final.agents[0].state,'COMPLETED');
const pending=(await api('agent.create',{projectId:history.id,name:'Awaiting review Agent',objective:'Continue after fresh reviewed consent',steps:[{role:'Read receipt',objective:'Read receipt after permission review',access:'read',executor:{kind:'capability',action:'filesystem.read',params:{path:'result.txt'}},verification:[],crossApp:true}]})).agents.agents.find(a=>a.id!==done.id);
const missing=(await api('project.add',{name:'Workspace needs relink',path:missingRoot})).data;renameSync(missingRoot,replacementRoot);await api('project.get',{id:missing.id});
for(let n=1;n<=26;n++){const path=join(parent,'list-'+String(n).padStart(2,'0'));mkdirSync(path);await api('project.add',{name:n===26?'A very long project title for wrapping and keyboard navigation in the smallest supported viewport':'Organized fixture '+String(n).padStart(2,'0'),path,description:'Disposable pagination fixture.'});}
const record={classification:'DISPOSABLE LIVE VERIFIED',parent,data,workspace,port,pid:ready.pid,generation:ready.generation,registerRoot,historyRoot,replacementRoot,historyProjectId:history.id,missingProjectId:missing.id,completedAgentId:done.id,pendingAgentId:pending.id,artifacts:final.artifacts.map(a=>({id:a.id,sha256:a.sha256,verification:a.verification})),providerExecution:'NOT TESTED',cleanupSignal:join(parent,'close-ui-host')};
writeFileSync(join(evidence,'ui-fixture.json'),JSON.stringify(record,null,2)+'\n');
console.log('Disposable UI Host ready; credentials excluded from evidence.');
const timer=setInterval(()=>{if(existsSync(record.cleanupSignal)){clearInterval(timer);child.send('close');}},500);
child.once('exit',()=>{clearInterval(timer);process.exit(0);});
