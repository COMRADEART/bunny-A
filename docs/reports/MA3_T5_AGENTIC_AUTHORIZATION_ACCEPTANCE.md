# Bunny-A M-A-3 T5 acceptance

Verdict: **PASS WITH LIMITATIONS** for explicit, finite Agent delegation through the existing Host. Broad CLI/browser/desktop authority and live cross-provider execution are not claimed. No unresolved BLOCKER or HIGH authority issue was found in the implemented boundary or the executed probes.

Exact source commit: `1be6bc0b6e24989fe26b069e7bcc09808079776a` on local branch `codex/ma3-t5-authorization`. Its implementation parent is `78d7ad20f17dc923888c16359ce51d0cb08b8f7e`. Accepted baseline: `70fead3618aa5948f1cc3c8c6a73914f32dec654`. The T1/T2/T3/T4 ancestry and baseline inventory were audited before implementation. Nothing was pushed or deployed. Evidence is committed separately from source.

## Changed files — STATIC VERIFIED

There are **27 source/support files** changed from the accepted baseline. The complete list is in [source-files.txt](test-results/ma3/t5/source-files.txt).

| Surface | Files and purpose |
| --- | --- |
| Host, 4 files | `agent-runtime.server.ts`, `agent-types.ts`, `http.server.ts`, `manager.server.ts`: actual Agent lifecycle, remote offer clamp, and per-attempt Task admission/settlement. |
| Mission authorization, 6 files | `agentic-types.ts`, `agentic-store.server.ts`, `authorization.server.ts`, `commands.server.ts`, `manager.server.ts`, `types.ts`: versioned consent, subordinate SQLite accounting, canonical policy constraints and Host commands. |
| Capability execution, 3 files | `bounded-terminal.server.ts`, `bus.server.ts`, `local.server.ts`: exact pure Node checks, final admission checks, private Host state exclusion, minimal environment and safe Git reads. |
| Adversarial/Host tests, 2 files | `agentic-authorization.test.ts`, `agentic-live.test.ts`: 50 named cases plus 12 supplemental/real-process tests. Existing test files were not deleted, weakened or skipped. |
| Parser, 1 file | `vendor/acorn.ts`: unchanged Acorn 8.18.0 ESM body, upstream digest and MIT license; included in the native package without a runtime npm dependency. |
| UI, 5 files | Island `agent-model.ts`, `agent.tsx`, `mission.css`, `mission.tsx`, and `use-island.ts`: exact scope review, only-shrink adjustment, authorization/denial/revocation and safe pending/latest-admission projections. |
| Execution support, 6 files | `scripts/fixtures/agentic-host-worker.mjs`, `scripts/preview-node-middleware.mjs`, `scripts/preview-platform.mjs`, `startup.sh`, `.gitignore`, `eslint.config.mjs`: isolated Host acceptance, correct native HTTP preview adapter, restartable preview and licensed vendor handling. |

The evidence commit additionally contains this report, the sealed evidence and scoped `.gitattributes` rules that preserve evidence bytes across Windows checkout.

## Existing authority reuse — STATIC VERIFIED; DISPOSABLE LIVE VERIFIED

The path remains AgentRuntime → MissionManager → canonical MA0 Host authorization → Capability Bus/TaskManager → existing adapter, with BunnyRouter retained for model selection. T5 adds constraints and accounting, not a grant-bearing token or an alternate permission engine. Bus execution still calls `decide`; provider execution still uses the existing Mission/provider scope checks. Standing deny/read-only rules win over the new envelope. The Store admission transaction requires a canonical validation callback.

MA2 T9 remains the exact app/target/operation batch mechanism. It can satisfy that specific computer boundary only after current Agent/Mission/step/generation checks; it cannot bypass an identity mismatch or shared T5 limits. MA2 restart invalidation remains in force. T4 checkpoints, replay-safety decisions and Task ownership remain authoritative. No Project-specific provider/model binding was introduced.

The pre-implementation [authorization audit](test-results/ma3/t5/baseline-authorization.md), [contract](test-results/ma3/t5/authorization-contract.md), and [scope/risk matrices](test-results/ma3/t5/scope-matrix.json) distinguish reused mechanisms, extensions and unsupported broad grants.

## Envelope and lifecycle — STATIC VERIFIED; DISPOSABLE LIVE VERIFIED

`ma3.agentic.v1` persists Agent/Mission/nullable Project identity, the canonical user authorization id and provenance, approval/expiration timestamps, capability/action families, canonical roots with identity and operations, risk ceiling, finite actions/duration/concurrency/provider attempts, revision, HMAC integrity, plan reference and Host generation. Exact test commands also bind executable/script hashes, argv, cwd, literal read resources and timeout. See the [documentary schema](test-results/ma3/t5/envelope-schema.json); the runtime validation remains authoritative.

