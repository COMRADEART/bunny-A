import {readFileSync,writeFileSync,copyFileSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const root='test-results/ma3/t11';
const read=name=>JSON.parse(readFileSync(join(root,name),'utf8'));
const source=read('source-provenance.json'),reg=read('regression-inventory.json'),live=read('live-model-invocations.json');
const run=read('live/final-pinned/live-run.json'),integrated=read('integrated-mission.json'),matrix=read('adversarial-matrix.json');
const timeline=read('long-run-timeline.json'),concurrent=read('concurrency-matrix.json'),packageResult=read('windows-package-results.json');
const production=read('production-final.json'),duplicates=read('duplicate-side-effect-check.json'),verification=read('independent-verification.json');
const supplemental=read('supplemental-reviewer/results.json');
const completed=timeline.missions.filter(m=>m.state==='completed');
const core={realAgents:live.distinctAgentsWithModelWork>=2,integrated:integrated.result==='PASS',regression:reg.total.pass>=1694&&reg.total.fail===0&&reg.total.skipped===0,
  gates:Object.values(reg.exits).every(code=>code===0),package:packageResult.result==='PASS',production:production.result==='PASS',duplicates:duplicates.duplicatesBySameStep===0,
  recovery:read('host-restart-recovery.json').result==='PASS',verification:verification.result==='PASS',source:source.sourceTreeClean&&run.sourceCommit===source.sourceCommitAtAssembly,
  ui:integrated.faults.uiClosure.matches===true,liveRun:!run.fatal,longRun:timeline.durationMinutes>=30,
  seededReviewer:matrix.rows.find(row=>row.id==='M34').result==='PASS',routing:read('per-task-model-routing.json').result==='PASS',handoffs:read('artifact-provenance.json').result==='PASS',concurrency:concurrent.result==='PASS'};
const verdict=Object.values(core).every(Boolean)?'BUNNY_MA3_T11_PASS_WITH_LIMITATIONS':'BUNNY_MA3_T11_FAIL';
const sourcePin=source.sourceCommitAtAssembly;
const limitations=[
  'All live team inference used one routed local Ollama model. Other eligible models were observed, but hosted-provider diversity and multi-Agent Claude/Codex inference were not exercised.',
  'The RTX 4050 laptop has one 6 GB GPU. Distinct Agent requests overlap; Ollama queues GPU generation. This is concurrent admission and real canonical work, not proof of simultaneous GPU inference.',
  'Local Ollama is an independently managed HTTP service and is not Windows Job-contained. Native contained provider fixtures and the packaged provider/child test passed separately.',
  'Physical phone, LAN, internet tunnel and Windows reboot/logon persistence remain NOT TESTED. T9 limitations remain open.',
  'T11 voice supervision used typed turns in a real disposable voice session and real output playback; it did not repeat microphone capture or complete hands-free acoustic barge-in. T10 voice limitations remain.',
  'The packaged gateway uses the protected production gateway port and was not started there. Packaged Host startup, real planning, native containment, voice worker and shutdown were tested on a disposable listener.',
  'Several 80-row matrix cases are static or scripted-model fixtures. Rows without a direct final assertion are explicitly NOT TESTED; the matrix never claims 80 live cases.',
  'The separate generic Vercel preview renders cleanly but cannot act as this native workstation gateway. Desktop QA uses the actual node-middleware build and has no render divergence from dev.',
  'The administrative dashboard retains the platform share-card placeholder. No new custom branding was required or generated.',
  'The main integrated Mission advisory Reviewer missed the seeded missing id. The Host independently caught it and repaired it. A separate source-pinned real-model focused review reported blocking R1, the Host confirmed the failed check, and the Mission completed after rework. Advisory review remains fallible and never decides canonical success.',
];
writeFileSync(join(root,'limitations.md'),'# T11 limitations\n\n'+limitations.map(item=>'- '+item).join('\n')+'\n');
const facts=[
 ['Exact T10 baseline',`Source \`${source.baseline.t10Source}\`; evidence \`${source.baseline.t10Evidence}\`. F04 ancestry and the 1,694-test starting inventory are recorded in baseline.md.`],
 ['T11 source',`Final source/tooling pin \`${sourcePin}\`. Earlier T11 implementation and repair commits are listed in source-provenance.json.`],
 ['Evidence commit','The separate local evidence commit contains this report and INDEX.sha256. Its exact hash is returned in the final chat; a commit cannot contain its own future hash.'],
 ['Branch',`\`${source.branch}\`. No merge, push or production installation was performed.`],
 ['Files changed',`${source.filesChanged}. Complete source file list is in source-provenance.json; evidence files are indexed below.`],
 ['Architecture','AgentRuntime owns identities; MissionManager owns one graph and scheduler; TaskManager owns child lifecycle; BunnyRouter chooses each model; the Capability Bus and Host verification decide effects and success. No second authority was introduced.'],
 ['Agent identity',`${timeline.agentsCreated.length} durable team identities were recorded across the run. A Coordinator plus Planner exists before planning; specialist members are allocated only after Host plan validation. Model session identity is separate.`],
 ['Roles and delegation','Bounded Planner, Researcher, Implementer, Reviewer, Tester, Documenter and Coordinator roles. One Coordinator approval covers the exact reviewed plan; member roles do not confer principal or consent-owner authority.'],
 ['Real planning',`${live.invocations.filter(item=>item.kind==='plan').length} recorded planner invocations. Actual Ollama receipts, accepted plans and rejected proposals are retained; rejected plans never execute.`],
 ['Plan validation','Schema, dependency cycles/missing edges, file types, requirement coverage, roles, task/Agent budgets, scope, and reserved marker checks. PA-01..04 regressions preserve the reviewed-plan and advisory-data boundaries.'],
 ['Mission execution',`${completed.length} live Missions completed. The scope-reduced Service status team stopped without completing prohibited writes. Other holds/failures, if any, remain recorded rather than being called success.`],
 ['Real Agent inference',`${live.totalReceipts} main-run actual provider receipts; ${live.distinctAgentsWithModelWork} distinct durable Agents with completed model work. Invocation files bind Agent, Task, Mission, provider/model and receipt. The focused Reviewer supplement has ${supplemental.receipts.length} separately retained real receipts and is not added to regression test counts.`],
 ['Model selections','Every model-backed step used BunnyRouter. See per-task-model-routing.json for selected candidates, exclusions and fallbacks; no Project or role permanently pins a model.'],
 ['Concurrency',`Peak ${concurrent.peakConcurrentSteps.peak} overlapping step intervals; ${concurrent.overlappingModelGenerations} overlapping model request intervals. See the single-GPU limitation above.`],
 ['Artifact handoffs','Immutable source/destination Agent and step references, hashes, purpose, and Host verification. A hash mismatch, missing or unverified producer, or corrupt advisory review is refused. Data handoffs carry no executable authority.'],
 ['Independent verification','Final file reads/hash checks and bounded HTML/Markdown/data requirements passed for completed Missions. Offline DOM inspection was a supplementary harness observation, not a substituted Host verdict.'],
 ['Rework and conflicts',`The integrated Mission used ${integrated.mission.reworkRounds} reserved rework round(s). Original failures remain in history. Its first advisory Reviewer missed the seeded id, while the Host correctly withheld completion. In a separate real-model supplement the Reviewer reported blocking R1, the Host independently confirmed it, and rework completed the Mission (${supplemental.result}). Pre-image guards and existing workspace locks refuse foreign changes and serialize writes. ${duplicates.duplicatesBySameStep} duplicate successful writes by the same step.`],
 ['Authorization and budgets','Coordinator-only approval/consent mutation; current scope intersections; finite model/token/task/Agent/retry/concurrency/time budgets. Live removal of filesystem.write stayed effective despite a one-time permission answer.'],
 ['Process containment','Existing F04 native tests and the packaged provider/child Job test passed. Test-owned process trees were used; the independently managed Ollama service was never claimed Job-contained. The live harness npm parent left a test UI child on Windows; its exact PID, creation time and command line were checked before closing that tree. test-ui-cleanup.json records the closed test listener; production and the dev preview remained running.'],
 ['Host recovery','The exact disposable Host was abruptly terminated during work, then restarted. Agent identities, dependencies and checkpoints survived; interrupted inference was requeued under current authority. A separate landed-write regression proves one write before and after recovery.'],
 ['Long-run acceptance',`${timeline.durationMinutes} minutes elapsed on the final pin, ${completed.length} completed substantive team Missions, ${timeline.checkpoints} checkpoints and ${timeline.journalEvents} retained journal events. Work spans test CSVs, Git history, offline pages and documentation; no timer padding was added.`],
 ['Fault injection','Dependency pause/resume, real Ollama stream abort, seeded verification failure and bounded repair, write-scope reduction, exact-PID Host restart and UI closure/reopen. Outcomes are retained in integrated-mission.json and the timeline.'],
 ['Agentic UI','The live UI closed while authorized work continued; reopening after restart matched canonical Mission phase. Live screenshots and closure facts are retained. Dev and desktop-production views were visually checked at laptop and mobile sizes with clean consoles.'],
 ['Bunny Bar and Notch','Shared Host-derived chip facts and role/model separation retained. Horizontal indicators are left of the Notch; vertical indicators are above its interaction area. Windows PowerShell layout fixtures passed; no T11 physical Island interaction is claimed.'],
 ['Voice','Real disposable voice-session typed supervision answered team questions from Host facts, and approval-like speech stayed refused. Push-to-talk and T10 pipeline regressions passed.'],
 ['Calculator','Real Calculator/X53 outcome and evidence classification are recorded in calculator-x53-results.json and the full regression logs.'],
 ['Full regression',`${reg.total.pass}/${reg.total.tests} distinct tests passed, ${reg.total.fail} failed, ${reg.total.skipped} skipped. Parts: ${Object.entries(reg.parts).map(([name,part])=>`${name} ${part.pass}`).join(', ')}. Typecheck, lint and builds passed; lint retains 22 pre-existing warnings.`],
 ['Independent security review','Two recovered terminal reviewers plus fresh lifecycle/handoff/surface adversarial reviews. All reproduced findings were repaired and independently disposed; no unresolved BLOCKER/HIGH. Original failures and follow-up passes are retained.'],
 ['Windows package',`\`${packageResult.release}\`, exact source and tooling pin above. Manifest/import closure, real packaged planning and distinct identities, packaged native provider/child containment, voice worker and graceful shutdown passed. No installation performed.`],
 ['Production preservation','Read-only before/after release, install metadata, process/listener identity, state-table and event comparison is in production-final.json. Permitted provider-observation drift is distinguished from T11 writes; no whole-task byte-equality claim is made.'],
 ['Limitations',limitations.join(' ')],
 ['Evidence root','test-results/ma3/t11/. INDEX.md lists evidence; INDEX.sha256 seals retained files and this report. Runtime state, temporary fixture trees and package payload directories are excluded; their manifests/validation receipts are retained.'],
];
writeFileSync('MA3_T11_MULTI_AGENT_LONG_RUN_ACCEPTANCE.md','# Bunny-A — M-A-3 T11 multi-Agent long-run acceptance\n\n**'+verdict+'**\n\n'+facts.map(([title,body],index)=>`## ${index+1}. ${title}\n\n${body}`).join('\n\n')+'\n\n'+verdict+'\n');
writeFileSync(join(root,'acceptance-verdict.json'),JSON.stringify({verdict,sourcePin,core,limitations,matrix:matrix.totals},null,2)+'\n');
for(const name of ['typecheck','lint','build'])copyFileSync(join(root,'regression-final',name+'.log'),join(root,name+'.log'));
writeFileSync(join(root,'full-regression.log'),['summary.txt','pretest.log','scripts.log','library.log','agent.log','ui.log'].map(name=>'=== '+name+' ===\n'+readFileSync(join(root,'regression-final',name),'utf8')).join('\n'));
copyFileSync(join(root,'windows-package-final/Bunny-A-Windows-MA3-T11-TEST/release-manifest.json'),join(root,'windows-package-release-manifest.json'));
const files=readdirSync(root).filter(name=>/\.(json|md|log|mjs|sha256)$/.test(name)).sort();
writeFileSync(join(root,'INDEX.md'),'# T11 evidence index\n\nFinal source: `'+sourcePin+'`.\n\n'+files.map(name=>'- `'+name+'`').join('\n')+'\n\nNested evidence: `baseline/`, `regression-final/`, `live/final-pinned/`, and independent `review-*` folders. Earlier interrupted/failing runs are preserved but are not counted as final acceptance.\n\nExcluded from sealing/commit: `tmp/`, `preview-state/`, nested review `tmp/`, and `windows-package*/` payloads. Package manifests and native/boot receipts are retained. No production database, credential or raw audio is part of the evidence.\n');
console.log(JSON.stringify({verdict,core,tests:reg.total.pass,duration:timeline.durationMinutes,completedMissions:completed.length}));
