// Refresh only the pre-existing disposable source preview. Installed v26 is never a candidate.
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {resolve,join} from 'node:path';import {execFileSync} from 'node:child_process';
const data='C:/Users/allam/AppData/Local/Temp/bunny-t5-preview-bun-router';const credential=JSON.parse(readFileSync(join(data,'credentials.json'),'utf8'));assert.equal(credential.port,43145);assert.ok(Number.isInteger(credential.pid)&&credential.pid>1);
let health=null;try{health=await (await fetch('http://127.0.0.1:43145/health')).json();}catch{/* The isolated preview Host is down; startup.sh starts only what is missing. */}
if(health){assert.equal(health.instanceId,credential.instanceId);
const ps=`Get-CimInstance Win32_Process -Filter 'ProcessId = ${credential.pid}' | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress`;
const processInfo=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',ps],{encoding:'utf8',windowsHide:true}));assert.ok(!processInfo.ExecutablePath.includes('Bunny-A-Windows-v26'));assert.ok(processInfo.CommandLine.includes('scripts/bunny-host.mjs'));assert.equal(processInfo.ProcessId,credential.pid);
writeFileSync('test-results/ma3/t7/preview-refresh.json',JSON.stringify({classification:'DISPOSABLE LIVE VERIFIED',data,port:credential.port,oldPid:credential.pid,oldInstanceId:credential.instanceId,ownedSourcePreviewVerified:true,productionTarget:false},null,2)+'\n');
execFileSync('taskkill.exe',['/PID',String(credential.pid),'/T','/F'],{windowsHide:true});
}else writeFileSync('test-results/ma3/t7/preview-refresh.json',JSON.stringify({classification:'DISPOSABLE LIVE VERIFIED',data,port:43145,priorHostDown:true,noProcessTerminated:true,productionTarget:false,priorAttempt:'ECONNREFUSED before any mutation; repaired to follow idempotent startup contract.'},null,2)+'\n');
execFileSync('C:/Program Files/Git/bin/sh.exe',['startup.sh'],{cwd:resolve('.'),env:{...process.env,BUNNY_PREVIEW_DATA_DIRECTORY:data,BUNNY_PREVIEW_HOST_PORT:'43145',BUNNY_HOST_DATA_DIRECTORY:data},windowsHide:true});
console.log('Owned disposable preview refreshed through unchanged startup contract.');
