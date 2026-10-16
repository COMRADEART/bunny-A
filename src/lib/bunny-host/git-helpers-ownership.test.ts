import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCommand } from "../bunny-missions/capabilities/process.server.ts";
const windows=process.platform==="win32";
const git="C:\\Program Files\\Git\\mingw64\\bin\\git.exe";
const child=resolve("scripts/fixtures/git-hook-child.mjs");
function fixture(){
  const root=mkdtempSync(join(tmpdir(),"bunny-t4-helper-")),repo=join(root,"repo"),log=join(root,"children.jsonl"),helper=join(root,"helper.sh");mkdirSync(repo);
  const env={...process.env,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:join(root,"no-config"),GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"never"};
  const setup=(...args:string[])=>execFileSync(git,args,{cwd:repo,env,encoding:"utf8",windowsHide:true,stdio:"pipe"});
  setup("init","-b","main");setup("config","user.email","helper@invalid.local");setup("config","user.name","T4 helper");writeFileSync(join(repo,"file.txt"),"base\n");setup("add",".");setup("commit","-m","base");writeFileSync(join(repo,"file.txt"),"staged\n");setup("add",".");
  writeFileSync(helper,`#!/bin/sh\nexec '${process.execPath.replaceAll("\\","/")}' '${child.replaceAll("\\","/")}' wait-child '${log.replaceAll("\\","/")}'\n`);
  const run=(args:string[],extra:NodeJS.ProcessEnv={})=>runCommand(git,args,{cwd:repo,env:{...env,...extra},signal:new AbortController().signal,timeoutMs:1200});
  const rows=()=>existsSync(log)?readFileSync(log,"utf8").trim().split(/\r?\n/).map(line=>JSON.parse(line)):[];
  // Windows releases a killed job's handles on the temp folder asynchronously; rmSync retries EPERM/EBUSY (cleanup only).
  return{root,repo,log,helper,run,rows,cleanup:()=>rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})};
}
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
test("T4: argv reaches Windows executables intact without shell expansion",{skip:!windows},async()=>{
  const args=["space value","",'quoted"value',"tail\\","unicode-é🐇","&&"],root=mkdtempSync(join(tmpdir(),"bunny-t4-argv-"));
  try{const r=await runCommand("node",["-e","console.log(JSON.stringify(process.argv.slice(1)))",...args],{cwd:root,signal:new AbortController().signal,timeoutMs:5000,owned:true});assert.equal(r.exitCode,0);assert.deepEqual(JSON.parse(r.stdout),args);}finally{rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
test("T4: noninteractive Git refuses editor rather than starting a hidden prompt",{skip:!windows},async()=>{
  const f=fixture();try{const r=await f.run(["commit"],{GIT_EDITOR:f.helper});assert.notEqual(r.exitCode,0);assert.match(r.stderr,/editor 'false'/);assert.equal(f.rows().length,0);}finally{f.cleanup();}
});
for(const kind of ["ssh","credential","gpg"])test(`T4: harmless ${kind} helper descendants are owned and timeout kills them`,{skip:!windows},async()=>{
  const f=fixture();try{
    // Only synthetic protocol/host fields enter the local stand-in. Clear every
    // real helper; the alias's nested Git/pipe is also inside this same job.
    const credentialAlias=`!printf 'protocol=https\\nhost=fixture.invalid\\n\\n' | git -c credential.helper= -c "credential.helper=!sh '${f.helper.replaceAll("\\","/")}'" credential reject`;
    const argv=kind==="ssh"?["ls-remote","ssh://fixture.invalid/local"]:kind==="credential"?["-c",`alias.t4helper=${credentialAlias}`,"t4helper"]:["-c",`gpg.program=${f.helper}`,"commit","-S","-m","helper"];
    const env=kind==="ssh"?{GIT_SSH_COMMAND:`sh '${f.helper.replaceAll("\\","/")}'`,GIT_SSH_VARIANT:"ssh"}:{};
    const result=await f.run(argv,env);assert.equal(result.timedOut,true);assert.ok(f.rows().length>=3,`${kind} local stand-in and child started`);for(const row of f.rows())assert.equal(alive(row.pid),false);assert.ok(result.ownership?.members.some(member=>/node\.exe$/i.test(member.file??"")));
  }finally{f.cleanup();}
});
