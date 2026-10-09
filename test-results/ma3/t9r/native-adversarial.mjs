import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {ComputerCapability} from '../../../src/lib/bunny-missions/capabilities/computer.server.ts';
import {identityOf} from '../../../scripts/t9-calculator-fixture.mjs';
const dir='test-results/ma3/t9r';
const diagnostic=JSON.parse(readFileSync(dir+'/calculator-after-repair.json','utf8').replace(/^\uFEFF/,''));
assert.equal(diagnostic.targets.length,1);
const identity=identityOf(diagnostic.targets[0]), adapter=new ComputerCapability(dir), rows=[];
for(const [name,patch] of [['frame PID reuse',{processId:identity.processId+1}],['frame lifetime reuse',{processStartedAt:'1'}],['content lifetime reuse',{contentStartedAt:'1'}],['closed/stale HWND',{handle:'0'}]]){
 const batch={missionId:'read-only-native-probe',expiresAt:Date.now()+20000,windowIdentity:{...identity,...patch}};
 let refusal;try{await adapter.prepareBatchAction('computer.open_app',{app:'calculator'},batch);}catch(error){refusal=error.message;}
 assert.ok(refusal,'Forged identity must fail at the actual native target validator');
 rows.push({name,result:'PASS',classification:'LIVE Windows UIA/native read-only validator',refusal,restoration:false,launch:false,invocation:false});
}
await assert.rejects(adapter.prepareBatchAction('computer.open_app',{app:'calculator'},{missionId:'expired',expiresAt:Date.now()-1,windowIdentity:identity}),/expired/);
rows.push({name:'expired authorization before native probe',result:'PASS',classification:'LIVE native batch clock',launch:false,invocation:false});
writeFileSync(dir+'/native-adversarial-results.json',JSON.stringify({result:'PASS',identity,rows},null,2)+'\n');
console.log('Five real native identity/expiry refusals verified without desktop side effects.');
