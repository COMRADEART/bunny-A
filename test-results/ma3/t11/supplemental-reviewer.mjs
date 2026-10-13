// Supplementary real-model acceptance: preserves the main run's missed advisory review and tests a focused exact-id review.
import {fork,execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const out=resolve('test-results/ma3/t11/supplemental-reviewer');mkdirSync(out,{recursive:true});
const parent=mkdtempSync(join(tmpdir(),'bunny-t11-reviewer-')),data=join(parent,'state'),workspace=join(parent,'workspace'),project=join(parent,'project');
for(const p of [data,workspace,project])mkdirSync(p);
writeFileSync(join(project,'notes.md'),'# Offline project\nThe page must contain a section whose exact id is summary.\n');
const faultFile=join(parent,'faults.json');writeFileSync(faultFile,'{"seed":[]}');
const source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const child=fork(resolve('scripts/fixtures/t11-mission-worker.mjs'),[data,workspace,'43812',faultFile],{execArgv:['--experimental-strip-types'],stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
let errors='',missionId=null;child.stdout.on('data',()=>{});child.stderr.on('data',bytes=>errors+=bytes);
const ready=await new Promise((done,reject)=>{child.once('message',done);child.once('exit',code=>reject(Error('Disposable Reviewer Host exited '+code)));});
const command=async(action,data={})=>{const r=await fetch('http://127.0.0.1:43812/command',{method:'POST',headers:{authorization:'Bearer '+ready.token,'content-type':'application/json'},body:JSON.stringify({action,data})});const x=await r.json();if(!r.ok)throw Error(action+': '+x.error);return x;};
const state=async()=>await(await fetch('http://127.0.0.1:43812/state',{headers:{authorization:'Bearer '+ready.token}})).json();
const until=async(fn,label,max=300000)=>{const start=Date.now();for(;;){const x=await fn();if(x)return x;if(Date.now()-start>max)throw Error('Timeout: '+label);await new Promise(done=>setTimeout(done,500));}};
const startedAt=Date.now();let result;
try{
 await command('mission.configure',{enabled:true,limits:{maxSteps:20}});
 const registered=await command('project.add',{name:'Focused Reviewer acceptance',path:project});
 const objective='Build index.html and a Markdown Usage guide from notes.md. The page must have the literal HTML attribute id="summary". Include a Reviewer task before the Tester. The Reviewer must inspect the exact id attribute, not infer compliance from a heading or text, and report changes_requested with blocking R1 if the exact id is absent. Bunny independently verifies it.';
 const created=await command('agent.create',{name:'Focused literal-id review team',projectId:registered.data.id,objective,team:{outputDir:'review-result',requirements:[{id:'R1',text:'An HTML element has the exact id summary (a heading mentioning summary is insufficient)',check:{kind:'html_id',value:'summary'}},{id:'R2',text:'The guide has a Usage heading',check:{kind:'markdown_heading',value:'Usage'}}]}});
 const coordinator=created.snapshot.agents.agents.find(a=>a.team?.role==='coordinator');missionId=coordinator.missionId;
 writeFileSync(faultFile,JSON.stringify({seed:[{missionId,kind:'generate_html',round:0,remove:['id="summary"',"id='summary'"],replace:'id="overview-seeded"'}]}));
 await command('agent.start',{id:coordinator.id});
 const review=await until(async()=>{const m=(await state()).missions.missions.find(m=>m.id===missionId);return m.state==='waiting_for_approval'&&m.teamView.phase==='review'?m:null;},'real model plan');
 if(!review.steps.some(s=>s.team?.kind==='review'))throw Error('The real model did not propose a Reviewer task. No plan was altered.');
 await command('agent.team.approve',{id:coordinator.id,planReference:review.teamView.planReference});
 const ended=await until(async()=>{const m=(await state()).missions.missions.find(m=>m.id===missionId);return ['completed','failed','waiting_for_user'].includes(m.state)?m:null;},'focused review and rework');
 const snap=await state();
 result={classification:'LIVE real local Ollama planning, distinct durable Agents and actual Host verification; operator approvals through canonical API; test-only seeded literal-id defect',sourceCommit:source,startedAt,endedAt:Date.now(),missionId,state:ended.state,planReference:review.teamView.planReference,
   agents:snap.agents.agents.map(a=>({id:a.id,role:a.team.role,state:a.state})),findings:ended.teamView.findings,requirements:ended.teamView.requirementResults,reworkRounds:ended.teamView.reworkRounds,
   failedChecks:ended.steps.filter(s=>s.team?.kind==='verify_output'&&s.state==='failed').map(s=>({id:s.id,key:s.team.key,detail:s.failure?.detail})),
   modelTasks:snap.tasks.map(t=>({id:t.id,provider:t.provider,model:t.model,state:t.state,missionId:t.mission?.missionId,stepId:t.mission?.stepId}))};
 result.defectDetected=result.findings.some(review=>review.verdict==='changes_requested'&&review.findings.some(f=>f.requirement==='R1'&&f.severity==='blocking'))&&result.failedChecks.some(check=>check.detail?.includes('R1 failed'));
 result.result=result.defectDetected&&ended.state==='completed'?'PASS':'FAIL';
 console.log(JSON.stringify({result:result.result,state:result.state,defectDetected:result.defectDetected,rework:result.reworkRounds}));
}catch(error){result={result:'FAIL',classification:'LIVE attempted supplementary real-model review',sourceCommit:source,startedAt,endedAt:Date.now(),missionId,error:error.message};console.log(JSON.stringify(result));}
finally{
 const ended=new Promise(done=>child.once('exit',done));child.send('close');await Promise.race([ended,new Promise(done=>setTimeout(done,20000))]);if(child.exitCode===null)child.kill();
 try{const db=new DatabaseSync(join(data,'host.sqlite'),{readOnly:true});result.receipts=db.prepare("SELECT at,task_id AS taskId,detail FROM events WHERE type='provider.receipt' ORDER BY sequence").all().map(r=>({at:r.at,taskId:r.taskId,...JSON.parse(r.detail)}));db.close();}catch{}
 writeFileSync(join(out,'results.json'),JSON.stringify(result,null,2)+'\n');writeFileSync(join(out,'host.log'),errors);
}
