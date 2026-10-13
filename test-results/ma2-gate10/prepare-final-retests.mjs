import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
const root='test-results/ma2-gate10/';
for(const n of ['native-matrix.json','restart-active-before.json'])copyFileSync(root+n,root+n.replace('.json','-v22.json'));
let native=readFileSync(root+'native-matrix.ts','utf8');
native=native.replace("root+name],", "root+'v24-'+name],").replace('return read(name);','return read(\'v24-\'+name);');
native=native.replace("'native-matrix.json'","'native-matrix-v24.json'").replace("'restart-before.json'","'restart-before-v24.json'").replace("'Bunny-A-Windows-v22-T10'","'Bunny-A-Windows-v24-T10'");
// Reset only the two marker files inside the dedicated disposable workspace.
native=native.replace("import {readFileSync,writeFileSync}","import {readFileSync,writeFileSync,rmSync}");
native=native.replace('const beforeValue=await arithmetic();',"const beforeValue=await arithmetic(); for(const file of ['t10-postcondition.txt','t10-revoke-barrier.txt'])rmSync(join('C:/Users/allam/Bunny-Workspace-T10-stage',file),{force:true});");
writeFileSync(root+'native-matrix-v24.ts',native);
for(const name of ['restart-fixture','restart-verify'])writeFileSync(root+name+'-v24.ts',readFileSync(root+name+'.ts','utf8').replaceAll('restart-active-before.json','restart-active-before-v24.json').replaceAll('restart-verified.json','restart-verified-v24.json'));
writeFileSync(root+'ui-gateway-v24.mjs',readFileSync(root+'ui-gateway.mjs','utf8').replaceAll('v22-T10','v24-T10'));
let rollback=readFileSync(root+'rollback-attacks.ts','utf8');
rollback=rollback.replace("root=resolve(stage,'roundtrip-verified')","root=resolve(stage,'roundtrip-v24')").replaceAll('Bunny-Workspace-T10-roundtrip','Bunny-Workspace-T10-roundtrip-v24').replaceAll("createdIn:'v22-T10'","createdIn:'v24-T10'");
rollback=rollback.replace("import {validateTarget", "import {idleCheck} from '../../scripts/bunny-rollback-preflight.mjs';\nimport {validateTarget");
rollback=rollback.replace("const save=(name:string", "const save=(name:string");
rollback=rollback.replace("join(rec,name)","join(rec,'v24-'+name)").replace("'rollback-'+label+'.log'","'v24-rollback-'+label+'.log'").replace("'roundtrip-stop-'+label+'.json'","'v24-roundtrip-stop-'+label+'.json'");
// Reach the real tamper boundary with a healthy quiescent Host first.
rollback=rollback.replace("const tamper=join(root,'tampered');", "assert.equal(boot(cfg.currentRelease,'tamper-positive-host').status,0);running=true;\n const idle=await idleCheck(45149,read(join(state,'credentials/credentials.json')).token,state);assert.equal(idle.idle,true);\n const tamper=join(root,'tampered');");
rollback=rollback.replace("const before=snapshot();assert.equal(boot(cfg.currentRelease,'current').status,0);", "const before=snapshot();assert.equal(boot(cfg.currentRelease,'current').status,0);");
rollback=rollback.replace("await stop('current');", "await idleCheck(45149,read(join(state,'credentials/credentials.json')).token,state);await stop('current');").replace("await stop('older');", "await idleCheck(45149,read(join(state,'credentials/credentials.json')).token,state);await stop('older');").replace("await stop('forward');", "await idleCheck(45149,read(join(state,'credentials/credentials.json')).token,state);await stop('forward');");
writeFileSync(root+'rollback-attacks-v24.ts',rollback);