The eight states are PROPOSED, WAITING_FOR_USER, ACTIVE, PAUSED, EXPIRED, REVOKED, EXHAUSTED and COMPLETED. Host proposal construction is immediately persisted for review. An exact current revision plus explicit Host-mediated consent is required to activate it. Every action revalidates current evidence before atomic admission. Failed attempts, retries, provider attempts and verification reads consume allowance; unknown quota never produces unlimited authority. A concurrent final-action probe admitted exactly one action.

Adjustment can only shrink the offered capabilities and finite limits. Stale revisions are refused. A new resource/risk boundary produces an exact Host request and checkpoint. Denials are persisted with a resource/operation fingerprint that ignores model claims; changing provider or wording cannot erase them. A required denied step ends the Mission under the existing T4 failure semantics while preserving completed work.

Pause prevents new admission; Resume reloads current consent and checkpoint. Pause before initial consent is refused so review cannot become stranded. Stop/Revoke persist the block before cancellation. Already admitted effects are retained and reported rather than undone. Restart converts old executable authority into historical evidence, marks unresolved admissions UNKNOWN, and requires fresh reviewed canonical consent. Old request ids, T9 epochs and generation references cannot be reused. See [lifecycle-matrix.json](test-results/ma3/t5/lifecycle-matrix.json).

Private Host credentials, consent database, runtime/process/session/log records and terminal snapshots cannot be delegated as project files. A broadly registered root does not bypass this exclusion. Git reads of a repository containing private Host state are refused. The broad-root probe stages a Host-owned command binding only to challenge real Bus admission; that staged offer construction is not represented as user consent.

## Actual acceptance — DISPOSABLE LIVE VERIFIED

The [multi-action acceptance](test-results/ma3/t5/disposable-live-acceptance.json) used a real disposable HTTP Host, SQLite, AgentRuntime, unsuspended Mission scheduler, Capability Bus and owned Node processes. One explicit consent authorized **7 admissions**: inspect, edit, failing exact check, correction, successful exact check, result inspection and independent file verification. There were **zero redundant covered-action prompts**, two actual terminal checks and one FAILED admission charged to the allowance.

The next action requested deletion of the exact `seed.txt` resource. The Agent checkpointed in WAITING_FOR_USER before execution. Explicit denial preserved the seed and completed result; the required blocked step ended the Agent as FAILED with `AUTHORITY_LOST`, retaining its checkpoints. The test then explicitly stopped the disposable Agent. This failure category records the denied remaining requirement; it does not mean the completed authorized work was lost.

The [restart acceptance](test-results/ma3/t5/restart-authorization.json) ended the first actual Host process and started a fresh PID/generation from the same SQLite. Agent history survived, one admission remained, and the Agent recovered in WAITING_FOR_USER. An old approval id returned 400. Fresh reviewed consent created current canonical authority without replaying an effect. A paired-device expansion returned 400 and a revoked-device command returned 401.

The [revocation race](test-results/ma3/t5/revocation-race.json) queued a real Bus attempt behind a committed revocation: zero admissions. A separate completed write remained after Stop. Browser controls were independently exercised: reduce 20→12, Authorize, observe the deletion boundary, and Revoke. The [UI record](test-results/ma3/t5/ui-acceptance.json) shows STOPPED/REVOKED, three completed admissions and nine remaining actions, with the original seed preserved.

## Model routing and adversarial matrix

[Routing authority](test-results/ma3/t5/routing-authority-proof.json) is **SIMULATED provider I/O with actual TaskManager/Host admission**. Retargeting to Claude was refused before launch because its workspace tools could not honor these tool-free bounds. Retargeting back to Ollama launched once with identical consent/revision/roots. The [retry proof](test-results/ma3/t5/retry-accounting-proof.json) drives actual transient-failure recovery: max=1 prevents a second launch; max=2 records a separate retry admission. No live model success is inferred from these scripted responses.

All **50 A01–A50 probes pass** under their explicitly stated mechanisms: **38 DISPOSABLE LIVE VERIFIED, 11 SIMULATED, 1 STATIC VERIFIED**. The [per-case matrix](test-results/ma3/t5/adversarial-matrix.json) names the admission/storage path and supporting logs for every row. Negative unsupported browser/desktop claims are not counted as successful positive broad delegations. A48 checks finite unknown-usage schema rather than measuring a real provider quota. The physical target and browser network boundaries are covered by the unchanged, explicitly rerun T9/T9R and Browser security tests.

## Regression and render evidence — DISPOSABLE LIVE VERIFIED

