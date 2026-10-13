import assert from 'node:assert/strict';
import{readFileSync,readdirSync,openSync,closeSync,writeFileSync,copyFileSync,existsSync}from'node:fs';
import{spawnSync}from'node:child_process';
import{toJSON}from'seroval';
import{join}from'node:path';
import{createHash}from'node:crypto';
const rec='test-results/ma2-gate10/',stage='C:/Users/allam/AppData/Local/Bunny-A-T10-stage';
process.env.PSModulePath='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const config=read(stage+'/install.json'),ssr=join(config.currentRelease.folder,'.output/server/_ssr'),source=readdirSync(ssr).filter(f=>f.endsWith('.mjs')).map(f=>readFileSync(join(ssr,f),'utf8')).join('\n');
const id=source.match(/id: "([a-f0-9]+)",\s*name: "readBunnyHost"/)![1];
const positive=await fetch('http://127.0.0.1:8088/_serverFn/'+id,{method:'POST',headers:{'content-type':'application/json','x-tsr-serverfn':'true',origin:'http://127.0.0.1:8088'},body:JSON.stringify(toJSON({data:{after:0}}))});const text=await positive.text();assert.equal(positive.status,200);assert.ok(text.includes('Bunny-A')&&text.includes('tasks'),'Actual healthy gateway state positive control');
writeFileSync(rec+'gateway-wire-positive.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',status:positive.status,realProtectedStatePositive:true,validSerovalPayload:true,responseSha256:createHash('sha256').update(text).digest('hex')},null,2));
for(const file of ['restart-active-before-v25.json','stage-v25-crash.json','restart-verified-v25.json'])if(existsSync(rec+file))copyFileSync(rec+file,rec+file.replace('.json','-previous.json'));
const run=(file:string,args:string[],label:string)=>{const fd=openSync(rec+label+'.log','w');try{const r=spawnSync('powershell.exe',['-NoProfile','-File',rec+file,...args],{stdio:['ignore',fd,fd],windowsHide:true,timeout:20000});assert.equal(r.status,0,label);}finally{closeSync(fd);}};
await import('./quiesce-stage.ts');await import('./restart-fixture-v25.ts');
run('final-native-operations-v25.ps1',['-Phase','active-rollback'],'final-active-rollback');
run('final-native-operations-v25.ps1',['-Phase','crash'],'v25-final-active-crash');
let booted=false;
try{
 await import('./offline-probe-v25.mjs');
 run('boot-stage.ps1',[],'final-active-boot');booted=true;
 await import('./restart-verify-v25.ts');
}finally{if(!booted)run('boot-stage.ps1',[],'final-recovery-boot');}
