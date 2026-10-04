// T4 live Windows gates. Only disposable state/repos and processes created by
// this driver are mutated. Optional argument is a staged release directory.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const source=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const release=process.argv[2]?resolve(process.argv[2]):null;
const label=release?"packaged":"source", evidence=join(source,"test-results/ma2-gate4",label);
mkdirSync(evidence,{recursive:true});
if(process.platform!=="win32")throw new Error("These live gates require real Windows.");
const root=mkdtempSync(join(tmpdir(),`bunny-t4-${label}-`)),state=join(root,"state"),workspace=join(root,"workspace");
for(const folder of [state,workspace])mkdirSync(folder);
const node=release?join(release,"runtime/node.exe"):process.execPath;
const worker="C:\\Program Files\\Git\\mingw64\\bin\\git.exe",cmd="C:\\Program Files\\Git\\cmd\\git.exe";
const fixture=join(source,"scripts/fixtures/git-owned-host.mjs"),hookChild=join(source,"scripts/fixtures/git-hook-child.mjs");
const baseline=JSON.parse(readFileSync(join(source,"test-results/ma2-gate4/baseline.json"),"utf8"));
if(release){
  for(const folder of ["credentials","settings","runtime","logs","backups","cloudflared","sessions"])mkdirSync(join(state,folder));
  copyFileSync(baseline.snapshotPath,join(state,"host.sqlite"));
  writeFileSync(join(state,"state-layout.json"),JSON.stringify({...JSON.parse(readFileSync(join(baseline.config.stateRoot,"state-layout.json"),"utf8")),stateRoot:state}));
}
const env={...process.env,BUNNY_HOST_DATA_DIRECTORY:state,BUNNY_HOST_WORKSPACE:workspace,BUNNY_HOST_PORT:"43131",BUNNY_STATE_LAYOUT:release?"2":"1",BUNNY_T4_FIXTURE:JSON.stringify({release}),GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:join(root,"no-global"),GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"never",BUNNY_T4_SLEEP_MS:"12000"};
for(const key of ["DATABASE_URL","BUNNY_REMOTE_ENABLED","BUNNY_REMOTE_ORIGIN","BUNNY_MISSIONS"])delete env[key];
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const until=async(fn,description,limit=15000)=>{const end=Date.now()+limit;while(Date.now()<end){const value=await fn();if(value)return value;await wait(60);}throw new Error("Timed out: "+description);};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const read=path=>JSON.parse(readFileSync(path,"utf8"));
const watched=[];const hosts=[];let sequence=0;
function identities(pids){
  const unique=[...new Set(pids)].filter(Number.isInteger);if(!unique.length)return[];
  const result=execFileSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",["-NoProfile","-Command",`$env:PSModulePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'; @(Get-CimInstance Win32_Process -Filter '${unique.map(pid=>`ProcessId=${pid}`).join(" OR ")}') | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Depth 3`],{encoding:"utf8",windowsHide:true,timeout:15000});
  const parsed=result.trim()?JSON.parse(result):[];return Array.isArray(parsed)?parsed:[parsed];
}
function start(sleepMs="12000"){
  const log=join(evidence,`host-${hosts.length}.log`);
  const child=spawn(node,["--experimental-strip-types",fixture],{cwd:workspace,env:{...env,BUNNY_T4_SLEEP_MS:sleepMs},windowsHide:true,stdio:["ignore","pipe","pipe","ipc"]});
  let text="";for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{text=(text+chunk).slice(-200000);writeFileSync(log,text);});
  const messages=[],pending=new Map();child.on("message",message=>{messages.push(message);if(message.type==="reply"){pending.get(message.id)?.(message.value);pending.delete(message.id);}});
  child.exited=new Promise(done=>child.once("exit",(code,signal)=>done({code,signal,at:Date.now()})));
  child.ready=until(()=>messages.find(m=>m.type==="ready"),"Host readiness",30000);
  child.call=async(type,values={})=>{
    const id=++sequence;
    const value=await Promise.race([new Promise(done=>{pending.set(id,done);child.send({type,id,...values});}),wait(30000).then(()=>{throw new Error(`Host call ${type} timed out.`);})]);
    if(value?.error)throw new Error(value.error);return value;
  };
  hosts.push(child);return child;
}
function repository(name,mode=null){
  const repo=join(workspace,name);mkdirSync(repo);const log=join(root,name+"-children.jsonl");
  const git=(...args)=>execFileSync(worker,args,{cwd:repo,env,encoding:"utf8",windowsHide:true,stdio:"pipe"});
  git("init","-b","main");git("config","user.name","T4 disposable");git("config","user.email","t4@invalid.local");git("config","core.autocrlf","false");git("config","commit.gpgSign","false");
  writeFileSync(join(repo,"file.txt"),"base\n");git("add",".");git("commit","-m","base");
  const before=git("rev-parse","HEAD").trim();
  const installHook=(kind,hookName="pre-commit")=>writeFileSync(join(repo,".git/hooks",hookName),`#!/bin/sh\nexec '${node.replaceAll("\\","/")}' '${hookChild.replaceAll("\\","/")}' '${kind}' '${log.replaceAll("\\","/")}'\n`);
  if(mode){writeFileSync(join(repo,"file.txt"),"staged\n");git("add",".");installHook(mode);}
  const children=()=>existsSync(log)?readFileSync(log,"utf8").trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)):[];
  return{repo,log,git,before,installHook,children};
}
const records=()=>{
  const folder=join(state,"runtime/git-operations");return existsSync(folder)?readdirSync(folder).filter(name=>name.endsWith(".json")).map(name=>read(join(folder,name))):[];
};
function repoHashes(repo){
  const files={};
  const walk=folder=>{for(const entry of readdirSync(folder,{withFileTypes:true})){const path=join(folder,entry.name);if(entry.isDirectory())walk(path);else if(entry.isFile())files[path.slice(repo.length+1)]=createHash("sha256").update(readFileSync(path)).digest("hex");}};
  walk(repo);return files;
}
async function active(mission){return until(()=>records().find(r=>r.missionId===mission.missionId&&r.state==="running"&&r.members.length>=3),"owned launcher/worker/hook tree");}
const gates=[];function gate(name,value){gates.push({name,...value});writeFileSync(join(evidence,"gates.json"),JSON.stringify(gates,null,2));console.log(`${label}: ${name} PASS`);}
let current;
try{
  current=start();const ready=await current.ready;
  const summary=await current.call("summary");
  if(release){assert.equal(summary.codex.securityCompatibility.compatibilityClass,"VALIDATED");assert.equal(summary.codex.securityCompatibility.policyVersion,1);assert.equal(summary.tasks,54);}
  gate("test-host",{ready,summary,state,workspace,release,packagedRuntime:!!release});
  const a=repository("mission-a","nested"),b=repository("mission-b","wait-child"),user=repository("user-git","wait-child");
  const unrelatedGit=spawn(cmd,["commit","-m","user fixture"],{cwd:user.repo,env,windowsHide:true,stdio:"ignore"});watched.push(unrelatedGit);
  const shell=spawn("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",["-NoProfile","-Command","Start-Sleep -Seconds 30"],{windowsHide:true,stdio:"ignore"});watched.push(shell);
  const sleeper=spawn(node,["-e","setTimeout(()=>{},30000)"],{windowsHide:true,stdio:"ignore"});watched.push(sleeper);
  const ma=await current.call("mission",{repo:a.repo,name:"Mission A",action:"terminal.exec",params:{command:cmd,args:["commit","-m","owned A"]}});
  const mb=await current.call("mission",{repo:b.repo,name:"Mission B"});
  await until(()=>a.children().length>=5&&b.children().length>=3&&user.children().length>=3,"all harmless hook trees");await wait(160);
  const jobA=await active(ma),jobB=await active(mb);
  assert.notEqual(jobA.containerId,jobB.containerId);assert.ok(jobA.members.some(p=>/mingw64\\bin\\git\.exe$/i.test(p.file??"")));
  const allPids=[...jobA.members,...jobB.members].map(p=>p.pid).concat(user.children().map(p=>p.pid),unrelatedGit.pid,shell.pid,sleeper.pid,baseline.health.pid,baseline.gateway.pid,41220,11020);
  const before=identities(allPids);const stopped=await current.call("stop",ma);await wait(160);const after=identities(allPids);
  for(const member of jobA.members)assert.ok(!after.some(p=>p.ProcessId===member.pid),`A ${member.pid} terminated`);
  const preserved=[...jobB.members.map(p=>p.pid),...user.children().map(p=>p.pid),unrelatedGit.pid,shell.pid,sleeper.pid,baseline.health.pid,baseline.gateway.pid,41220,11020];
  for(const pid of preserved)assert.equal(after.find(p=>p.ProcessId===pid)?.CreationDate,before.find(p=>p.ProcessId===pid)?.CreationDate,`preserved ${pid}`);
  assert.equal(stopped.mission.state,"stopped");assert.equal(stopped.mission.steps[0].state,"stopped");assert.equal(stopped.runs[0].status,"stopped");assert.equal(a.git("rev-parse","HEAD").trim(),a.before);
  await current.call("stop",mb);
  gate("stop-isolation",{jobA,jobB,before,after,stopped,unrelatedPreserved:true,secondMissionPreserved:true,noDelayedCommit:true});
  for(const child of watched)if(child.exitCode===null&&!child.signalCode)execFileSync("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"pipe"});
  for(const folder of ["bin","mingw64/bin"]) {
    const probe=repository("launcher-"+folder.replaceAll("/","-"),"wait-child");
    const mission=await current.call("mission",{repo:probe.repo,name:"Launcher "+folder,action:"terminal.exec",params:{command:`C:/Program Files/Git/${folder}/git.exe`,args:["commit","-m","launcher probe"]}});
    await until(()=>probe.children().length>=3,"alternate launcher hook");await wait(160);const job=await active(mission);const before=identities(job.members.map(p=>p.pid));
    await current.call("stop",mission);const after=identities(job.members.map(p=>p.pid));assert.equal(after.length,0);assert.equal(probe.git("rev-parse","HEAD").trim(),probe.before);
    gate("launcher-"+folder,{job,before,after,workerVisible:job.members.some(p=>/mingw64\\bin\\git\.exe$/i.test(p.file??""))});
  }
  for(const mode of ["normal","exit-child","detached","fail"]) {
    const probe=repository("hook-"+mode,mode);const outcome=await current.call("direct",{repo:probe.repo,action:"git.commit",params:{message:"hook probe"}});
    assert.equal(outcome.run.status,mode==="fail"?"failed":"succeeded");for(const row of probe.children())assert.equal(alive(row.pid),false);
    gate("hook-"+mode,{outcome,children:probe.children(),records:records().filter(r=>r.capabilityRunId===outcome.run.id),childrenGone:true});
  }
  const breakaway=repository("hook-breakaway","normal"),breakawayExe=join(root,"breakaway.exe");
  execFileSync(process.env.BUNNY_NATIVE_CC??"C:\\msys64\\ucrt64\\bin\\gcc.exe",["-std=c11","-O2","-Wall","-Wextra","-Werror","-static-libgcc","-Wl,--no-insert-timestamp",join(source,"scripts/fixtures/git-breakaway.c"),"-o",breakawayExe],{windowsHide:true,stdio:"pipe"});
  writeFileSync(join(breakaway.repo,".git/hooks/pre-commit"),`#!/bin/sh\nexec '${breakawayExe.replaceAll("\\","/")}'\n`);
  const breakawayResult=await current.call("direct",{repo:breakaway.repo,action:"terminal.exec",params:{command:cmd,args:["commit","-m","breakaway probe"]}});
  assert.equal(breakawayResult.run.status,"succeeded");assert.match(breakawayResult.result.output.stdout+breakawayResult.result.output.stderr,/T4_BREAKAWAY created=0 error=5/);
  gate("breakaway-denied",{outcome:breakawayResult,flags:"KILL_ON_JOB_CLOSE only; BREAKAWAY_OK/SILENT_BREAKAWAY_OK disabled",deniedByKernel:true});
  const actions=repository("actions"),actionResults=[];
  const direct=async(action,params)=>{const result=await current.call("direct",{repo:actions.repo,action,params});assert.equal(result.run.status,"succeeded");actionResults.push({action,result,records:records().filter(r=>r.capabilityRunId===result.run.id)});return result;};
  await direct("git.status",{});writeFileSync(join(actions.repo,"file.txt"),"changed\n");await direct("git.diff",{});await direct("git.commit",{message:"actions"});
  const worktree=await direct("git.worktree_add",{name:"probe"});await direct("git.worktree_remove",{path:worktree.result.output.path});
  await direct("terminal.exec",{command:cmd,args:["checkout","-b","bunny/switch-probe"]});await direct("terminal.exec",{command:cmd,args:["switch","main"]});
  actions.git("checkout","-b","bunny/success");writeFileSync(join(actions.repo,"new.txt"),"new\n");actions.git("add",".");actions.git("commit","-m","branch");actions.git("checkout","main");
  await direct("git.merge",{branch:"bunny/success"});assert.equal(actions.git("status","--porcelain"),"");assert.ok(!existsSync(join(actions.repo,".git/bunny-merge.lock")));
  gate("direct-actions-and-clean-merge",{actionResults,clean:true,allContainersClosed:actionResults.every(row=>row.records.every(record=>record.closed))});
  const ownedConflict=repository("owned-conflict");ownedConflict.git("checkout","-b","bunny/conflict");writeFileSync(join(ownedConflict.repo,"file.txt"),"branch\n");ownedConflict.git("commit","-am","branch");ownedConflict.git("checkout","main");writeFileSync(join(ownedConflict.repo,"file.txt"),"main\n");ownedConflict.git("commit","-am","main");
  const conflictBefore=ownedConflict.git("rev-parse","HEAD").trim();const conflictResult=await current.call("direct",{repo:ownedConflict.repo,action:"git.merge",params:{branch:"bunny/conflict"}});
  assert.equal(conflictResult.run.status,"failed");assert.ok(conflictResult.result.output.conflict.includes("file.txt"));assert.equal(conflictResult.result.cleanup.ok,true);assert.equal(ownedConflict.git("rev-parse","HEAD").trim(),conflictBefore);assert.equal(ownedConflict.git("status","--porcelain"),"");assert.ok(!existsSync(join(ownedConflict.repo,".git/MERGE_HEAD")));assert.ok(!existsSync(join(ownedConflict.repo,".git/bunny-merge.lock")));
  gate("owned-conflict-cleanup",{outcome:conflictResult,records:records().filter(r=>r.capabilityRunId===conflictResult.run.id),head:conflictBefore,noFalseCompletion:true,clean:true});
  // Real merge with the existing sidecar/marker cleanup policy.
  const merge=repository("merge-stop");merge.git("checkout","-b","bunny/topic");writeFileSync(join(merge.repo,"topic.txt"),"topic\n");merge.git("add",".");merge.git("commit","-m","topic");merge.git("checkout","main");merge.installHook("wait-child");
  const mm=await current.call("mission",{repo:merge.repo,name:"Merge Stop",action:"git.merge",params:{branch:"bunny/topic"}});
  await until(()=>merge.children().length>=3,"merge commit hook");const mergeJob=await active(mm);const mergeStopped=await current.call("stop",mm);
  assert.equal(mergeStopped.runs[0].status,"stopped");assert.equal(mergeStopped.runs[0].cleanup.ok,true);assert.ok(!existsSync(join(merge.repo,".git/MERGE_HEAD")));assert.ok(!existsSync(join(merge.repo,".git/bunny-merge.lock")));assert.equal(merge.git("rev-parse","HEAD").trim(),merge.before);assert.equal(merge.git("status","--porcelain"),"");
  gate("merge-stop-cleanup",{mergeJob,mission:mergeStopped,head:merge.before,status:"clean",ownedMarkerCleanup:true});
  await current.call("direct",{repo:merge.repo,action:"git.status",params:{}});
  // Conflict belongs to the real user before Bunny reads/refuses it.
  const conflict=repository("user-merge");conflict.git("checkout","-b","bunny/conflict");writeFileSync(join(conflict.repo,"file.txt"),"branch\n");conflict.git("commit","-am","branch");conflict.git("checkout","main");writeFileSync(join(conflict.repo,"file.txt"),"main\n");conflict.git("commit","-am","main");try{conflict.git("merge","bunny/conflict");}catch{/* expected conflict */}
  const mergeHead=readFileSync(join(conflict.repo,".git/MERGE_HEAD"),"utf8"),status=conflict.git("status","--porcelain");
  const userRead=await current.call("direct",{repo:conflict.repo,action:"git.status",params:{}}),userRefuse=await current.call("direct",{repo:conflict.repo,action:"git.merge",params:{branch:"bunny/conflict"}});
  assert.equal(userRefuse.result.ok,false);assert.equal(readFileSync(join(conflict.repo,".git/MERGE_HEAD"),"utf8"),mergeHead);assert.equal(conflict.git("status","--porcelain"),status);
  gate("preexisting-user-merge",{mergeHead,status,userRead,userRefuse,preserved:true});
  const timeout=repository("timeout","output");const timed=await current.call("direct",{repo:timeout.repo,action:"git.commit",params:{message:"timeout"},timeoutMs:1400});assert.equal(timed.run.status,"timeout");for(const row of timeout.children())assert.equal(alive(row.pid),false);assert.equal(timeout.git("rev-parse","HEAD").trim(),timeout.before);
  gate("timeout-output",{outcome:timed,records:records().filter(r=>r.capabilityRunId===timed.run.id),bounded:true,childrenGone:true});
  current.send({type:"close"});assert.equal((await current.exited).code,0);
  for(const mode of ["hard","merge-hard","fatal"]){
    const hard=mode!=="fatal",merging=mode==="merge-hard";
    current=start("5000");const hostReady=await current.ready;const crash=repository(mode+"-crash",merging?null:"wait-child");
    if(merging){crash.git("checkout","-b","bunny/crash");writeFileSync(join(crash.repo,"topic.txt"),"topic\n");crash.git("add",".");crash.git("commit","-m","topic");crash.git("checkout","main");crash.installHook("wait-child");}
    const mission=await current.call("mission",{repo:crash.repo,name:mode+" crash",action:merging?"git.merge":"terminal.exec",params:merging?{branch:"bunny/crash"}:{command:cmd,args:["commit","-m","MUST NOT COMPLETE"]}});
    await until(()=>crash.children().length>=3,"crash hook child");await wait(180);const job=await active(mission);
    const pids=[current.pid,...job.members.map(p=>p.pid),baseline.health.pid,baseline.gateway.pid,41220,11020];const beforeCrash=identities(pids);
    const at=Date.now();
    if(hard)execFileSync("taskkill.exe",["/PID",String(current.pid),"/F"],{windowsHide:true,stdio:"pipe"});
    else current.send({type:"fatal"});
    const exit=await Promise.race([current.exited,wait(7000).then(()=>{throw new Error("Host exit deadline failed");})]);
    if(mode==="fatal")assert.equal(exit.code,70);
    await until(()=>job.members.every(member=>!alive(member.pid)),"automatic job death",3000);
    const afterCrash=identities(pids);for(const pid of [baseline.health.pid,baseline.gateway.pid,41220,11020])assert.equal(afterCrash.find(p=>p.ProcessId===pid)?.CreationDate,beforeCrash.find(p=>p.ProcessId===pid)?.CreationDate);
    const stoppedHashes=repoHashes(crash.repo);await wait(5500);assert.deepEqual(repoHashes(crash.repo),stoppedHashes);assert.equal(crash.git("rev-parse","HEAD").trim(),crash.before);assert.ok(!crash.children().some(row=>row.type==="delayed-completion"));
    current=start();const restarted=await current.ready;assert.notEqual(restarted.instanceId,hostReady.instanceId);const recovered=await current.call("get",mission);assert.equal(recovered.mission.state,"waiting_for_user");assert.equal(recovered.mission.steps[0].failure.category,"host_restart");assert.equal(recovered.runs[0].status,hard?"interrupted":"stopped");
    const history=records().find(r=>r.operationId===job.operationId);assert.equal(history.state,hard?"interrupted":"stopped");
    let refusal=null;
    if(merging){assert.ok(existsSync(join(crash.repo,".git/MERGE_HEAD")));assert.ok(existsSync(join(crash.repo,".git/bunny-merge.lock")));refusal=await current.call("direct",{repo:crash.repo,action:"git.merge",params:{branch:"bunny/crash"}});assert.equal(refusal.result.ok,false);assert.deepEqual(repoHashes(crash.repo),stoppedHashes);}
    gate(mode+"-host-crash",{job,hostReady,exit,elapsedMs:exit.at-at,before:beforeCrash,after:afterCrash,head:crash.before,postCrashStatus:crash.git("status","--porcelain"),stoppedHashes,delayedFileMutation:false,delayedCompletion:false,restarted,recovered,history,refusal,callbacksExecuted:!hard});
    current.send({type:"close"});await current.exited;
  }
  const result={ok:true,recordedAt:new Date().toISOString(),label,release,state,workspace,root,gates:gates.map(g=>g.name),productionActivated:false};writeFileSync(join(evidence,"result.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch(error){writeFileSync(join(evidence,"failure.json"),JSON.stringify({error:String(error),stack:error.stack,root},null,2));throw error;}
finally {
  for(const host of hosts)if(host.exitCode===null&&!host.signalCode){host.send({type:"close"});await Promise.race([host.exited,wait(5000)]);if(host.exitCode===null&&!host.signalCode)host.kill();}
  for(const child of watched)if(child.exitCode===null&&!child.signalCode)execFileSync("taskkill.exe",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"pipe"});
  writeFileSync(join(evidence,"cleanup.json"),JSON.stringify({createdHostPids:hosts.map(host=>host.pid),remainingHosts:hosts.filter(host=>alive(host.pid)).map(host=>host.pid),production:identities([baseline.health.pid,baseline.gateway.pid,41220,11020])},null,2));
}
