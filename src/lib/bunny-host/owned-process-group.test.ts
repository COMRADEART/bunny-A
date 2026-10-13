import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCommand, resolveCommand } from "../bunny-missions/capabilities/process.server.ts";
import { recoverOwnedGitOperations, windowsArgument, windowsEnvironment, windowsOwnershipModule } from "./owned-process-group.server.ts";
import { stopOwnedChildren } from "./owned-processes.server.ts";
const windows=process.platform==="win32";
const hook=resolve("scripts/fixtures/git-hook-child.mjs");
const launcher=windows?"C:\\Program Files\\Git\\cmd\\git.exe":"git";
const worker=windows?"C:\\Program Files\\Git\\mingw64\\bin\\git.exe":"git";
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
const delay=(ms:number)=>new Promise(done=>setTimeout(done,ms));
function fixture(mode="normal") {
  const root=mkdtempSync(join(tmpdir(),"bunny-t4-unit-")),repo=join(root,"repo"),state=join(root,"state"),log=join(root,"children.jsonl");
  mkdirSync(repo);mkdirSync(state);
  const env={...process.env,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:join(root,"no-global"),GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"never"};
  const git=(...args:string[])=>execFileSync(worker,args,{cwd:repo,env,encoding:"utf8",windowsHide:true,stdio:"pipe"});
  git("init","-b","main");git("config","user.name","T4 fixture");git("config","user.email","fixture@invalid.local");git("config","core.autocrlf","false");git("config","commit.gpgSign","false");
  writeFileSync(join(repo,"file.txt"),"before\n");git("add",".");git("commit","-m","initial");
  const head=git("rev-parse","HEAD").trim();writeFileSync(join(repo,"file.txt"),"after\n");git("add",".");
  writeFileSync(join(repo,".git/hooks/pre-commit"),`#!/bin/sh\nexec '${process.execPath.replaceAll("\\","/")}' '${hook.replaceAll("\\","/")}' '${mode}' '${log.replaceAll("\\","/")}'\n`);
  const controller=new AbortController();
  const run=(file=launcher,timeoutMs=5000)=>runCommand(file,["commit","-m","operation"],{cwd:repo,env,signal:controller.signal,timeoutMs,owner:{dataDirectory:state,missionId:"mission-a",stepId:"step-a",capabilityRunId:"run-a",action:"git.commit"}});
  const children=()=>existsSync(log)?readFileSync(log,"utf8").trim().split(/\r?\n/).map(line=>JSON.parse(line)):[];
  const wait=async()=>{for(let i=0;i<100;i++){if(children().length)return;await delay(40);}throw new Error("Hook did not start.");};
  return {root,repo,state,env,git,head,controller,run,children,wait,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test("T4: Windows argv and environment preserve spaces, quotes, backslashes and empty values",()=>{
  assert.equal(windowsArgument('a"b\\'), '"a\\"b\\\\"');assert.equal(windowsArgument(""),'""');
  assert.throws(()=>windowsArgument("a\0b"));assert.equal(windowsEnvironment({Path:"old",PATH:"new",EMPTY:""}),"EMPTY=\0PATH=new\0\0");
  assert.throws(()=>windowsEnvironment({TOKEN:"bad\0value"}));
});
test("T4: restart marks history interrupted without trusting a persisted PID or handle",()=>{
  const state=mkdtempSync(join(tmpdir(),"bunny-t4-recovery-")),folder=join(state,"runtime/git-operations"),id="00000000-0000-4000-8000-000000000001";
  mkdirSync(folder,{recursive:true});const path=join(folder,id+".json");
  writeFileSync(path,JSON.stringify({schema:"bunny-owned-operation/1",operationId:id,state:"running",launcherPid:process.pid,launcherCreatedAt:1,handle:123}));
  try{assert.equal(recoverOwnedGitOperations(state),1);assert.equal(JSON.parse(readFileSync(path,"utf8")).state,"interrupted");assert.equal(recoverOwnedGitOperations(state),0);assert.ok(alive(process.pid));}finally{rmSync(state,{recursive:true,force:true});}
});
test("T4: native API rejects a foreign external and arbitrary PID authority",{skip:!windows},()=>{
  assert.throws(()=>windowsOwnershipModule().close({pid:process.pid}),/live group identity/);
});
test("T4: absolute launchers resolve canonically and receive ownership",{skip:!windows},()=>{
  for(const folder of ["cmd","bin","mingw64/bin"]){const file=`C:/Program Files/Git/${folder}/git.exe`;assert.ok(existsSync(file));assert.equal(resolveCommand(file)?.owned,true);}
});
for(const folder of ["cmd","bin","mingw64/bin"]) test(`T4: ${folder} launcher normal hook is kernel owned`,{skip:!windows},async()=>{
  const f=fixture();try{const r=await f.run(`C:/Program Files/Git/${folder}/git.exe`);assert.equal(r.exitCode,0);assert.equal(r.ownership?.state,"succeeded");assert.equal(r.ownership?.closed,true);assert.equal(r.ownership?.breakaway,false);assert.notEqual(f.git("rev-parse","HEAD").trim(),f.head);}finally{f.cleanup();}
});
for(const mode of ["sleep","wait-child","nested","output"]) test(`T4: Stop kills ${mode} hook tree and closes output pipes`,{skip:!windows},async()=>{
  const f=fixture(mode);try{const running=f.run();await f.wait();await delay(240);f.controller.abort();const r=await running;await delay(160);assert.equal(r.aborted,true);assert.equal(r.ownership?.state,"stopped");assert.ok(r.durationMs<4000);for(const row of f.children())assert.equal(alive(row.pid),false);assert.equal(f.git("rev-parse","HEAD").trim(),f.head);if(mode==="output")assert.match(r.stdout+r.stderr,/child stdout/);}finally{f.controller.abort();f.cleanup();}
});
for(const mode of ["exit-child","detached"]) test(`T4: successful Git closes job containing ${mode} orphan attempt`,{skip:!windows},async()=>{
  const f=fixture(mode);try{const r=await f.run();assert.equal(r.exitCode,0);await delay(150);for(const row of f.children())assert.equal(alive(row.pid),false);assert.ok(!f.children().some(row=>row.type==="delayed-completion"));}finally{f.cleanup();}
});
test("T4: hook failure is truthful and closes its job",{skip:!windows},async()=>{
  const f=fixture("fail");try{const r=await f.run();assert.notEqual(r.exitCode,0);assert.equal(r.ownership?.state,"failed");assert.equal(f.git("rev-parse","HEAD").trim(),f.head);}finally{f.cleanup();}
});
test("T4: bounded timeout kills hook descendants",{skip:!windows},async()=>{
  const f=fixture("wait-child");try{const r=await f.run(launcher,700);assert.equal(r.timedOut,true);assert.equal(r.ownership?.state,"timeout");await delay(150);for(const row of f.children())assert.equal(alive(row.pid),false);}finally{f.cleanup();}
});
test("T4: two independent Git jobs remain isolated on Stop",{skip:!windows},async()=>{
  const a=fixture("wait-child"),b=fixture("wait-child");const ar=a.run(),br=b.run();
  try{await Promise.all([a.wait(),b.wait()]);await delay(200);a.controller.abort();const result=await ar;assert.equal(result.aborted,true);for(const row of b.children())assert.equal(alive(row.pid),true);b.controller.abort();const second=await br;assert.notEqual(result.ownership?.containerId,second.ownership?.containerId);}finally{a.controller.abort();b.controller.abort();await Promise.allSettled([ar,br]);a.cleanup();b.cleanup();}
});
test("T4: T3 graceful owned-child drain also closes Git job handles",{skip:!windows},async()=>{
  const f=fixture("wait-child");try{const running=f.run();await f.wait();await delay(150);await stopOwnedChildren();const r=await running;assert.equal(r.aborted,true);assert.equal(r.ownership?.state,"stopped");await delay(100);for(const row of f.children())assert.equal(alive(row.pid),false);}finally{f.controller.abort();f.cleanup();}
});

test("T4: hard termination closes the Host's sole job handle without callbacks or delayed commit",{skip:!windows},async()=>{
  const f=fixture("wait-child");
  const host=spawn(process.execPath,["--experimental-strip-types",resolve("scripts/fixtures/git-owned-operation.mjs")],{cwd:f.repo,env:{...f.env,BUNNY_T4_SLEEP_MS:"1800",BUNNY_T4_OPERATION:JSON.stringify({git:launcher,repo:f.repo,state:f.state})},windowsHide:true,stdio:["ignore","ignore","ignore","ipc"]});
  const exit=new Promise(done=>host.once("exit",done));
  try {
    await f.wait();await delay(180);assert.ok(f.children().length>=3);
    host.kill("SIGKILL");await exit;await delay(120);
    for(const row of f.children())assert.equal(alive(row.pid),false);
    await delay(1900);assert.equal(f.git("rev-parse","HEAD").trim(),f.head);assert.ok(!f.children().some(row=>row.type==="delayed-completion"));
    assert.equal(recoverOwnedGitOperations(f.state),1);
  } finally {if(host.exitCode===null&&!host.signalCode)host.kill("SIGKILL");await exit;f.cleanup();}
});

test("T4: explicit CREATE_BREAKAWAY_FROM_JOB is refused by the kernel",{skip:!windows},async()=>{
  const f=fixture(),binary=join(f.root,"breakaway.exe");
  try {
    execFileSync(process.env.BUNNY_NATIVE_CC??"C:\\msys64\\ucrt64\\bin\\gcc.exe",["-std=c11","-O2","-Wall","-Wextra","-Werror",resolve("scripts/fixtures/git-breakaway.c"),"-o",binary],{windowsHide:true,stdio:"pipe"});
    const r=await runCommand(binary,[],{cwd:f.repo,signal:f.controller.signal,timeoutMs:5000,owned:true});
    assert.equal(r.exitCode,0);assert.match(r.stdout,/created=0 error=5/);assert.equal(r.ownership?.breakaway,false);
  } finally {f.cleanup();}
});

test("T4: local GitHub CLI shell wrapper and its Git hook inherit one owned job",{skip:!windows||!existsSync("C:\\Program Files\\GitHub CLI\\gh.exe")},async()=>{
  const f=fixture("wait-child"),gh="C:\\Program Files\\GitHub CLI\\gh.exe";
  const env:NodeJS.ProcessEnv={...f.env,GH_CONFIG_DIR:join(f.root,"gh-config"),GH_NO_UPDATE_NOTIFIER:"1",GH_PROMPT_DISABLED:"1"};
  for(const key of ["GH_TOKEN","GITHUB_TOKEN","GH_ENTERPRISE_TOKEN","GITHUB_ENTERPRISE_TOKEN"])delete env[key];
  let running: ReturnType<typeof runCommand>|undefined;
  try {
    // A local shell alias only: no GitHub request, real token or user config.
    execFileSync(gh,["alias","set","t4-owned-local","git commit -m wrapped-local","--shell"],{cwd:f.repo,env,windowsHide:true,stdio:"pipe"});
    running=runCommand(gh,["t4-owned-local"],{cwd:f.repo,env,signal:f.controller.signal,timeoutMs:5000,owned:true,owner:{dataDirectory:f.state,missionId:"wrapper-mission",stepId:"wrapper-step",capabilityRunId:"wrapper-run",action:"github.local-wrapper-test"}});
    await f.wait();await delay(200);f.controller.abort();const result=await running;
    assert.equal(result.ownership?.launcherPath,gh);assert.equal(result.ownership?.state,"stopped");
    assert.ok(result.ownership?.members.some(member=>/[\\/]git\.exe$/i.test(member.file??"")));
    assert.equal(result.ownership?.capabilityRunId,"wrapper-run");
    await delay(150);for(const row of f.children())assert.equal(alive(row.pid),false);
    assert.equal(f.git("rev-parse","HEAD").trim(),f.head);
  } finally {f.controller.abort();if(running)await running.catch(()=>{});f.cleanup();}
});
