import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';

const base=resolve('test-results/ma3/t8');
const source='987afeace77520b9f4ef49e27b137dd01fb3fee8';
const read=name=>JSON.parse(readFileSync(join(base,name),'utf8').replace(/^\uFEFF/,''));
const save=(name,value)=>writeFileSync(join(base,name),JSON.stringify(value,null,2)+'\n');
const md=(name,value)=>writeFileSync(join(base,name),value+'\n');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
assert.equal(git('rev-parse','HEAD'),source);
const live='DISPOSABLE LIVE VERIFIED', stat='STATIC VERIFIED', sim='SIMULATED', nt='NOT TESTED';
const cases=[];
const record=(id,classification,evidence,limit)=>cases.push({id,classification,evidence,...(limit?{limitation:limit}:{})});
for(const id of ['V01','V02','V03','V04','V05','V06','V07'])record(id,live,'responsive-matrix.json; screen-layout-matrix.json; final-corrections; light-dark-screenshots/');
for(const id of ['V08','V09'])record(id,live,'projects-long-light-390.png; final registered Project in ui-final-state.json');
record('V10',stat,'premium.css overflow-wrap:anywhere; no fabricated model catalogue','No real long model identifier was available in the zero-provider fixture.');
record('V11',live,'keyboard-navigation.json; accessibility-observation.json','Navigation and dialog focus were tested; exhaustive keyboard traversal of every subpanel and physical native keyboard are NOT TESTED.');
record('V12',live,'accessibility-results.json: focus outlines and computed token contrast; screenshots','Full screen-reader certification NOT TESTED.');
record('V13',live,'keyboard-navigation.json: browser reduced preference produces 0s transition','OS-level preference toggle NOT TESTED; CSS media rule STATIC VERIFIED.');
record('V14',live,'Models/Devices/screens; useful unconfigured and empty states');
record('V15',stat,'premium.tsx loading counts unknown; projects.tsx Loading Projects…; loading screenshot observed before Host hydration');
record('V16',live,'host-offline.png; native-offline.png + native-offline.json');
record('V17',live,'resume-boundary.png; actual missing-consent notice and reconnect action');
record('V18',live,'stream-live-probe.json; cursor-only signals; secret-scan.json','No private provider transcript was used.');
record('V19',stat,'Host-command mapping; unsupported Talk/Redirect disabled; removed inert web native-only preferences');
record('V20',live,'projects-regression.json; original T7 test lane');
record('A01',live,'ui-final-state.json; Agentic final screenshot');
record('A02',live,'restart-reconnect.json; stable persisted IDs');
record('A03',live,'canonical stopped/revoked, paused, completed and waiting fixtures; final Agent detail');
record('A04',live,'Agentic Activity/Conversation/Results tabs inspected','Free-form Agent messaging unsupported and explicitly disabled.');
record('A05',stat,'currentModelTask projection tests and accepted Mission step.taskId; deterministic UI shows no model Task');
record('A06',sim,'original T3/Task routing tests and currentModelTask tests','No live provider model was selected by the zero-provider UI fixture.');
record('A07',live,'Models screen and Agent execution show exact model unknown / no current model');
record('A08',live,'stream-live-probe.json: 200 handshake, 54 real replay signals; UI canonical updates');
record('A09',sim,'T8 duplicate/out-of-order/epoch tests; original SSE replay suite','Live observed replay chunk has no duplicate; multi-reconnect duplicate prevention relies on tests.');
record('A10',live,'after-built-pause.json; native-pause.json + final paused state');
record('A11',live,'after-built-resume.json; native-pause.json: missing consent refused','Approved-consent Resume is existing runtime SIMULATED/disposable regression coverage.');
record('A12',live,'after-built-controls.json; native-stop.json; original A09 admissions tests');
record('A13',live,'after-ui-denial.json; denied-agent.png; revoked remains revoked after restart');
record('A14',live,'actual Review dialog; reduced-scope.png resource scopes and revision');
record('A15',live,'authorization-ui-acceptance.json: STOPPED/REVOKED acknowledgment');
record('A16',live,'revision 2 reduction; maximumActions 8; filesystem.list removed; original T5 expansion refusal tests');
record('A17',live,'host-offline.png; pending scope review and refusal without consent','Additional-resource executing-task boundary covered by original T5/T6 fixture tests.');
record('A18',live,'Agent detail Mission plan canonical pending read receipt; ui-final-state.json');
record('A19',sim,'verified-result projection tests; original independent verification failure tests');
record('A20',live,'actual Results → Open verified artifact → Open Project; ui-project-a.json');
record('A21',live,'original disposable T7 hash mismatch refusal suite; regression-t7/','Corruption refused in original service test, not introduced through a browser action.');
record('A22',live,'native windows closed/reopened; final Host and paused/pending Agents survived','Closing during a live paid-provider RUNNING session NOT TESTED.');
record('A23',live,'restart-reconnect.json; actual new process epoch and retained identity');
record('A24',stat,'Redirect disabled with explicit unsupported Host explanation; no bypass command');
record('A25',stat,'Talk and Redirect disabled; conversation request separated from actual activity');
record('P01',live,'actual long Project registration in package browser; final canonical registry');
record('P02',live,'actual favorite + search Receipt + Favorites filter + Name sort');
record('P03',live,'actual Private research archive then restore; existing T7 identity tests');
record('P04',live,'original disposable T7 Project A/B artifact isolation tests');
record('P05',stat,'retained T7 Project service and routing; no fixed Project model field');
record('P06',sim,'original T7/T3 dynamic routing tests','No new live cross-provider Project Task pair claimed.');
record('P07',live,'actual Agent artifact → corresponding Project and Project → Agent/Mission links; focus IDs');
record('P08',live,'missing workspace → Files/Workspace → relink confirmation → same active Project');
record('P09',sim,'original T1 discovery tests; unchanged modelCard facts renderer','UI fixture has no discovered provider catalogue; no live fabricated capabilities.');
record('P10',live,'Provider Default — Exact model unknown retained in Models');
for(const id of ['P11','P12','P13','P14'])record(id,sim,'original T1/T2/T3 tests + UI usage tests','UI observed UNKNOWN/UNAVAILABLE; other states verified through sourced-record tests.');
record('P15',live,'original device/stream revocation and TCP-peer authorization tests; bridge uses existing authorizeBridge','No physical phone privileged interaction tested.');
record('P16',live,'Devices mobile screenshot explicitly labels existing pairing and later phone gate');
record('B01',live,'final pinned package WPF SmokeTest opens actual Bar','Test hook launch; production launchers not invoked.');
for(const id of ['B02','B03','B04'])record(id,live,'native-review.json; native-pause.json; screenshots project real canonical Agent/auth state','Pending/paused fixtures; live paid-provider RUNNING projection NOT TESTED.');
record('B05',live,'native-pause.json actual existing Begin-BunnyCommand acknowledgment');
record('B06',live,'native-stop.json two-click boundary confirmation and STOPPED acknowledgment');
record('B07',live,'window closure preserves disposable Host/pending/paused Agent in ui-final-state.json','Closure during live paid-provider RUNNING work NOT TESTED.');
record('B08',live,'successive WPF reopen projects actual Host state; final Host snapshot');
record('B09',live,'native-offline.json + visible native-offline.png after real Host disconnect');
record('B10',stat,'existing voice indicators untouched; no simulated recording or listening added');
record('B11',stat,'native theme/focus resources retained; real WPF controls and names','Physical native keyboard and screen reader NOT TESTED.');
record('B12','LIVE VERIFIED','production-final.json unchanged installed process identities/manifest/settings/schema; native close does not issue Host stop');
assert.equal(cases.length,73);
save('acceptance-matrix.json',{sourceCommit:source,cases,gate:'PASS WITH LIMITATIONS',unresolvedBlockerOrHigh:[],interpretation:'Static, simulated and untested portions are explicit; the gate is not production release readiness or T9.'});

