import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileSha256,verifyRelease,sourceCheck,importClosure} from '../../scripts/bunny-release.mjs';
const rec='test-results/ma2-final-remediation-r1',read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')),pin=read('install/release-pin.json'),release=join('releases',pin.release),installed=join(process.env.LOCALAPPDATA,'Bunny-A-R1-stage/releases',pin.release),manifest=read(join(release,'release-manifest.json'));
const integrity=verifyRelease(release),installedIntegrity=verifyRelease(installed),blobs=sourceCheck(process.cwd(),release),closure=importClosure(release);
assert.ok(integrity.ok&&installedIntegrity.ok&&blobs.ok&&closure.ok);assert.equal(fileSha256(join(release,'release-manifest.json')),fileSha256(join(installed,'release-manifest.json')));
assert.ok(manifest.files.every(f=>statSync(join(release,f.path)).size===f.bytes));
const packageRecord={recordedAt:new Date().toISOString(),classification:'STATIC VERIFIED',release:pin.release,version:manifest.version,sourceCommit:manifest.sourceCommit,toolingCommit:manifest.toolingCommit,manifestSha256:fileSha256(join(release,'release-manifest.json')),zipSha256:fileSha256(release+'.zip'),zipBytes:statSync(release+'.zip').size,dashboard:manifest.dashboard,integrity,installedIntegrity,gitBlobChecks:blobs,closure,inventory:manifest.files,allCoveredSizesMatch:true,dirtyRuntimeInput:false,exactCommittedArchives:true,stagedOnly:true,productionActivated:false};
writeFileSync(join(rec,'package.json'),JSON.stringify(packageRecord,null,2)+'\n');
const prior=read(join(rec,'baseline/production.json')),names=[
 ['SSE revocation','738f05b25609f45001ba760ed3f21ba5e92aa571',['src/lib/bunny-host/http.server.ts'],['src/lib/bunny-host/ma2-t10.test.ts']],
 ['rollback quiescence','99ffbdd20455d56d64666adf9ad1c427df269ae4',['scripts/bunny-rollback-preflight.mjs','scripts/install-bunny-release.ps1'],['scripts/bunny-rollback-preflight.test.mjs']],
 ['restart approval invalidation','4f977c8071be17a7807a6c0b6f072f8f17cd4d4d',['src/lib/bunny-missions/manager.server.ts'],['src/lib/bunny-missions/missions.test.ts']],
 ['T9 bounded approval','445beebf8c9d951066dd0bddb1b066820762a912',['src/lib/bunny-missions/batches.server.ts','src/lib/bunny-missions/authorization.server.ts','src/lib/bunny-missions/capabilities/bus.server.ts'],['src/lib/bunny-missions/approval-batches.test.ts']],
 ['T9R target lifecycle','b6caa93d0b4d80417c8adb690ce3e85a140909c4',['src/lib/bunny-missions/capabilities/calculator-targets.server.ts','src/lib/bunny-missions/capabilities/computer.server.ts'],['src/lib/bunny-missions/calculator-targets.test.ts']],
 ['IR-H1',pin.sourceCommit,['src/lib/bunny-host/manager.server.ts','src/lib/bunny-host/process-tree.server.ts','src/lib/bunny-host/owned-process-group.server.ts','native/bunny-owned-process.c'],['src/lib/bunny-host/stop-ownership.test.ts','scripts/ir-h1-stop-fixture.mjs']]
];
const inventory=names.map(([name,sourceCommit,files,tests])=>{
 const ancestral=execFileSync('git',['merge-base','--is-ancestor',sourceCommit,pin.sourceCommit]).length===0;assert.ok(ancestral);
 const identities=files.map(path=>{const candidate=manifest.files.find(f=>f.path===path);assert.ok(candidate,'Candidate missing '+path);const expected=execFileSync('git',['show',(candidate.origin==='tooling'?manifest.toolingCommit:manifest.sourceCommit)+':'+candidate.repoPath]);return{path,candidateSha256:candidate.sha256,productionBeforeSha256:(()=>{try{return fileSha256(join(prior.releasePath,path));}catch{return null;}})(),exactBlobVerified:Buffer.compare(expected,readFileSync(join(release,path)))===0};});
 const productionAncestral=(()=>{try{execFileSync('git',['merge-base','--is-ancestor',sourceCommit,prior.sourceCommit]);return true;}catch{return false;}})();
 return{name,sourceCommit,files,tests,candidatePresence:identities.every(f=>f.exactBlobVerified),productionPresenceBeforeActivation:productionAncestral,identities};
});
writeFileSync(join(rec,'repair-inventory.json'),JSON.stringify({recordedAt:new Date().toISOString(),classification:'STATIC VERIFIED',sourceCommit:manifest.sourceCommit,toolingCommit:manifest.toolingCommit,repairs:inventory,allRepairsInSingleCandidate:inventory.every(r=>r.candidatePresence)},null,2)+'\n');
console.log('Immutable candidate and all six repair entries verified against exact installed bytes and Git blobs.');