| Check | Final result | Evidence |
| --- | --- | --- |
| Existing baseline | 851 distinct: 254 scripts + 517 library + 24 Agent + 56 UI | `baseline.json`, raw baseline logs |
| Full npm test | 857 pass: 254 scripts + 579 library + 24 Agent; zero failures/skips | `regression-npm-test-sealed.log` |
| Full UI suite | 56 pass; zero failures/skips | `ui-sealed-source.log` |
| Distinct total | **913 = 851 existing + 62 new T5**; focused reruns are not added | `test-inventory.json` |
| Focused T5 | 62 pass; zero failures/skips | `focused-committed-source.log` |
| Required focused security | 130 pass; zero failures/skips: IR-H1, SSE/device revocation, restart invalidation, T9/T9R, T3 routing, T4 SQLite recovery and duplicate-work prevention | `security-regression-sealed.log` |
| Windows packaging | 8 existing package/deployment tests pass; isolated package import closure and imports succeed without `node_modules` | `windows-package-regression.log`, `native-package-closure.json` |
| Typecheck | Pass | `typecheck-committed.log` |
| Lint | Zero errors; 22 pre-existing warnings | `lint-final.log` |
| Desktop production build | Pass with the existing native node-middleware build target; DATABASE_URL unset so no external migration | `build-committed-source.log` |
| Dev and built render | Desktop 1280×800 and mobile 390×844 visible and visually inspected; no console/page errors or horizontal overflow; built baseline does not diverge | `browser-committed-dev.log`, `browser-committed-built.log`, four sealed screenshots/verdicts |

The informational share-card note is unchanged for this utility control panel. Existing platform branding is retained. Earlier failures are preserved, including sandbox-denied fixtures, unchanged ownership cleanup/timing failures under concurrent load, intermediate guard import failure and the generic preview adapter diagnostics. The final clean runs above determine acceptance; retries are not hidden or added to the distinct count.

## Production and preservation — LIVE VERIFIED; STATIC VERIFIED

The final read-only [production observation](test-results/ma3/t5/production-final.json) still finds installed **Bunny-A-Windows-v26-MA2-R1**, the same PIDs 52164/16924, creation instants and release executable path. Its database was opened read-only for schema observation; it contains no T5 `agentic_*` tables. Equivalent six/seven-digit timestamp formatting is normalized without weakening lifetime equality; the initial formatting mismatch is retained as evidence.

The four protected reports and `memory/t7-signout-done.md` retain their exact baseline SHA-256 hashes. They were never staged. No production deployment, DB migration, production restart, Startup change, public tunnel, remote-consent/Phone-credential/provider-configuration change, or production Mission/Trigger enablement was performed. Development and acceptance use separate disposable state. The isolated preview remains available. GitHub synchronization remains separate; T6 was not started.

## Limitations — NOT TESTED / deliberately unsupported boundaries

- Terminal delegation supports immutable, exact **pure read/assertion Node checks**, not npm/general shells or arbitrary JavaScript. The positive parser grammar, copied regular-file inputs, minimal environment and ownership checks provide the implemented boundary; Node's permission flag is defense in depth, not a claim of a universal JS sandbox. Editing an approved script requires fresh consent.
- Automatic model delegation supports **tool-free Ollama inference**. Broad Codex/Claude workspace tool sessions are refused when equivalent filesystem/network bounds cannot be enforced. Live model services, automatic live cross-provider refusal/reroute and specialized model behavior were NOT TESTED; scripted I/O proofs are labeled SIMULATED.
- Broad Browser/desktop delegation is not enabled. Existing isolated Browser origin/network safeguards and exact T9 target batches remain. No new physical application, phone, voice, cross-application T6 workflow or multi-Agent collaboration success is claimed.
- Restart always requires fresh reviewed consent. Historical HMAC consistency does not claim protection from an attacker who controls the entire OS/database and its integrity key.
- The generic Vercel preview cannot provide the trusted TCP peer metadata required by the owner gateway and fails closed. The accepted desktop build uses the actual installed Node HTTP adapter. No hosted deployment was performed and no owner-authentication fallback was added.

## Evidence seal — STATIC VERIFIED

Evidence root: `test-results/ma3/t5/`. [INDEX.md](test-results/ma3/t5/INDEX.md) lists exact-byte SHA-256 hashes and [INDEX.sha256](test-results/ma3/t5/INDEX.sha256) seals the index. The report is copied into that evidence set. Text evidence and changed source are scanned for credential patterns and compared privately against the disposable Host credentials; no raw credential values are emitted. See `secret-scan-results.json` for the exact scope and limitations. Failed attempts and raw logs remain reviewable.

BUNNY_MA3_T5_PASS_WITH_LIMITATIONS
