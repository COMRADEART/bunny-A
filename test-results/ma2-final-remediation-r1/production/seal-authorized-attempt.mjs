import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root='test-results/ma2-final-remediation-r1',now=new Date().toISOString();
// These are current summary records, not historical/live-observation timestamps.
for(const file of ['activation-plan.json','failure-ledger.json','production-sse.json','production-rollback-guard.json','production-approval-restart.json','production-t9.json','production-t9r.json','production-ir-h1.json']){
 const path=root+'/'+file,data=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));data.recordedAt=now;writeFileSync(path,JSON.stringify(data,null,2)+'\n');
}
for(const script of ['secret-audit.mjs','index-evidence.mjs'])process.stdout.write(execFileSync(process.execPath,[root+'/'+script],{encoding:'utf8',maxBuffer:4*1024*1024}));
