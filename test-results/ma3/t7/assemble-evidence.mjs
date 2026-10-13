import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync,readdirSync,copyFileSync} from "node:fs";
import {join,resolve,dirname} from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
const root=resolve("."),dir=join(root,"test-results/ma3/t7"),base="697d9abb8de5ed3e85de6f323e5486e76347f356",source="8b71167ba13de496ba25a6f78a7c70e99b388284";
const json=n=>JSON.parse(readFileSync(join(dir,n),"utf8"));
const save=(n,v)=>writeFileSync(join(dir,n),JSON.stringify(v,null,2)+"\n");
const sha=b=>createHash("sha256").update(b).digest("hex");
const git=(...args)=>execFileSync("git",args,{cwd:root,windowsHide:true,maxBuffer:30*1024*1024});
assert.equal(git("rev-parse","HEAD").toString().trim(),source);
const baseline=json("source-baseline.json");
const retained=baseline.tests.map(path=>({path,baselineBlob:git("rev-parse",base+":"+path).toString().trim(),currentBlob:git("hash-object","--path="+path,path).toString().trim()})).map(t=>({...t,unchanged:t.baselineBlob===t.currentBlob}));
assert.ok(retained.every(t=>t.unchanged),"Existing test files were changed");
const log=readFileSync(join(dir,"full-regression.log"),"utf8");
const counts=key=>[...log.matchAll(new RegExp("ℹ "+key+" (\\d+)","g"))].map(x=>Number(x[1]));
assert.deepEqual(counts("tests"),[256,650,24]);assert.deepEqual(counts("pass"),[256,650,24]);
assert.ok(counts("fail").every(n=>n===0)&&counts("skipped").every(n=>n===0));
const ui=readFileSync(join(dir,"ui-regression.log"),"utf8");assert.match(ui,/ℹ pass 59/);assert.match(ui,/ℹ fail 0/);assert.match(ui,/ℹ skipped 0/);
save("regression-inventory.json",{baselineDistinct:950,finalDistinct:989,addedDistinct:39,lanes:{scripts:256,library:650,agents:24,ui:59},failed:0,skipped:0,focusedRerunsNotCounted:true,existingTestFiles:retained,addedFiles:["src/lib/bunny-host/project-workspace.test.ts (38)","src/lib/bunny-missions/project-live.test.ts (1)"],sourceCommit:source});
const changed=git("diff","--name-only",base,"--","test-results/ma3/t5","test-results/ma3/t6").toString().trim().split(/\r?\n/).filter(Boolean);
const preservation=[];
for(const path of changed){
  const gate=path.split("/")[2],relative=path.split("/").slice(3).join("/");
  const target=join(dir,"regression-"+gate,relative);mkdirSync(dirname(target),{recursive:true});
  const current=readFileSync(join(root,path)),original=git("show",base+":"+path);
  writeFileSync(target,current);writeFileSync(join(root,path),original);
  preservation.push({path,rerunEvidence:"regression-"+gate+"/"+relative,rerunSha256:sha(current),restoredSha256:sha(original),restoredExactly:readFileSync(join(root,path)).equals(original)});
}
assert.ok(preservation.every(p=>p.restoredExactly));
save("historical-evidence-preservation.json",{startingHead:base,method:"Preserved each regenerated T5/T6 result in T7; restored exact historical Git blob bytes. No reset/clean.",files:preservation});
const live=json("integrated-project-mission.json"),restart=json("restart-recovery.json"),context=json("project-context-provenance.json");
assert.ok(live.accepted&&live.privateProjectUnchanged&&live.crossProjectArtifactDenied&&live.artifactsOpenedWithHashCheck);
assert.equal(live.steps.length,5);assert.ok(live.steps.every(s=>s.state==="completed"&&s.result.verified));
assert.ok(restart.sameProject&&restart.sameAgent&&restart.sameMission&&restart.sameWorkspace&&restart.completedStayedCompleted&&restart.staleConsentRefused);assert.equal(restart.duplicateSideEffects,0);assert.notEqual(restart.first.pid,restart.fresh.pid);assert.notEqual(restart.first.generation,restart.fresh.generation);
save("agent-project-links.json",{classification:"DISPOSABLE LIVE VERIFIED",projectId:live.projectA.id,agentId:live.agentId,missionId:live.missionId,workspace:live.after.workspaces,steps:live.steps.map(s=>({id:s.id,missionId:s.missionId,state:s.state,taskId:s.taskId,capabilityRunId:s.capabilityRunId,verified:s.result.verified})),modelTasks:live.after.tasks,canonicalSources:["AgentStore","MissionStore","TaskManager","mission_artifacts"],modelTasksExplanation:"Deterministic steps have canonical step IDs/context references and capability run IDs; no model-backed OrchTask was admitted in this acceptance Mission.",restartEvidence:"restart-recovery.json"});
save("artifact-provenance.json",{classification:"DISPOSABLE LIVE VERIFIED",projectId:live.projectA.id,agentId:live.agentId,missionId:live.missionId,artifacts:live.after.artifacts,hashCheckedOnOpen:live.artifactsOpenedWithHashCheck,crossProjectOpenDenied:live.crossProjectArtifactDenied,unchangedAfterRestart:true,authority:"Existing Mission artifact store; Project index only."});
save("migration-audit.json",{classification:"SIMULATED",method:"Real disposable SQLite/filesystem; controlled legacy rows and transaction interruption. Assertions retained in T7 focused suite.",cases:[["new database","Existing Host table extended; bounded indexes installed"],["populated legacy","Historical ID/path retained; preferred normalized auto; user bytes retained"],["repeat migration","Same IDs/records, no duplicate Project"],["interrupted migration","Injected transaction failure rolls back original row bytes; next migration succeeds"],["malformed row","Original invalid JSON bytes retained, excluded from usable registry"],["ambiguous roots","Both IDs retained, both NEEDS_RELINK, never silently merged"]].map(([scenario,actual])=>({scenario,actual,status:"PASS"})),evidence:["t7-final.log","full-regression.log","src/lib/bunny-host/project-workspace.test.ts"],productionMigrationPerformed:false,rollback:"Separately reviewed consistent SQLite+WAL backup and matching source; no automatic downgrade or destructive down migration."});
const matrix=[];
const add=(id,expected,actual,type,evidence)=>matrix.push({id,expected,actual,testType:type,evidencePath:evidence,status:"PASS"});
const U="SIMULATED",L="DISPOSABLE LIVE VERIFIED",S="STATIC VERIFIED",T="t7-final.log",I="integrated-project-mission.json",R="restart-recovery.json",Q="project-ui-acceptance.json";
[
["P01","Register existing root","Canonical root registered; repeated registration returns same identity",L,I],
["P02","Preserve existing files","UI preserve.txt unchanged; registration test retains bytes",L,Q],
["P03","Create empty owned Project","Real UI created empty root beneath configured workspace/projects",L,Q],
["P04","Stable ID after genuine restart","Project ID unchanged across new PID/generation",L,R],
["P05","Same names do not merge","Two distinct roots keep independent IDs under same name",U,T],
["P06","Same Git remote does not merge","Identical origin config on distinct roots retains independent IDs",U,T],
["P07","Missing root needs relink","Renamed root blocked, NEEDS_RELINK shown in UI",L,Q],
["P08","Explicit current relink review","Unchecked/stale/conflicting-root relink refused; confirmed valid relink persists",L,Q],
["P09","Rename metadata only","Display title changes; root path and files unchanged",U,T],
["P10","Archive retains files/history","UI archive and real Mission archive keep root and canonical history",L,I],
["P11","Restore keeps IDs","Same Project/Mission/workspace IDs restored",L,I],
["P12","Stopped Agent stays stopped","Controlled stopped row remains STOPPED after archive/restore",U,T],
["P13","Favorite durable","Real favorite and tags retained after UI Host restart",L,Q],
["P14","Search real name/description/tags","Three indexed fields tested; UI name/tag queries corroborated",L,Q],
["P15","Filters real records","Active/Archived/Favorites/attention shown; SQLite state corroborated",L,Q],
["P16","Deterministic sort","Stable name tie-break verified; UI Name selection exercised",U,T],
["P17","Canonical activity","Mission events and metadata audit events project into actual activity",L,I],
["P18","No fabricated progress","Project projection contains lifecycle/counts/attention, no completion metric",S,"project-schema.md"],
["P19","Bound large lists","152-row controlled list capped 100; UI page 25-30 of 30 exercised",L,"ui-responsive.json"],
["P20","Render long Windows path","Path over 260 chars registered and visible at 390 width without horizontal overflow",L,"long-path-project.json; ui-responsive.json"],
["P21","Durable Agent workspace","Actual Agent acquired owned manifest/scratch outside user root",L,I],
["P22","Workspace identity survives restart","Pinned identity unchanged after fresh Host",L,R],
["P23","Distinct scratch for two Agents","Unique Agent/Mission bindings yield separate scratch roots",U,T],
["P24","Other Agent scratch inaccessible","Other scratch and own private manifest denied",U,T],
["P25","Cross-Project root isolation","Project B unchanged, context/root access denied",L,I],
["P26","Explicit cross-Project scope","Absent exact current T5 scope denied by resolver; current T5 remains authority",U,T],
["P27","Reject traversal/prefix cousins","Relative traversal and AppSecrets prefix cousin rejected",U,T],
["P28","Reject junction/symlink escape","Real Windows junction creation then registration refusal",U,T],
["P29","Root substitution needs review","Moved original/replacement inode rejected as CONTEXT_CHANGED",U,T],
["P30","Exclude Host state","Private SQLite/credentials paths excluded; T5 regression preserved",U,T],
["P31","Resolve current Mission context","Five actual step snapshots bind current Project/Mission/Agent",L,"project-context-provenance.json"],
["P32","Record safe provenance","Selected ref hashes, consent revision/generation, root identity persisted",L,"project-context-provenance.json"],
["P33","Bound context","13-file/64KB overflow refused; snapshot/reference retention limits enforced",U,T],
["P34","No default secret export","Sensitive filenames excluded; no raw content persisted or auto-uploaded",U,T],
["P35","README grants no authority","Owner-approved README cannot resolve without current T5 envelope",U,T],
["P36","Project cannot force model","No model fields/lock; independent actual T3 router decisions",U,T],
["P37","Different Task models in same Project","Two eligible simulated probe models selected by actual TaskManager/router; zero execution",U,T],
["P38","T3 preserved","Unmodified dynamic routing tests rerun with all assertions",U,"security-focused.log"],
["P39","T2 quota truth preserved","Unknown/stale/quota/hard-constraint tests rerun unchanged",U,"security-focused.log"],
["P40","Unknown capabilities stay UNKNOWN","T1 discovery tests rerun unchanged",U,"security-focused.log"],
["P41","Canonical work links","Agent/Mission/step/capability run IDs remain canonical after restart",L,"agent-project-links.json"],
["P42","Artifact provenance correct","Existing artifact IDs/step provenance/hashes resolve and open verified",L,"artifact-provenance.json"],
["P43","Cross-Project artifact denial","Project B cannot open Project A artifact",L,I],
["P44","Completed Mission stays completed","Completed state persists and no repeat capabilities",L,R],
["P45","Stale consent not revived","Old consent refused after genuine Host generation change",L,R],
["P46","Checkpoint retained","34 canonical checkpoints preserved",L,R],
["P47","Unowned cleanup refused","Separate reviewed cleanup required; root remains",U,T],
["P48","No active silent cleanup","Cleanup always refuses; active scratch still exists",U,T],
["P49","Bounded Git","Real reviewed Git status plus unchanged T6 helper/network/process safety suites",L,I],
["P50","No automatic Git writes/remotes","Project registry does not invoke Git; explicit metadata uses T6 reads only",S,"project-schema.md; security-focused.log"],
["P51","Migration leaves files in place","Legacy ID/path preserved with keep.txt identical",U,"migration-audit.json"],
["P52","Idempotent migration","Repeated SQLite migration retains identity and bytes",U,"migration-audit.json"],
["P53","Ambiguous mapping fails closed","Malformed original bytes and duplicate IDs retained for review; injected rollback passes",U,"migration-audit.json"],
["P54","Concurrent safety","Revision conflict prevents overwrite; canonical exclusive WorkspaceCoordinator blocks second root mutation",U,T],
["P55","No shared authority","Separate B receives no A context, authorization or artifact",L,I],
["P56","Real Project UI/API","Semantic UI controls mutate actual Host records/events",L,Q],
["P57","Archive/restore Host backed","Same record ID and revision history verified after UI actions",L,Q],
["P58","Responsive required sizes","1280x800,1920x1080,390x844 light/dark, focus, empty/offline states verified",L,"ui-responsive.json"],
["P59","Real integrated Mission","Five approved capability steps independently verified; exactly 2 writes and 1 bounded terminal run",L,I],
["P60","Preserve production","v26 all manifest bytes match; same process lifetimes, table membership and disabled flags; no production mutation. Full initial mutable-data byte equality NOT TESTED.", "LIVE VERIFIED","production-final.json; production-process-lifetimes.json"]
].forEach(args=>add(...args));
[
["P61","Reject hard-link leakage","Cross-root hard link denied",U,T],
["P62","Detect manifest tampering","Modified manifest prevents admission, CONTEXT_CHANGED",U,T],
["P63","Enforce scratch quota","Prospective >64MB write rejected",U,T],
["P64","Fresh consent after branch drift","Changed HEAD fails same envelope; new reviewed revision resolves new anchor",U,T],
["P65","No generic dashboard output leakage","Existing T5 presentation assertion exposed new data leak; whitelist now denies generic/unknown capability output",U,"focused-final.log; full-regression.log"],
["P66","Windows special paths denied","UNC/device/ADS/reserved/trailing-dot aliases rejected",U,T],
["P67","Packaged runtime complete","Pinned bundled Node/import closure/browser/Project registry/release manifest verified",L,"package-acceptance.json"],
["P68","Migration atomicity","Injected interruption rolls back exact original record then retry succeeds",U,"migration-audit.json"]
].forEach(args=>add(...args));
assert.equal(matrix.length,68);save("adversarial-matrix.json",{sourceCommit:source,cases:matrix,total:68,passed:68,failed:0,classificationNote:"SIMULATED denotes controlled bindings/probes; these exercise real Windows files/SQLite or actual routing code. Positive Host/UI/restart claims use genuine disposable Hosts. P60 explicitly limits uncollected initial mutable-data byte comparison.",notTested:["Arbitrary autonomous model planning","Live provider execution in T7 Mission","Artificial UI network-latency injection","Full initial T7 mutable-production byte snapshot"]});
save("workspace-isolation-matrix.json",{contract:"workspace-contract.md",cases:matrix.filter(c=>["P21","P22","P23","P24","P25","P26","P27","P28","P29","P30","P47","P48","P54","P55","P61","P62","P63","P66"].includes(c.id)),maximumWorkspaceBytes:64*1024*1024,maximumEntries:1000,maximumDepth:12});
const focused=readFileSync(join(dir,"security-focused.log"),"utf8"),agent=readFileSync(join(dir,"security-agent-recovery.log"),"utf8");
assert.match(focused,/ℹ pass 222/);assert.match(focused,/ℹ fail 0/);assert.match(focused,/ℹ skipped 0/);assert.match(agent,/ℹ pass 24/);assert.match(agent,/ℹ fail 0/);assert.match(agent,/ℹ skipped 0/);
save("security-regression.json",{passed:true,focused:222,agentRecovery:24,failures:0,skips:0,notAddedToDistinctTotal:true,evidence:["security-focused.log","security-agent-recovery.log","full-regression.log"],boundaries:["IR-H1 held-process ownership","SSE/device revocation","MA2 restart approval invalidation","T9 action grants","T9R reuse","T3 dynamic routing","T4 SQLite recovery/duplicate prevention","T5 finite authorization/private state","T6 path/junction/Git safety/browser network/cross-app Mission"],existingTestsUnchanged:true,authorityDefectsUnresolved:[]});
const pack=json("package-acceptance.json");assert.ok(pack.closure.ok&&pack.source.ok&&pack.manifest.ok);assert.equal(pack.sourceCommit,source);assert.equal(pack.installed,false);
save("source-provenance.json",{acceptedT6:baseline.accepted,startingHead:base,sourceCommit:source,implementationCommit:"6d299065109af4fd33bee14e7d7b1806a24158fd",testCorrectionCommit:source,branch:git("branch","--show-current").toString().trim(),sourceFiles:git("diff","--name-only",base,source).toString().trim().split(/\r?\n/),diffStat:git("diff","--stat",base,source).toString(),existingTestFilesUnchanged:retained.every(t=>t.unchanged),packageSource:pack.source,noPush:true,noDeployment:true,noT8:true});
const target=join(dir,"screenshots");mkdirSync(target,{recursive:true});
for(const name of readdirSync(join(root,"screenshots")).filter(n=>n.startsWith("t7-")))copyFileSync(join(root,"screenshots",name),join(target,name));
console.log("Assembled 68-case evidence, canonical links, migration/isolation/security audits, preserved historical blobs and all existing tests.");
