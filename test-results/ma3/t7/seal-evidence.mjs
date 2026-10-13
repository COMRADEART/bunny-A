import assert from "node:assert/strict";
import {readFileSync,writeFileSync,readdirSync,existsSync,copyFileSync} from "node:fs";
import {join,resolve,relative} from "node:path";
import {createHash} from "node:crypto";
const root=resolve("."),dir=join(root,"test-results/ma3/t7");
const hash=b=>createHash("sha256").update(b).digest("hex");
const save=(name,value)=>writeFileSync(join(dir,name),JSON.stringify(value,null,2)+"\n");
const json=n=>JSON.parse(readFileSync(join(dir,n),"utf8"));
const ignored=new Set(["packages","INDEX.sha256","ui-host.log","ui-host-restart.log"]);
const walk=(path,prefix="")=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>{
  if(!prefix&&ignored.has(entry.name))return [];
  const name=prefix+entry.name;
  return entry.isDirectory()?walk(join(path,entry.name),name+"/"):[name];
});
if(process.argv[2]==="verify"){
  const lines=readFileSync(join(dir,"INDEX.sha256"),"utf8").trim().split("\n");
  for(const line of lines){const digest=line.slice(0,64),name=line.slice(66);assert.equal(hash(readFileSync(join(dir,name))),digest,name);}
  assert.ok(readFileSync(join(root,"MA3_T7_PROJECT_WORKSPACE_ACCEPTANCE.md")).equals(readFileSync(join(dir,"MA3_T7_PROJECT_WORKSPACE_ACCEPTANCE.md"))));
  console.log(JSON.stringify({sealedFiles:lines.length,sha256Manifest:hash(readFileSync(join(dir,"INDEX.sha256"))),verified:true}));
  process.exit(0);
}
const required=["baseline.md","project-inventory.json","project-schema.md","migration-audit.json","workspace-contract.md","workspace-isolation-matrix.json","project-context-contract.md","project-context-provenance.json","project-ui-acceptance.json","agent-project-links.json","artifact-provenance.json","adversarial-matrix.json","integrated-project-mission.json","restart-recovery.json","security-regression.json","full-regression.log","ui-regression.log","typecheck.log","lint.log","build.log","production-final.json"];
for(const name of required)assert.ok(existsSync(join(dir,name)),name);
const smoke=json("screenshots/t7-built-pin.json");
assert.equal(smoke.divergesFromBaseline,false);
for(const viewport of Object.values(smoke.viewports)){assert.equal(viewport.horizontalOverflow,false);assert.deepEqual(viewport.consoleErrors,[]);assert.deepEqual(viewport.pageErrors,[]);assert.ok(viewport.bodyTextLen>100);}
const production=json("production-final.json");assert.ok(production.installedManifest.ok&&production.sameProcessIdentities&&!production.agentPerformedProductionMutation);
assert.ok(json("production-process-lifetimes.json").sameCreationTimes);
copyFileSync(join(root,"MA3_T7_PROJECT_WORKSPACE_ACCEPTANCE.md"),join(dir,"MA3_T7_PROJECT_WORKSPACE_ACCEPTANCE.md"));
for(const log of ["ui-host.log","ui-host-restart.log"])if(existsSync(join(dir,log)))copyFileSync(join(dir,log),join(dir,log.replace(".log","-snapshot.log")));
save("failure-ledger.json",{failuresRetained:true,unresolvedRequiredGateFailures:0,repairs:[
  {evidence:["baseline-regression.log","baseline-regression-elevated.log","baseline-ui.log"],issue:"Sandbox Windows temp/ownership restrictions",repair:"Ordinary approved baseline rerun; all 950 pass"},
  {evidence:["typecheck-attempt1.log","typecheck-attempt2.log","typecheck-attempt3.log","typecheck-attempt4.log","typecheck.log","lint-attempt1.log","lint.log"],issue:"Integration typing/lint",repair:"Narrowing/JsonValue projection and control-character validation repaired"},
  {evidence:["integration-attempt1.log","integration-attempt2.log","integration-attempt3.log"],issue:"Runner force-exit/socket handling; T5 guard precedence; standalone scratch location",repair:"Existing runner contracts/guard precedence preserved, Mission-state workspace fallback"},
  {evidence:["focused-attempt1.log","focused-attempt2.log","focused-attempt3.log","focused-final.log"],issue:"Sandbox rename; invalid new-test close call",repair:"Approved rerun; remove nonexistent fixture method"},
  {evidence:["full-regression-attempt1.log","full-regression.log"],issue:"T7 introduced generic command-data leak; existing T5 assertion detected it",repair:"Explicit Project action projection whitelist; original test unchanged and new regression"},
  {evidence:["full-regression-attempt2.log","helper-cleanup-rerun.log","full-regression.log"],issue:"Pre-existing Git-helper cleanup EPERM during concurrent fixture suites",repair:"Isolated unchanged helper passes; isolated final full run passes"},
  {evidence:["full-regression-attempt3.log","full-regression.log","source-provenance.json"],issue:"New retention test expected zero after inserting stopped Agent",repair:"Correct new fixture count only, commit 8b71167; final 989 pass"},
  {evidence:["ui-fixture-repair.json","project-ui-acceptance.json"],issue:"Pending fixture lacked independent verification; absent desktop sheet",repair:"Canonical API stopped rejected seed/replaced it; route Mission links through existing Home"},
  {evidence:["smoke-dev.log","smoke-built-attempt1.log","smoke-built-final.log","smoke-built-aligned.log","smoke-built-pin.log"],issue:"Shadowed browser runtime / unavailable baseline / mismatched fixture data",repair:"Installed browser, completed sequential baseline, same inherited T6 Host; final exact-pin comparison no divergence"},
  {evidence:["production-before.json","production-final.json"],issue:"Initial shadowed LOCALAPPDATA probe; missing full initial production byte snapshot",repair:"Absolute-path read-only final audit; initial byte equality remains explicitly NOT TESTED"},
  {evidence:["preview-refresh.json","preview-refresh.log"],issue:"Preview fixture down",repair:"Idempotent unchanged startup starts only down disposable Host; no process terminated"},
  {evidence:["long-path-project.json"],issue:"Approval review usage limit; first invocation did not execute",repair:"Normal approval retry after user continuation succeeded"},
  {evidence:["regression-inventory.json"],issue:"Assembly compared raw checkout CRLF against Git blobs",repair:"Git-filtered hash comparison proves every existing test unchanged"}
]});
const credentialFiles=[
  join(json("ui-fixture.json").data,"credentials.json"),
  "C:/Users/allam/AppData/Local/Temp/bunny-t5-preview-bun-router/credentials.json",
  "C:/Users/allam/AppData/Local/Temp/bunny-t6-preview-bun-router/credentials.json",
  "C:/Users/allam/AppData/Local/Bunny-A/development/credentials.json",
  "C:/Users/allam/AppData/Local/Bunny-A/development/credentials/credentials.json"
];
const actualSecrets=[];let credentialsCompared=0;
for(const path of credentialFiles)if(existsSync(path)){const value=JSON.parse(readFileSync(path,"utf8"));if(typeof value.token==="string"&&value.token.length>=24){actualSecrets.push(Buffer.from(value.token));credentialsCompared++;}}
assert.ok(credentialsCompared>=3);
const files=walk(dir).filter(n=>!["INDEX.md","secret-scan.json"].includes(n));
let bytes=0;const matches=[],shapeMatches=[];
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,/\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}\b/g,/\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g,/Bearer [A-Za-z0-9._~-]{40,}/g];
for(const file of files){const buf=readFileSync(join(dir,file));bytes+=buf.length;for(const secret of actualSecrets)if(buf.includes(secret))matches.push({file,kind:"actual credential"});if(!/\.(?:png|jpg|jpeg|webp)$/i.test(file)){const text=buf.toString("utf8");for(const [i,pattern] of patterns.entries()){pattern.lastIndex=0;if(pattern.test(text))shapeMatches.push({file,kind:"credential shape",pattern:i});}}}
assert.deepEqual(matches,[],"Actual credential value found in evidence");assert.deepEqual(shapeMatches,[],"Review credential shape before sealing; no matched values printed");
save("secret-scan.json",{classification:"LIVE VERIFIED",passed:true,filesScanned:files.length,bytesScanned:bytes,actualCredentialFilesCompared:credentialsCompared,credentialValuesNeverRecorded:true,matches,shapeMatches,scope:"All selected T7 evidence including screenshots plus exact local Host credential values and private-key/API/PAT/Bearer shapes. No credential contents are exported. Ephemeral state, profiles, databases and package payload are excluded."});
const rows=walk(dir).filter(n=>n!=="INDEX.md").sort();
const index="# T7 evidence index\n\nSource: 8b71167ba13de496ba25a6f78a7c70e99b388284. Branch: codex/ma3-t7-project-workspaces. Verdict: BUNNY_MA3_T7_PASS_WITH_LIMITATIONS.\n\n989 distinct tests pass, zero failures/skips; old 950 retained. 68 adversarial cases pass with individual classifications. Model planning/execution in the real five-step Mission is NOT TESTED. Full initial mutable-production byte snapshot was not collected.\n\nStart with MA3_T7_PROJECT_WORKSPACE_ACCEPTANCE.md, regression-inventory.json, adversarial-matrix.json, integrated-project-mission.json, restart-recovery.json, package-acceptance.json, production-final.json and failure-ledger.json. Contract documents describe subordinate schemas/bounds; UI evidence is actual browser plus durable Host corroboration. regression-t5/ and regression-t6/ retain current reruns while original historical files were restored exactly.\n\nINDEX.sha256 seals every listed file and INDEX.md. Package payload and live append-only UI logs are excluded; package-manifest.json separately seals the pinned package. Snapshot logs retain its start observations. No ephemeral credential/SQLite/profile payload is included. Verify with node test-results/ma3/t7/seal-evidence.mjs verify. Git evidence commit follows the source pin; no push/deploy/T8.\n\n| File | SHA-256 |\n|---|---|\n"+rows.map(name=>"| "+name+" | "+hash(readFileSync(join(dir,name)))+" |").join("\n")+"\n";
writeFileSync(join(dir,"INDEX.md"),index);
const sealed=walk(dir).sort();
writeFileSync(join(dir,"INDEX.sha256"),sealed.map(name=>hash(readFileSync(join(dir,name)))+"  "+name).join("\n")+"\n");
console.log(JSON.stringify({sealedFiles:sealed.length,sha256Manifest:hash(readFileSync(join(dir,"INDEX.sha256"))),sealed:true}));
