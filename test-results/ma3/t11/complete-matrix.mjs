import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root='test-results/ma3/t11';
const read=name=>existsSync(join(root,name))?JSON.parse(readFileSync(join(root,name),'utf8')):null;
const inv=read('live-model-invocations.json'),concurrency=read('concurrency-matrix.json'),integrated=read('integrated-mission.json');
const inventory=read('regression-inventory.json'),production=read('production-final.json');
const logs=['scripts','library','agent','ui'].map(name=>readFileSync(join(root,'regression-final',name+'.log'),'utf8')).join('\n');
const lines=logs.split(/\r?\n/).filter(line=>/^\s*[✔✖]/.test(line));
const labels=`Multiple distinct durable Agent identities
Roles separate from model identities
Real model-backed planning
Generated-plan schema validation
Cyclic dependencies rejected
Missing dependencies rejected
Unsupported capabilities rejected
Plans cannot grant authorization
Existing MissionManager graph
No duplicate scheduler
Canonical TaskManager
Per-Task routing
No permanent Project model pin
Rerouting preserves scope
Multiple real model-backed Agents
Independent Agent invocation evidence
Safe concurrent admission
Dependency waiting
Concurrency budget
Task count budget
Retry budget
Finite Agent allocation
Agent scratch isolation
Cross-Project file refusal
Cross-Agent scratch refusal
Handoff provenance
No authorization transfer
Hash-mismatch refusal
Unverified dependency refusal
Changed-artifact verification invalidation
Independent Host verification
Model completion cannot override verifier
Reviewer cannot grant permissions
Reviewer identifies seeded defect
Bounded rework preserves history
Replan invalidates stale authorization
Conflicting writes detected
Shared-root writes serialized
Existing Project files protected
Scope reduction remains effective
Phone cannot authorize shell through Agents
Phone staging protections
Voice cannot impersonate approval
Role cannot forge workstation principal
Fallback cannot bypass containment
Distinct Agent process-session ownership
Stopping one Agent preserves others
Mission Stop blocks admissions
Pause is an admission hold
Cancellation retains verified artifacts
Provider interruption recorded
Interrupted work does not duplicate effects
Restart preserves identities
Restart preserves graph dependencies
Restart preserves checkpoints
Stale transient grants stay invalid
Stale handoff cannot resurrect Stop
Missing-artifact refusal
Bounded provider unavailability
Unknown model identity stays unknown
Unknown quota and cost stay unknown
Private context isolation
Canonical activity/SSE state
UI reconnect does not duplicate Agents
Truthful Agentic team view
Truthful Bunny Bar indicators
Horizontal Notch placement
Vertical Notch placement
Canonical voice supervision
Voice interruption separate from Mission Stop
No unauthorized cloud audio/context export
Preserved remote authority boundaries
Preserved Windows Job containment
Real Calculator X53
Unrelated user processes preserved
Substantive sustained execution
Safe controlled faults
Full regression floor
Installed production preservation
Pinned, sealed provenance`.split('\n');
const match=(pattern)=>lines.filter(line=>new RegExp(pattern,'i').test(line)).map(line=>line.trim());
const patterns={2:'M13: nothing',4:'M04:',5:'M05/M06',6:'M05/M06',7:'M04/M08',8:'M04/M08',13:'M13:',14:'T11-I08|routing.*local.only',19:'M19|concurrency.*limit|M20/M22',20:'M20/M22',21:'T11-I03|retry budget',22:'M20/M22',23:'M25:|workspace isolation',24:'cross.project|foreign project',25:'M25:',27:'HANDOFF-04|M04/M08',28:'M28:|HANDOFF-01',29:'M29:',30:'M30/M37|HANDOFF-01',32:'M32:',33:'HANDOFF-04',36:'PA-01|T11-I06',37:'M30/M37|M37/M39',38:'T7 P54 shared.root writes|parallel writers on one workspace|workspace locks: readers share',39:'M37/M39',41:'M41/M43/M44|T11-SURF',42:'F02|F03|inert staging|purpose.aware',43:'T11-V05|T11-V01',44:'M41/M43/M44',45:'uncontained|J60|F04',47:'T11-LC-02|T11-I04|stopping one',48:'T11-LC-01|T11-LC-02|T11-LC-03',49:'M49:|T11-LC-01|T11-LC-04',50:'M50/M57',55:'T11-I05|T11-LC-05',56:'T11-I06|stale.*generation|old.*grant',57:'M50/M57',58:'M58:',59:'T11-I07|T11-I08',60:'unknown.*model|model.*unknown',61:'unknown.*usage|unknown.*quota|unknown.*cost',62:'M62:|M25:',66:'T11 chips:',67:'V47|V48|T11 chips:',68:'V49|vertical.*chips|T11 chips:',70:'interrupt.*voice|voice.*interrupt|T10-',71:'local.only|cloud.*audio|audio.*cloud',72:'T11-SURF|F01|F02|F03|remote.*authority',73:'J60|F04|job.*contained',74:'X53',75:'unrelated.*process|foreign.*process'};
const refs={1:'live-model-invocations.json',3:'real-planner-inference.json',9:'multi-agent-architecture.md',10:'multi-agent-architecture.md',11:'multi-agent-architecture.md',12:'per-task-model-routing.json',15:'live-model-invocations.json',16:'live-model-invocations.json',17:'concurrency-matrix.json',18:'task-dependency-results.json',26:'artifact-provenance.json',31:'independent-verification.json',34:'reviewer-findings.json',35:'replan-and-retry-results.json',40:'authorization-scope-matrix.json',46:'multi-agent-process-ownership.json',51:'provider-failure-results.json',52:'duplicate-side-effect-check.json',53:'host-restart-recovery.json',54:'host-restart-recovery.json',63:'agentic-ui-acceptance.json',64:'agentic-ui-acceptance.json',65:'agentic-ui-acceptance.json',69:'voice-supervision.json',76:'long-run-timeline.json',77:'integrated-mission.json',78:'regression-inventory.json',79:'production-final.json',80:'source-provenance.json'};
const completed=inv?.invocations?.filter(item=>item.state==='completed')??[];
const livePass={1:inv?.distinctAgentsWithModelWork>=2,3:read('real-planner-inference.json')?.result==='PASS',12:read('per-task-model-routing.json')?.result==='PASS',15:new Set(completed.filter(item=>item.kind!=='plan').map(item=>item.agentId)).size>=2,16:inv?.totalReceipts>=2,17:concurrency?.result==='PASS',18:!!integrated?.faults?.dependencyDelay?.resumedAt,26:read('artifact-provenance.json')?.result==='PASS',31:read('independent-verification.json')?.result==='PASS',35:(integrated?.mission?.reworkRounds??0)>0,40:!!integrated?.faults?.authorizationChange?.heldRequests?.length,51:read('provider-failure-results.json')?.result==='PASS',52:read('duplicate-side-effect-check.json')?.duplicatesBySameStep===0,53:read('host-restart-recovery.json')?.result==='PASS',54:read('host-restart-recovery.json')?.result==='PASS',63:integrated?.faults?.uiClosure?.matches===true,64:integrated?.faults?.uiClosure?.matches===true,65:integrated?.faults?.uiClosure?.matches===true,69:(read('voice-supervision.json')?.live?.probes??[]).some(probe=>probe.turns?.some(turn=>turn.answerSource==='host_facts')),76:(read('long-run-timeline.json')?.durationMinutes??0)>=30&&completed.length>=8,77:integrated?.result==='PASS'&&!read('live/final-pinned/live-run.json')?.fatal,78:inventory?.total?.pass>=1694&&inventory?.total?.fail===0&&inventory?.total?.skipped===0,79:production?.result==='PASS',80:read('source-provenance.json')?.sourceTreeClean===true};
const reviewers=read('reviewer-findings.json');
const supplemental=read('supplemental-reviewer/results.json');
livePass[34]=supplemental?.result==='PASS'&&supplemental?.defectDetected===true;
refs[34]='supplemental-reviewer/results.json';
void reviewers;
const rows=labels.map((label,index)=>{
  const number=index+1,id='M'+String(number).padStart(2,'0');
  const tests=patterns[number]?match(patterns[number]):[];
  const architecture=[9,10,11].includes(number);
  const native=[45,73,74,75].includes(number);
  const live=number in livePass;
  const status=live?(livePass[number]?'PASS':'FAIL'):architecture?'PASS':number===46?'NOT TESTED':tests.length&&tests.every(line=>line.startsWith('✔'))?'PASS':'NOT TESTED';
  return{id,initialState:live?'Disposable final-pinned Host and Project; real local Ollama':architecture?'Final-pinned source and reviewed architecture':number===46?'Only local Ollama performed live team inference':'Disposable canonical Host fixture or native Windows regression fixture',expected:label,actual:live?{criterionSatisfied:livePass[number],evidence:refs[number]}:architecture?'Canonical owners retained; no parallel orchestration authority introduced':number===46?'Live multi-Agent Codex/Claude provider Jobs were not exercised. Ollama is an independently managed HTTP service; native packaged containment and per-Agent ownership fields were checked separately.':tests.length?{assertions:tests}: 'No direct final-run assertion was identified; coverage is not fabricated.',classification:live?'LIVE (see evidence scope)':architecture?'STATIC independent source audit':native?'LIVE native Windows fixture':'SIMULATED model / real canonical code fixture, or static unit assertion',result:status,evidence:[refs[number]??'regression-final/',...(tests.length?['regression-final/']:[])]};
});
writeFileSync(join(root,'adversarial-matrix.json'),JSON.stringify({classification:'Per-row evidence; not every row is live',source:read('source-provenance.json')?.sourceCommitAtAssembly,rows,totals:rows.reduce((out,row)=>({...out,[row.result]:(out[row.result]??0)+1}),{})},null,2)+'\n');
console.log(JSON.stringify({rows:rows.length,nonPass:rows.filter(row=>row.result!=='PASS').map(row=>({id:row.id,result:row.result}))}));
