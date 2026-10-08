// Disposable canonical Host. No providers, production paths, or private user content.
import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, unlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dashboardSnapshot } from '../../../src/lib/bunny-host/presentation.ts';
const evidence=resolve('test-results/ma3/t8');
const parent=mkdtempSync(join(tmpdir(),'bunny-t8-ui-'));
const data=join(parent,'state'), workspace=join(parent,'workspace');
const rootA=join(parent,'project-a'),rootB=join(parent,'project-b'),missingRoot=join(parent,'missing-root'),replacementRoot=join(parent,'replacement-root');
for(const path of [data,workspace,rootA,rootB,missingRoot])mkdirSync(path);
writeFileSync(join(rootA,'receipt.txt'),'T8 independent verification receipt.');
writeFileSync(join(rootB,'private.txt'),'Project B isolation fixture.');
execFileSync('git',['init'],{cwd:rootA,windowsHide:true});
const port=43158;
let child, ready, prior;
const boot=async()=>{
 child=fork(resolve('scripts/fixtures/project-host-worker.mjs'),[data,workspace,String(port)],{execArgv:['--experimental-strip-types'],stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 child.stdout.on('data',b=>process.stdout.write(b));child.stderr.on('data',b=>process.stderr.write(b));
 ready=await new Promise((done,reject)=>{child.once('message',done);child.once('exit',()=>reject(Error('Disposable Host exited')));});
};
const api=async(action,params={})=>{
 const response=await fetch(`http://127.0.0.1:${port}/command`,{method:'POST',headers:{authorization:`Bearer ${ready.token}`,'content-type':'application/json'},body:JSON.stringify({action,data:params})});
 const result=await response.json();assert.equal(response.status,200,result.error);return result;
};
const state=async()=>dashboardSnapshot(await (await fetch(`http://127.0.0.1:${port}/state`,{headers:{authorization:`Bearer ${ready.token}`}})).json());
const close=async()=>{await new Promise(done=>{child.once('exit',done);child.send('close');});};
await boot();
await api('mission.configure',{enabled:true});
const a=(await api('project.add',{name:'Receipt studio',path:rootA,description:'A disposable Project with independently verified work.'})).data;
const b=(await api('project.add',{name:'Private research',path:rootB,description:'Separate Project, separate artifact authority.'})).data;
const missing=(await api('project.add',{name:'Workspace needs relink',path:missingRoot})).data;
renameSync(missingRoot,replacementRoot);
await api('project.get',{id:missing.id});
const steps=[{role:'Verify receipt',objective:'Read and independently verify the approved receipt',access:'read',executor:{kind:'capability',action:'filesystem.read',params:{path:'receipt.txt'}},verification:[{kind:'capability',action:'filesystem.compare',params:{path:'receipt.txt',content:'T8 independent verification receipt.'},expect:{field:'matches',equals:true}}],crossApp:true}];
const create=async(name)=>{const result=await api('agent.create',{projectId:a.id,name,objective:'Read and verify the approved receipt',steps});return result.snapshot.agents.agents.find(row=>row.name===name);};
const completed=await create('Receipt verification');
const proposal=await api('agent.authorization.propose',{id:completed.id});
await api('agent.authorization.approve',{id:completed.id,revision:proposal.snapshot.agents.agents.find(row=>row.id===completed.id).authorization.revision});
for(let n=0;n<200;n++){if((await state()).agents.agents.find(row=>row.id===completed.id).state==='COMPLETED')break;await new Promise(done=>setTimeout(done,50));}
assert.equal((await state()).agents.agents.find(row=>row.id===completed.id).state,'COMPLETED');
const waiting=await create('Permission review');await api('agent.authorization.propose',{id:waiting.id});
const paused=await create('Paused receipt Agent');await api('agent.pause',{id:paused.id});
const denial=await create('Deny access fixture');await api('agent.authorization.propose',{id:denial.id});
const stop=await create('Stop admission fixture');
const record={classification:'DISPOSABLE LIVE VERIFIED',parent,data,workspace,rootA,rootB,replacementRoot,port,pid:ready.pid,instanceId:ready.generation,projectA:a.id,projectB:b.id,missingProject:missing.id,completedAgent:completed.id,waitingAgent:waiting.id,pausedAgent:paused.id,denialAgent:denial.id,stopAgent:stop.id,providerCalls:0};
const save=(name,value)=>writeFileSync(join(evidence,name),JSON.stringify(value,null,2)+'\n');
save('ui-fixture.json',record);save('ui-initial-state.json',await state());
console.log('T8 disposable UI Host ready. Credentials excluded from evidence.');
let busy=false;
setInterval(async()=>{
 if(busy)return;busy=true;
 try{
  if(existsSync(join(parent,'snapshot'))){unlinkSync(join(parent,'snapshot'));save('ui-current-state.json',await state());save('ui-project-a.json',(await api('project.get',{id:a.id})).data);}
  if(existsSync(join(parent,'restart'))){unlinkSync(join(parent,'restart'));prior=await state();await close();await new Promise(done=>setTimeout(done,4000));await boot();const after=await state();save('restart-host-proof.json',{classification:'DISPOSABLE LIVE VERIFIED',oldInstance:prior.instanceId,newInstance:after.instanceId,newPid:ready.pid,identitiesStable:prior.agents.agents.every(row=>after.agents.agents.some(next=>next.id===row.id)),before:prior.agents.agents.map(row=>({id:row.id,state:row.state,authorization:row.authorization?.state})),after:after.agents.agents.map(row=>({id:row.id,state:row.state,authorization:row.authorization?.state})),completedPreserved:after.agents.agents.find(row=>row.id===completed.id).state==='COMPLETED'});}
  if(existsSync(join(parent,'disconnect'))){unlinkSync(join(parent,'disconnect'));await close();}
  if(existsSync(join(parent,'reconnect'))){unlinkSync(join(parent,'reconnect'));await boot();}
  if(existsSync(join(parent,'close'))){await close();process.exit(0);}
 }catch(error){save('fixture-failure.json',{error:error.message});}finally{busy=false;}
},500);
