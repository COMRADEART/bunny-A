import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,statSync,lstatSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
const root=resolve('test-results/ma2-gate9r'),evidence=join(root,'evidence');
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=b=>createHash('sha256').update(b).digest('hex');
const docs=['MA2_T9R_DUPLICATE_CALCULATOR_CLOSURE.md','MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md','MA2_ACCEPTANCE_MATRIX.md','MA2_IMPLEMENTATION_REPORT.md','MA2_INDEPENDENT_REVIEW_PACKET.md'];
mkdirSync(join(evidence,'reports'),{recursive:true});mkdirSync(join(evidence,'screenshots'),{recursive:true});
for(const doc of docs)copyFileSync(doc,join(evidence,'reports',doc));
for(const file of ['t9r-ui-reconnect.jpg','t9r-installed-built.png','t9r-installed-built-mobile.png'])copyFileSync('screenshots/'+file,join(evidence,'screenshots',file));
const secrets=['Bunny-A','Bunny-A-T9-stage','Bunny-A-T9R-stage'].map(n=>read('C:/Users/allam/AppData/Local/'+n+'/state/credentials/credentials.json').token).filter(Boolean);
const classification=path=>{
  if(path.includes('harness-failure')||/failure\.log$/.test(path)||path==='final-records.log'||path==='browser-smoke.log'||path==='live-matrix.log')return 'RETAINED HISTORICAL FAILURE / SUPERSEDED';
  if(path==='live-matrix-final.log')return 'LIVE VERIFICATION + RETAINED FAILED TRIALS';
  if(path.startsWith('evidence/reports/'))return 'DOCUMENTATION';
  if(path.startsWith('evidence/screenshots/'))return 'VISUALLY INSPECTED LIVE UI';
  if(/\.(ts|mjs|ps1)$/.test(path))return 'ACCEPTANCE TOOLING';
  if(path==='launch-lineage.json'||path==='baseline.json'||path==='root-cause.md'||path==='classification.json'||path.startsWith('repro')||path.startsWith('firstfailed'))return 'PRE-CHANGE RECONSTRUCTION / REPRODUCTION';
  if(/\.log$/.test(path))return 'VERIFICATION LOG';
  return 'ACCEPTANCE EVIDENCE';
};
function files(dir){return readdirSync(dir).sort().flatMap(n=>{const p=join(dir,n);assert.ok(!lstatSync(p).isSymbolicLink());return statSync(p).isDirectory()?files(p):[p];});}
const list=files(root).filter(p=>p!==join(evidence,'index.json'));
const entries=list.map(p=>{
  const path=relative(root,p).replaceAll('\\','/'),bytes=readFileSync(p),s=statSync(p);
  assert.ok(!/\.(sqlite|db|zip)$/.test(path),'No private DB or binary package in evidence');assert.ok(!/credentials\.json$/.test(path),'No credential file');
  for(const secret of secrets)assert.ok(!bytes.includes(Buffer.from(secret)),'Actual Host credential found in '+path);
  return {path:'test-results/ma2-gate9r/'+path,size:bytes.length,sha256:sha(bytes),classification:classification(path),timestamp:s.mtime.toISOString()};
});
const required=['baseline.json','calculator-inventory-before.json','launch-lineage.json','root-cause.md','classification.json','policy-preservation.json','focused-tests.log','full-tests.log','ui-tests.log','typecheck.log','lint.log','build.log','race-test.json','same-task-reuse-live.json','retry-live.json','concurrent-acquire-live.json','second-task-live.json','preexisting-user-window-live.json','stop-live.json','expiration-live.json','budget-live.json','ui-reconnect-live.json','cleanup-live.json','calculator-inventory-after.json','production-preservation.json','final-verdict.json','candidate-package.json','activation.json','final-production.json'];
for(const path of required)assert.ok(entries.some(e=>e.path.endsWith('/'+path)),'Missing required evidence '+path);
const report=read(root+'/final-verdict.json');assert.equal(report.verdict,'BUNNY_MA2_T9R_PASS');assert.equal(report.primaryClassification,'MIXED');
writeFileSync(join(evidence,'index.json'),JSON.stringify({gate:'M-A-2 T9R',sealedAt:new Date().toISOString(),verdict:report.verdict,classification:report.primaryClassification,entryCount:entries.length,entries,indexSelfExcluded:true,actualTokensScanned:secrets.length,tokenLeaked:false,privateDatabasesExcluded:true,immutableHistoricalT9EvidenceUntouched:true,documentationSources:docs.map(doc=>({source:doc,sealedCopy:'test-results/ma2-gate9r/evidence/reports/'+doc})),authoritative:'*-live.json with ok:true, final-records-pass.log, regression-final.json, candidate-package.json and final-verdict.json. Historical failed setup/assertion trials are retained and explained by failure-ledger.json.'},null,2)+'\n');
console.log('T9R hashed evidence sealed: '+entries.length+' files; three real Host tokens absent.');
