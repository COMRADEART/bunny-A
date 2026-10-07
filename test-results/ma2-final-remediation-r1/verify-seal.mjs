import assert from 'node:assert/strict';
import {readFileSync,statSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileSha256,verifyRelease,sourceCheck,importClosure} from '../../scripts/bunny-release.mjs';
const root='test-results/ma2-final-remediation-r1',indexPath=join(root,'evidence/index.json'),index=JSON.parse(readFileSync(indexPath,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const paths=[...index.entries.map(e=>({path:join(root,e.path),size:e.size,sha256:e.sha256})),...index.externalReports,{path:indexPath,size:statSync(indexPath).size,sha256:fileSha256(indexPath)}];
for(const e of paths){assert.equal(fileSha256(e.path),e.sha256);assert.equal(statSync(e.path).size,e.size);const blob=execFileSync('git',['show','HEAD:'+e.path.replaceAll('\\','/')],{maxBuffer:64*1024*1024});assert.equal(sha(blob),e.sha256,'Committed evidence bytes differ: '+e.path);}
const present=[];const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);if(e.isDirectory())walk(p);else if(p!==indexPath)present.push(relative(root,p).replaceAll('\\','/'));}};walk(root);assert.deepEqual(present.sort(),index.entries.map(e=>e.path).sort());
const release=join('releases',index.release.name),installed=join(process.env.LOCALAPPDATA,'Bunny-A-R1-stage/releases',index.release.name);assert.ok(verifyRelease(release).ok&&verifyRelease(installed).ok&&sourceCheck(process.cwd(),release).ok&&importClosure(release).ok);assert.equal(fileSha256(release+'.zip'),index.release.zipSha256);
const productionStaged=join(process.env.LOCALAPPDATA,'Bunny-A/releases',index.release.name);assert.ok(verifyRelease(productionStaged).ok&&sourceCheck(process.cwd(),productionStaged).ok&&importClosure(productionStaged).ok);assert.equal(fileSha256(join(productionStaged,'release-manifest.json')),index.release.manifestSha256);
assert.equal(fileSha256('MA2_FINAL_INDEPENDENT_REVIEW.md'),index.priorReviewSha256);
console.log(JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),evidenceFiles:index.entries.length,reports:index.externalReports.length,everyCommittedAndWorkingEvidenceByteMatches:true,candidateImmutable:true,previousIndependentReviewUnmodified:true,indexSha256:fileSha256(indexPath),productionActivationAuthorized:index.productionActivationAuthorized,productionActivated:index.productionActivated,productionPreflightPassed:index.productionPreflightPassed}));
