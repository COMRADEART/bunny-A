import {spawnSync} from 'node:child_process';
import {openSync,closeSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve('test-results/ma2-final-remediation-r1');
const config=JSON.parse(readFileSync(process.env.LOCALAPPDATA+'/Bunny-A-R1-stage/install.json','utf8'));
const node=config.currentRelease.folder+'/runtime/node.exe';
const ps=process.env.WINDIR+'/System32/WindowsPowerShell/v1.0/powershell.exe';
function run(name,exe,args){const fd=openSync(root+'/'+name+'.log','w');try{const r=spawnSync(exe,args,{windowsHide:true,stdio:['ignore',fd,fd],timeout:90000});if(r.status!==0)throw new Error(name+' failed: '+r.status+' '+(r.error?.message??''));}finally{closeSync(fd);}}
run('restart-prepare',node,['--experimental-strip-types',root+'/restart-stage.ts','prepare']);
run('rollback-guard',ps,['-NoProfile','-ExecutionPolicy','Bypass','-File',root+'/lifecycle-stage.ps1','-Phase','guard']);
run('restart-crash',ps,['-NoProfile','-ExecutionPolicy','Bypass','-File',root+'/lifecycle-stage.ps1','-Phase','crash']);
run('restart-boot',ps,['-NoProfile','-ExecutionPolicy','Bypass','-File',root+'/boot-stage.ps1']);
run('restart-verify',node,['--experimental-strip-types',root+'/restart-stage.ts','verify']);
console.log('Installed rollback refused before mutation; fresh staged crash invalidated grants and stale decisions without GUI replay.');
