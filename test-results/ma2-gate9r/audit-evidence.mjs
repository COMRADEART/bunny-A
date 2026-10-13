import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
const root='test-results/ma2-gate9r/';
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const index=read(root+'evidence/index.json');assert.equal(index.entryCount,index.entries.length);
for(const entry of index.entries){const b=readFileSync(entry.path);assert.equal(b.length,entry.size,entry.path);assert.equal(createHash('sha256').update(b).digest('hex'),entry.sha256,entry.path);assert.ok(entry.classification&&entry.timestamp);}
for(const e of read(root+'failure-ledger.json').entries)for(const f of e.evidence)assert.ok(existsSync(root+f),f);
const sections=['Incident','Initial observation','Root cause','Classification','Launch lineage','Product changes','Harness changes','Ownership rules','Same-Task reuse','Retry behavior','Concurrent acquisition','Stop behavior','Expiration / budget behavior','Pre-existing user window behavior','Cleanup behavior','T9 security invariant preservation','Focused tests','Full regression','LIVE VERIFIED','SIMULATED','STATIC VERIFIED','NOT TESTED','BLOCKED','Candidate identity','Production state','Final verdict'];
const report=readFileSync('MA2_T9R_DUPLICATE_CALCULATOR_CLOSURE.md','utf8');assert.ok(report.startsWith('# M-A-2 Gate T9R\n'));for(const s of sections)assert.ok(report.includes('## '+s+'\n'),s);
for(const d of index.documentationSources)assert.equal(readFileSync(d.source,'utf8'),readFileSync(d.sealedCopy,'utf8'));
const full=readFileSync(root+'full-tests.log','utf8'),ui=readFileSync(root+'ui-tests.log','utf8'),focused=readFileSync(root+'focused-tests.log','utf8');
assert.match(full,/tests 251/);assert.match(full,/tests 357/);assert.match(ui,/tests 37/);assert.match(focused,/tests 47/);for(const log of [full,ui,focused]){assert.ok(!/fail [1-9]/.test(log));assert.ok(!/skipped [1-9]/.test(log));}
assert.equal(read(root+'cleanup-live.json').unexplainedBunnyCreatedWindows,0);assert.equal(read(root+'preexisting-user-window-live.json').originalPreserved,true);assert.equal(read(root+'ui-browser.json').errors.length,0);assert.equal(read(root+'candidate-package.json').installedIntegrity.checked,159);assert.equal(read(root+'final-production.json').integrity.checked,156);assert.equal(read(root+'final-production.json').activatedT9R,false);
const historical=read('test-results/ma2-gate9/evidence/index.json');
for(const e of historical.files){const path=historical.base+'/'+e.path,b=readFileSync(path);assert.equal(b.length,e.size,path);assert.equal(createHash('sha256').update(b).digest('hex'),e.sha256,path);}
console.log('T9R evidence audit PASS: '+index.entryCount+' current files; all historical T9 evidence hashes intact; required reports, test counts and preserved production verified.');