const production=read('production-final.json');
for(const name of ['schemaUnchanged','settingsUnchanged','countsUnchanged','processesUnchanged','startupShaUnchanged'])assert.equal(production[name],true,name);
assert.equal(production.installedManifestVerified.ok,true);
production.absentConfig='No persisted missions_config. Source defaults disable Missions/Triggers. Existing process environment was not inspected; no flag/config change or production restart was issued.';
production.runtimeEnvironmentInspection=nt;
production.earlierT6Rotation='No conclusion about the earlier T6 rotation cause; T8 before/after observed process lifetimes are stable.';
save('production-final.json',production);
const stream=read('activity-stream-acceptance.json');stream.liveAuthenticatedProbe=read('stream-live-probe.json');save('activity-stream-acceptance.json',stream);
const adversarial=read('adversarial-matrix.json');adversarial.cases.push({classification:live,case:'Invalid event cursor / untrusted forwarded peer / cross-site origin / cross-site fetch metadata',evidence:'stream-live-probe.json; all fail closed with no credential exposure'});save('adversarial-matrix.json',adversarial);
const security=read('security-regression.json');security.liveSseBridgeProbe='stream-live-probe.json';save('security-regression.json',security);
const final=read('ui-final-state.json');
const paused=final.agents.agents.find(a=>a.id===read('native-pause.json').agentId);assert.equal(paused.state,'PAUSED');
const pending=final.agents.agents.find(a=>a.id===read('native-pending.json').id);assert.equal(pending.authorization.state,'WAITING_FOR_USER');
save('final-native-continuity.json',{classification:live,hostInstance:final.instanceId,pausedAgent:{id:paused.id,state:paused.state},pendingAgent:{id:pending.id,state:pending.state,authorization:pending.authorization.state},evidence:'Redacted canonical Host snapshot after all native windows were closed; no runtime Stop on UI close.'});
const files=git('diff','--name-only','e668ce2',source).split(/\r?\n/).filter(Boolean);
save('files-changed.json',{classification:stat,sourceCommit:source,branch:git('branch','--show-current'),baselineHead:'e668ce2',files,gitStatusBeforeEvidenceSeal:git('status','--short')});
copyFileSync(join(base,'package/Bunny-A-Windows-v27-MA3-T8-R4-TEST/release-manifest.json'),join(base,'package-manifest.json'));
copyFileSync(join(base,'package/Bunny-A-Windows-v27-MA3-T8-R4-TEST/release-pin.json'),join(base,'package-inherited-release-pin.json'));
const built=read('built-desktop-acceptance.json');
built.legacyVersionMetadata={manifestVersion:'26.0.0-MA2-R1',inheritedReleasePin:'Legacy production v26 pin preserved by unchanged packaging tooling; explicit SourceCommit and toolingCommit pin T8 source '+source,testOnly:true,productionReady:false};
save('built-desktop-acceptance.json',built);
const repairs=`# Retained attempts and repairs

- Initial baseline/native/SQLite/Chromium tests encountered sandbox TEMP/network/CIM restrictions. Original failed logs are retained alongside approved reruns. Approved execution used the same tests and isolated fixture inputs, without auth bypasses.
- typecheck-attempt1.log: missing JSX delimiter in Models layout; corrected. typecheck-attempt2.log: nonexistent OrchTask.route fields; changed to actual canonical routeDecision shape. Final typecheck passes.
- lint-attempt1.log: additional implementation warnings; fixed newly introduced unused symbols/effect dependencies. Final lane has zero errors, 23 warnings, including 22 pre-existing and one export Fast Refresh warning.
- review-fixture.log: seed helper selected an older same-name Agent during repeated fixture setup; changed selection to the newest returned Agent. review-fixture.json records three new requests staying pending without approval for five seconds. No runtime auto-approval conclusion is inferred from this setup failure.
- Visual review found imported @theme tokens were not expanded as expected. Explicit scoped semantic variables repaired actual radii/type/spacing. Existing platform branding is preserved.
- Visual review found web preferences for native-only Island presentation had no web behavior; removed those inert controls and retained actual theme/motion controls.
- An early native screenshot did not visibly expose offline state when collapsed. Final source ${source} makes CompactHealth visible; native-offline.json and screenshot verify the repaired final package.
- Project loading briefly displayed a zero-item count. Final source uses Loading Projects… until the Host list arrives. Final Project screenshots were captured after actual rows appeared.
- Initial stream probe sandbox network rejection and unsupported fetch Host-header override were discarded as a test-harness assumption; the final probe uses actual peer/origin/fetch metadata and verifies four fail-closed requests plus authenticated redacted replay. No authentication weakening was applied.
- R1/R2/R3 local test packages preceded final fixes. Only R4 is final-source acceptance. Package payloads are intentionally excluded from the evidence commit; all retained metadata and logs identify actual provenance. Packaging still carries legacy v26 semantic-version/release-pin metadata; the named R4 TEST package explicitly pins T8 source/tooling and is not installed or claimed as a release candidate.
`;
md('failed-attempts-and-repairs.md',repairs);
let report=readFileSync(join(base,'MA3_T8_PREMIUM_UI_ACCEPTANCE.md'),'utf8');
report=report.replace('BUNNY_MA3_T8_PASS_WITH_LIMITATIONS\n',`## Changed source files and evidence boundary

${files.map(file=>'- '+file).join('\n')}

The 73 requested V/A/P/B cases are mapped in acceptance-matrix.json with evidence classes and per-case limitations. failed-attempts-and-repairs.md preserves setup/compiler/visual repairs. The final test package retains legacy v26 semantic version and release-pin metadata from existing tooling, while release-manifest.json pins the actual T8 source/tooling and R4 TEST package name. No production-release claim is made.

Production runtime environment was not inspected. Its persisted Mission configuration is absent, source defaults disable Missions/Triggers, before/after settings/schema/counts/processes/installed files are unchanged, and no enabling command was issued. The earlier T6 process rotation cause remains unexplained.

Keyboard acceptance covers observed navigation and dialog interactions; exhaustive traversal of every subpanel is not claimed. Live long model identifiers were unavailable; wrapping is statically verified. Both limitations accompany the physical-screen-reader/native-keyboard/phone/DPI limits above.

BUNNY_MA3_T8_PASS_WITH_LIMITATIONS\n`);
writeFileSync(join(base,'MA3_T8_PREMIUM_UI_ACCEPTANCE.md'),report);
writeFileSync(resolve('MA3_T8_PREMIUM_UI_ACCEPTANCE.md'),report);
console.log('73 acceptance cases, final native continuity, production preservation and repairs recorded.');
