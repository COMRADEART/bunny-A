# Bunny-A M-A-2 acceptance matrix

| Gate | Result at this checkpoint | Evidence |
|---|---|---|
| T1 state migration | LIVE VERIFIED PASS | installed T1 controller; committed external journal |
| T1 database preservation | LIVE VERIFIED PASS | 23 user tables and SQLite sequence; no lost rows |
| T1 original file retention | LIVE VERIFIED PASS | 54 equal file hashes in both external recovery trees |
| T1 installed Host startup | LIVE VERIFIED PASS | PID 2200; correct source, state, token and schema |
| T1 gateway state access | LIVE VERIFIED PASS | v10 gateway; 54 tasks; clean browser console |
| T1 duplicate startup and migration | LIVE VERIFIED PASS | same Host instance; `already-migrated` |
| T1 installed inventory | LIVE VERIFIED PASS | 140 files; 63 exact source/tooling blobs |
| T1 cloudflared location and identity | LIVE VERIFIED PASS | external binary; version 2026.9.3; equal hashes |
| T1 separate native Host test | SIMULATED PASS | real installed candidate; disposable production snapshot |
| T1 cutover recovery | SIMULATED PASS | Windows controller; three injected failures |
| T1 repository cleanup isolation | SIMULATED PASS | disposable `git clean -fdx` |
| T1 tool hash checks | SIMULATED PASS | missing and changed binary tests |
| T2 Codex compatibility gate | IMPLEMENTED; native runtime LIVE VERIFIED; refusal cases SIMULATED PASS | policy 1; T2 evidence below |
| T3 fatal-error containment | NOT TESTED; not implemented | open |
| T4 Git launcher and hooks | NOT TESTED; not implemented | open |
| T5 current dashboard promotion | NOT TESTED | v10 remains configured |
| T6 public installed tunnel | NOT TESTED | no new public tunnel in T1 |
| T7 real sign-out/sign-in | NOT TESTED | requires a controlled user session |
| T8 later release rollback | NOT TESTED | T1 failure recovery is separate evidence |
| T9 desktop approval policy | NOT TESTED; not implemented | open |
| T10 final operational audit | NOT TESTED | requires completed gates |
| Physical Android | NOT TESTED | no hardware test |
| Actual reboot | NOT TESTED | no reboot |

The final full M-A-2 verdict is NOT ISSUED.
At the T1 baseline, all 439 regression tests passed. Typecheck and build passed.
Lint had 0 errors and 10 existing warnings.
The evidence applies to source `898c52cbb439cbaa738f6a44e89ca4c526591cc9` and tooling `e7f82de8f82fb427bc00fdb19a715b58df32fadf`.

# M-A-2 Gate T2

## IMPLEMENTED

| T2 check | Result | Evidence |
|---|---|---|
| Exact runtime registry and policy version | PASS | `codex-compatibility.server.ts`; policy 1 |
| Both Mission access modes require compatibility | PASS | hard router constraint; Mission approval hook; adapter |
| Manual retarget, including old children | PASS | MissionManager public retarget; router constraint |
| Retry and replan recalculate eligibility | PASS | fresh child routing; launch validation |
| Direct legacy policy | PASS | unchanged argv; separate UI readiness |
| Existing provider observation persistence | PASS | existing JSON; schema 3 unchanged |

## LIVE VERIFIED

| Native check | Result | Evidence |
|---|---|---|
| Codex 0.153.4 exact binary | VALIDATED for read and write | `native-profile.json` |
| Trusted Windows enum | accepted; invalid enum rejected | parser probes and implemented gate |
| All 12 MA1 tool defaults | reported disabled | `features list` parser check |
| T1 and user config preservation after staging | PASS | `preservation-final.json`; equal protected hashes |

Canonical binary: `C:\Users\allam\.codex\packages\standalone\releases\0.153.4-x86_64-pc-windows-msvc\bin\codex.exe`.
SHA-256: `444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b`.

## SIMULATED

| Refusal or policy check | Result |
|---|---|
| Unknown future / old version / other patch | PASS: Mission ineligible |
| Empty / malformed / nonzero / timeout version | PASS: fail closed |
| Failed help / missing required flag or sandbox mode | PASS: fail closed |
| Windows enum or extension control contradiction | PASS: incompatible |
| Same version, different bytes | PASS: no inherited approval |
| Binary replacement after discovery, restored size and mtime | PASS: no model starts |
| Path change before or during checks | PASS: no model starts |
| Version change with unchanged file bytes | PASS: re-probed and refused |
| Stale facts / wrong policy / missing evidence | PASS: ineligible |
| Read and write routing / scoring / manual override | PASS: hard exclusion |
| New and old child retarget / child direct approval | PASS: refused |
| Automatic retry / explicit retry / replan after replacement | PASS: no second model session |
| Stop during metadata probes | PASS: no later model spawn |
| Restart with saved validated facts | PASS: unknown until this Host probes |
| Legacy direct launch and retarget | PASS: deliberate old policy |
| Restricted UI on desktop and mobile | PASS: direct readiness and Mission restriction are separate |
| Installed T2 Host with copied state | PASS: fresh native policy 1 validation; 54 tasks; 13 projects; no model |

## STATIC VERIFIED

482/482 tests: 233 scripts + 228 application + 21 UI. No test was deleted.
Typecheck, lint and builds passed. Lint has 10 existing warnings and no errors.
Dev and desktop middleware browser checks have visible content, no console/page errors and no overflow.
Live temperature caused baseline text drift; both built screenshots were inspected.
The staged candidate also passed desktop and mobile checks with no errors or overflow.
Its baseline flag is true because live temperature changed; body lengths match.
Candidate inventory: 142 exact files. Git check: 65 exact source/tooling blobs.
Host and tunnel import closure passed. The candidate is staged and has not been activated.
Source: `e483f95dd329322d7846b73483fae7aa015d3bce`.
Tooling: `c39d3b76734b6c8a466bfbece1cdb0c0f5152719`.
Read `test-results/ma2-gate2/package-evidence.json` for package identities and final checks.

## NOT TESTED

New live Codex model Mission; production T2 activation; other Codex binaries and platforms.

## BLOCKED

None for T2.

## DEFERRED

T3–T10 and final independent operational review remain open.
T2 does not authorize a full M-A-2 operational verdict.
