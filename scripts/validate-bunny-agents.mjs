import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { developmentStateDirectory } from "../src/lib/bunny-host/state-paths.server.ts";

if(!process.env.BUNNY_VALIDATION_CREDENTIALS) throw new Error("Validation requires an explicit disposable Host credential path.");
const credentials=JSON.parse(readFileSync(process.env.BUNNY_VALIDATION_CREDENTIALS,"utf8"));
const base=`http://127.0.0.1:${credentials.port}`;
const headers={authorization:`Bearer ${credentials.token}`,"content-type":"application/json"};
async function state() {return (await fetch(`${base}/state`,{headers})).json();}
async function command(action,data) {const response=await fetch(`${base}/command`,{method:"POST",headers,body:JSON.stringify({action,data})});const result=await response.json();if(!response.ok) throw new Error(result.error);return result;}
const providerId=process.env.BUNNY_VALIDATION_PROVIDER ?? "claude";
const directory=resolve(developmentStateDirectory(),"validation",providerId,String(Date.now()));mkdirSync(directory,{recursive:true});
await command("project.add",{name:`Bunny-A ${providerId} deterministic validation`,path:directory});
const project=(await state()).projects.find(p=>p.path===directory);
const provider=(await state()).providers.find(p=>p.id===providerId && p.availability==="ready");
if(!provider) throw new Error("No authenticated coding-agent adapter available. Validation cannot be substituted by Ollama text generation.");
const evidence=[];
async function run(prompt) {
  const result=await command("submit",{prompt,mode:"balanced",projectId:project.id,override:providerId,constraints:{requiresFilesystem:true,requiresTerminal:true,maxRuntimeMs:120000}});
  const taskId=result.task.id;await command("approve",{id:taskId});
  for(let tries=0;tries<130;tries++) {
    const task=(await state()).tasks.find(t=>t.id===taskId);
    if(["completed","failed","stopped"].includes(task.state)) {
      evidence.push({taskId,state:task.state,pid:task.pid,sessionId:task.sessionId,exitCode:task.exitCode,output:task.output,error:task.error});
      if(task.state!=="completed") throw new Error(`${task.state}: ${task.error}`);
      return task;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error("Validation task exceeded its bound.");
}
try {
  const first=await run('Create bunny_agent_test.txt containing exactly "Bunny-A agent execution verified" followed by a newline. Read it back and return its absolute path and exact contents. Do not change other files.');
  const path=join(directory,"bunny_agent_test.txt");const contents=readFileSync(path,"utf8");
  if(contents!=="Bunny-A agent execution verified\n") throw new Error("Disk read-back content mismatch.");
  evidence.push({gate:1,path,contents,passed:true});
  await command("verification.record",{id:first.id,kind:"file"});
  const second=await run('Create hello.py containing exactly print("BUNNY_A_OK") followed by a newline. Run it using python, return stdout and exit code. Do not change other files.');
  const stdout=execFileSync("python",[join(directory,"hello.py")],{cwd:directory,encoding:"utf8",timeout:10000,windowsHide:true});
  if(stdout.trim()!=="BUNNY_A_OK") throw new Error("Python stdout mismatch.");
  evidence.push({gate:2,stdout:stdout.trim(),exitCode:0,passed:true});
  await command("verification.record",{id:second.id,kind:"python"});
  writeFileSync(join(directory,"summary.txt"),"Bunny-A owns tasks in a local Host. The UI can close while an approved task continues. Provider secrets stay on the workstation.\n");
  const third=await run("Read summary.txt and summarize it in one sentence. Include the terms Host, UI, and workstation. Do not modify files.");
  if(!["Host","UI","workstation"].every(word=>third.output.toLowerCase().includes(word.toLowerCase()))) throw new Error("Summary did not cover source facts.");
  evidence.push({gate:3,passed:true});
  writeFileSync(join(directory,"tiny.mjs"),"export const add = (a,b) => a-b;\n");
  const tinyTest='import test from "node:test"; import assert from "node:assert/strict"; import {add} from "./tiny.mjs"; test("addition",()=>assert.equal(add(2,3),5));\n';
  writeFileSync(join(directory,"tiny.test.mjs"),tinyTest);
  const fourth=await run("Fix only tiny.mjs so add returns the sum of its arguments. Run node --test tiny.test.mjs. Report the actual test result. Do not modify the test.");
  if(readFileSync(join(directory,"tiny.test.mjs"),"utf8")!==tinyTest) throw new Error("Agent modified the test instead of fixing its source.");
  const testOutput=execFileSync(process.execPath,["--test","tiny.test.mjs"],{cwd:directory,encoding:"utf8",timeout:10000,windowsHide:true});
  evidence.push({gate:4,taskId:fourth.id,stdout:testOutput,exitCode:0,passed:true});
  console.log(JSON.stringify({passed:true,evidence},null,2));
} catch(error) {
  console.log(JSON.stringify({passed:false,blocker:error.message,evidence},null,2));process.exitCode=1;
} finally {writeFileSync(`test-results/bunny-${providerId}-agent-validation.json`,JSON.stringify(evidence,null,2));}
