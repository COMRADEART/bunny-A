# M-A-2 Gate T3 failure injection evidence

This matrix separates controlled fixture inputs from real OS process observations and production
preservation. All outcomes below passed. No T3 test deliberately crashed production, created a
public tunnel or requested a live model session. Independent review remains pending.

Evidence root: `test-results/ma2-gate3/`. Core suite: 521/521, including 33 added T3 application
checks and six added T3 script checks. Native entry boundary checks are additional Windows probes,
not included in that regression count. The package and final installed identities are recorded
in `package-evidence.json`.

| Required area | Input and expected outcome | Evidence / kind |
| --- | --- | --- |
| Unhandled rejection classification | Known safe callback ownership may contain; unknown ownership is fatal even with correlation | `failure.test.ts:97,815`; actual source-entry subprocess test at 854; controlled fixture + real processes |
| Uncaught exception classification | Always conservative controlled exit; no arbitrary continued work | `failure.test.ts:97,854`; real source entry subprocess exits 70 |
| Error serialization | Error/AggregateError/string/number/object/cycle/null/undefined/proxy/accessors; bounded output, no throw | `failure.test.ts:110,154,178,925`; controlled fixtures |
| Operation failure | Rejected session marks one task failed and leaves Host healthy | `failure.test.ts:197`; controlled fixture |
| Scoped subsystem degradation | Dependent work refused; independent task remains eligible | `failure.test.ts:183`; controlled fixture; degraded source dashboard screenshots |
| Fatal transition and refusal | Unknown rejection with blocked cleanup; command/pairing 503 while read inspection stays available; one fatal winner | `candidate-fatal.json`; actual installed entry/process, disposable state |
| Correlation / ownership | Real task/Mission/step/run/request correlation; AsyncLocalStorage alone cannot authorize continue | `failure.test.ts:97,311,774,815`; static policy/owner audit |
| Single terminal state | Stale completion or failure cannot emit both failed/completed; task/event/outcome atomic | `failure.test.ts:217,646,930,949`; controlled fixtures; actual fatal terminal-event record |
| Stop/failure race | Stop wins without resurrection, duplicate terminal outcome or automatic retry | `failure.test.ts:238,980`; existing Mission/cancellation regression |
| Scheduler failure | Affected Mission cannot schedule again; unrelated Mission follows documented policy | `failure.test.ts:260`; controlled scheduler exception |
| Capability rejection / retry ceiling | Failed run; owning Mission failure under its configured retry limit; malformed output cannot strand settling | `failure.test.ts:311,348,551,949`; controlled fixtures |
| Browser async failure | Action exception/refused download becomes structured failure, with no fabricated postcondition or Host crash | `failure.test.ts:373`; existing isolated-browser download/refusal regression |
| Computer exception | UI action exception produces failed action with no fabricated output | `failure.test.ts:400`; controlled UI Automation action fixture, not native desktop fault injection |
| Provider parser / stream / exit | Stdout/normalization throws, stream error and unexpected child exit fail session and stop its owned process | `failure.test.ts:428,466,500`; harmless native child processes, no provider model request |
| Discovery / usage | Rejected probe makes observation unknown/unavailable and does not degrade Host | `failure.test.ts:633`; retained T2 native parser/compatibility suite |
| Telemetry | Throwing sensor iteration reports unavailable and stays local | `failure.test.ts:774`; serial polling/backoff test at 745 |
| SSE client | Broken write, circular serialization and disconnect close only client resources | `failure.test.ts:721`; controlled socket/client fixtures |
| HTTP command | Unexpected handler exception returns safe bounded error with actual request ID; no secret exposed | `failure.test.ts:774`; controlled HTTP fixture; real fatal refusal requests |
| Background timer | Serial iterations do not overlap; errors back off within caps; no detached unhandled promise | `failure.test.ts:745`; callback audit in `MA2_T3_FAILURE_CONTAINMENT.md` |
| Persistence | Task/Mission/run state and terminal evidence roll back; fallback is bounded; uncertain persistence refuses work | `failure.test.ts:646,672,700,949`; controlled SQLite/file failures |
| Controlled exit | Hung capability cleanup cannot hang shutdown; installed Host exits 70 in 3043 ms | `candidate-fatal.json`; actual installed Host; production untouched during injection |
| Owned process shutdown | Native worker 12180 and descendant 29776 gone; sentinel/T1 Host/gateway/M3 identities preserved | `candidate-processes-before.json`, `candidate-processes-after.json`; real Windows process tree proof |
| Honest startup recovery | Task remains failed; run interrupted; step host_restart; Mission waits for review; marker acknowledged after reconciliation | `candidate-fatal.json`, `candidate-recovery.stdout.log`; actual fresh installed Host 9828 |
| Disabled Mission recovery | Reconcile interrupted state even when Missions are OFF, with no scheduler or old session resume | `failure.test.ts:595,908`; actual restart records; controlled copied state |
| Tunnel worker | Three bounded attempts; output callback failure becomes unavailable; cancellation cannot revive backoff | `scripts/bunny-t3.test.mjs:11,35,59`; real disposable worker stand-ins, no public transport |
| Gateway failure | Gateway controlled exit 71 is separate from Host; local Host retains healthy identity | `candidate-gateway.json`; real packaged gateway with only a disposable port shim |
| Crash loop / installed entry | Actual global handlers installed before startup; one launcher attempt, no fatal auto-retry | `scripts/bunny-t3.test.mjs:88`; static launcher audit; actual installed fatal process |
| Retired credential writer | Unsafe helper chain refuses before process/state creation; development defaults outside Git | `failure.test.ts:897`; `scripts/bunny-t3.test.mjs:78,104`; `retired-path-audit.txt`; live retired path inspection |
| T1 state and migration | Layout 2/schema 3/workspace remain authoritative; original rows, protected files and backup preserved after one authorized cutover | full native migration compatibility suite; before/after preservation JSON; real production read-only audit |
| T2 compatibility | Same native 0.153.4 binary validates read/write; unknown future/binary swap do not inherit approval | `native-profile.json`; retained T2 suite in `full-tests-final.log`; native metadata, no model session |
| Installed Windows application | Exact native EXE and shortcuts; actual visible/loaded WPF source; installed Bar self-test exits 0, empty stderr, inspected image | `windows-application.json`, `native-installed.json`; real installed application/Host |
| Native entry evidence boundaries | Bounded append; Git path, hard link and directory link refused without modifying harmless targets | `native-evidence-boundaries.json`; compiled native method, disposable Windows fixtures, Main not invoked |
| Desktop/mobile UI | Visible content, zero console/page errors, zero overflow; healthy installed state and degraded source warning | browser logs and desktop/mobile screenshots; actual dev/candidate/installed package |

Application test file: `src/lib/bunny-host/failure.test.ts`. All line references are from the pinned
T3 source d2088ae9e9121310c54aa58d231a8804075fc41f. Script references are from tooling
1fc19339d2926670c61731ffa46e99a7f3ddce60. Native entry source has its separate final commit/hash.

The normal Vercel build renders with a clean console but its local preview adapter cannot prove a
workstation TCP peer. It correctly shows Connection unavailable. The actual Windows middleware
package verifies live Host integration; no authentication bypass was added for preview QA.

An earlier restricted-shell regression failed Windows process inspection/cleanup; the fully
authorized native rerun passed. Earlier fatal-harness failures were process-query observations,
not production failures; their superseded record is retained. Final cleanup observes no remaining
QA process or listening QA port. Existing share-card placeholder remains for this admin utility.

Not tested: production fatal injection, public tunnel activation, new live model Missions, actual
reboot/logon, physical Android and all T4–T10 acceptance. This evidence does not certify full M-A-2.
