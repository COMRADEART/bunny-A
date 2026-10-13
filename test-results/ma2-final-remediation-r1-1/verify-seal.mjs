import assert from 'node:assert/strict';
import {readFileSync,statSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileSha256,verifyRelease,sourceCheck,importClosure} from '../../scripts/bunny-release.mjs';
const root='test-results/ma2-final-remediation-r1-1',read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')),index=read(root+'/evidence/index.json');
const mode=process.argv[2],gitRef=mode==='--staged'?'':mode==='--commit'?(process.argv[3]??'HEAD'):null;
const digest=b=>createHash('sha256').update(b).digest('hex');
const covered=[];
for(const entry of index.entries){const path=root+'/'+entry.path;assert.equal(statSync(path).size,entry.size,path);assert.equal(fileSha256(path),entry.sha256,path);covered.push(path);}
for(const entry of index.externalDocuments){assert.equal(statSync(entry.path).size,entry.size);assert.equal(fileSha256(entry.path),entry.sha256);covered.push(entry.path);}
const actual=[];const walk=dir=>{for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else if(relative(root,p).replaceAll('\\','/')!=='evidence/index.json')actual.push(relative(root,p).replaceAll('\\','/'));}};walk(root);assert.deepEqual(actual.sort(),index.entries.map(e=>e.path).sort(),'Unindexed evidence file');
for(const f of index.immutableHistoricalReferences)assert.equal(fileSha256(f.path),f.sha256,'Historical bytes changed');
assert.equal(index.finalVerdict,'BUNNY_MA2_FINAL_REMEDIATION_R1_1_PASS');assert.ok(index.authorizationObtained&&index.activationPerformed&&!index.finalOperationalPassIssued&&index.freshIndependentReviewRequired&&index.noRawSecrets);
if(gitRef!==null){for(const path of [...covered,root+'/evidence/index.json']){const revision=gitRef+':'+path;const bytes=execFileSync('git',['show',revision],{maxBuffer:15*1024*1024});assert.equal(digest(bytes),fileSha256(path),'Git raw bytes differ: '+path);}}
const pins=index.candidate,artifact=join('releases',pins.release),installed=join(process.env.LOCALAPPDATA,'Bunny-A/releases',pins.release);
assert.equal(fileSha256(artifact+'.zip'),pins.zipSha256);assert.equal(fileSha256(installed+'/release-manifest.json'),pins.manifestSha256);assert.ok(verifyRelease(artifact).ok&&verifyRelease(installed).ok&&sourceCheck(process.cwd(),installed).ok&&importClosure(installed).ok);
const pointer=read(join(process.env.LOCALAPPDATA,'Bunny-A/state/operations/current.json'));for(const item of [...pointer.exports,...pointer.installedGuardedTooling,...pointer.historical])assert.equal(fileSha256(item.path),item.sha256,'Operational/history byte differs');
assert.equal(pointer.release.manifestSha256,pins.manifestSha256);assert.equal(read(root+'/operational-pointer-verification.json').exportedReadOnlyControllerExecuted,true);assert.equal(read(root+'/final-canonical-idle.json').idle.idle,true);assert.equal(read(root+'/secret-audit.json').ok,true);
console.log(JSON.stringify({verdict:index.finalVerdict,entries:index.entries.length,externalDocuments:index.externalDocuments.length,workingBytesVerified:true,gitBytesVerified:gitRef!==null,gitRevision:gitRef,indexSha256:fileSha256(root+'/evidence/index.json'),candidateAndInstalledBytesVerified:true,operationalExportsAndHistoryVerified:true,priorEvidenceIndexSha256:fileSha256('test-results/ma2-final-remediation-r1/evidence/index.json')}));
