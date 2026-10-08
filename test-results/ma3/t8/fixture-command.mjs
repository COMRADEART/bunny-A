import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dashboardSnapshot } from '../../../src/lib/bunny-host/presentation.ts';
const base=resolve('test-results/ma3/t8');
const fixture=JSON.parse(readFileSync(join(base,'ui-fixture.json'),'utf8'));
const credentials=JSON.parse(readFileSync(join(fixture.data,'credentials.json'),'utf8'));
const api=async(action,data={})=>{
 const r=await fetch(`http://127.0.0.1:${credentials.port}/command`,{method:'POST',headers:{authorization:`Bearer ${credentials.token}`,'content-type':'application/json'},body:JSON.stringify({action,data})});
 const value=await r.json();if(!r.ok)throw Error(value.error);return value;
};
const mode=process.argv[2];
if(mode==='native-created'||mode==='native-pending') {
 const prior=await api('agent.list');const oldIds=new Set(prior.snapshot.agents.agents.map(a=>a.id));
 const result=await api('agent.create',{projectId:fixture.projectA,name:mode==='native-pending'?'T8 final pending review':'T8 native pause fixture',objective:'Read the disposable receipt after plan approval',steps:[{role:'Read receipt',objective:'Read receipt',access:'read',executor:{kind:'capability',action:'filesystem.read',params:{path:'receipt.txt'}},verification:[{kind:'capability',action:'filesystem.compare',params:{path:'receipt.txt',content:'T8 independent verification receipt.'},expect:{field:'matches',equals:true}}],crossApp:true}]});
 const row=result.snapshot.agents.agents.find(a=>!oldIds.has(a.id));
 if(mode==='native-pending')await api('agent.authorization.propose',{id:row.id});
 writeFileSync(join(base,mode+'.json'),JSON.stringify({classification:'DISPOSABLE LIVE VERIFIED',id:row.id,state:row.state,projectId:fixture.projectA},null,2));console.log('Native control fixture created without any consent.');
}else if(mode==='seed-review'){
 const steps=[{role:'Verify receipt',objective:'Verify the disposable receipt',access:'read',executor:{kind:'capability',action:'filesystem.read',params:{path:'receipt.txt'}},verification:[{kind:'capability',action:'filesystem.compare',params:{path:'receipt.txt',content:'T8 independent verification receipt.'},expect:{field:'matches',equals:true}}],crossApp:true}];
 const ids={};
 for(const name of ['T8 review scope','T8 deny access','T8 native review']){
  const result=await api('agent.create',{projectId:fixture.projectA,name,objective:'Verify the disposable receipt after explicit permission review',steps});
  const row=result.snapshot.agents.agents.filter(a=>a.name===name).at(-1);ids[name]=row.id;
  await api('agent.authorization.propose',{id:row.id});
 }
 await new Promise(done=>setTimeout(done,5000));
 const r=await fetch(`http://127.0.0.1:${credentials.port}/state`,{headers:{authorization:`Bearer ${credentials.token}`}});
 const snapshot=dashboardSnapshot(await r.json());
 const states=snapshot.agents.agents.filter(a=>Object.values(ids).includes(a.id)).map(a=>({id:a.id,name:a.name,state:a.state,authorization:a.authorization?.state,revision:a.authorization?.revision}));
 if(states.some(a=>a.authorization!=='WAITING_FOR_USER'||a.state!=='CREATED'))throw Error('Pending consent changed without owner command');
 writeFileSync(join(base,'review-fixture.json'),JSON.stringify({classification:'DISPOSABLE LIVE VERIFIED',ids,states,remainedPendingWithoutUserCommand:true},null,2));
 console.log('Three fresh scopes remain pending without owner approval.');
}else if(mode==='snapshot'){
 const r=await fetch(`http://127.0.0.1:${credentials.port}/state`,{headers:{authorization:`Bearer ${credentials.token}`}});
 writeFileSync(join(base,process.argv[3]||'ui-current-state.json'),JSON.stringify(dashboardSnapshot(await r.json()),null,2));
 console.log('Sanitized canonical snapshot captured.');
}else if(mode==='command'){
 const result=await api(process.argv[3],JSON.parse(process.argv[4]||'{}'));
 console.log(JSON.stringify({ok:true,action:process.argv[3],data:result.data??null}));
}else throw Error('Unknown fixture action');
