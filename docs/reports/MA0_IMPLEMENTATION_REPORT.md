# Bunny-A M-A-0 — Implementation report

October 2, 2026 · branch `ma0-mission-architecture` · baseline `ea0e803` (clean tree, `main`).

Updated for **M-A-0R**, following Review 0's **BUNNY_MA0_REVIEW_PASS_WITH_REMEDIATION**. The original four commits are preserved. Current closure and residual risks: [MA0_REMEDIATION_REPORT.md](MA0_REMEDIATION_REPORT.md); the review packet now requests a narrow remediation rereview.

Architecture: [docs/MA0_ARCHITECTURE.md](../MA0_ARCHITECTURE.md) · [compatibility](../MA0_COMPATIBILITY.md) · [security](../MA0_SECURITY_MODEL.md) · [capabilities](../MA0_CAPABILITY_MODEL.md) · [state machine](../MA0_MISSION_STATE_MACHINE.md) · review packet: [MA0_CLAUDE_REVIEW_PACKET.md](MA0_CLAUDE_REVIEW_PACKET.md).

## Baseline (recorded before any edit)

| Gate | Baseline result | Log |
|---|---|---|
| `npm test` | 205 script + 103 application/Host = 308 pass, 0 fail | `test-results/ma0/baseline-test.log` |
| `npm run test:ui` | 12 pass | `baseline-test-ui.log` |
| typecheck | pass | `baseline-typecheck.log` |
| lint | 0 errors, 10 warnings | `baseline-lint.log` |
| build | pass | `baseline-build.log` |
| Host DB | `user_version` 2; tables tasks, projects, events, outcomes, devices, migrations, policies, settings, providers | live snapshot |
| Live Host | PID 14188, instance `5b8d70f2-7429-48a1-b418-beacb31441f5`, running this checkout | `/health` |

## Reviewed M-A-0 gates (before Review 0)

| Gate | Result | Log |
|---|---|---|
| `npm test` | 205 script + **139** application/Host/mission = 344 pass, 0 fail (36 new mission tests) | `test-results/ma0/final-test.log` |
| `npm run test:ui` | **18** pass (6 new) | `final-test-ui.log` |
| typecheck | pass | `final-typecheck.log` |
| lint | 0 errors, the same 10 pre-existing warnings | `final-lint.log` |
| production build (`npm run build`) | pass | `final-build.log` |
| Live-data migration | all pre-existing rows byte-identical (SHA-256), schema 2→3, idempotent | `live-snapshot-migration.json` |
| Dev render (isolated test Host) | desktop, light theme and 390×844 companion rendered; 0 console errors; 0 px horizontal overflow; 11 screenshots inspected | `screenshots/ma0/` |

Total: 362 tests (baseline 320), 0 failures.

## M-A-0R gates

| Gate | Remediation result | Evidence |
|---|---|---|
| `npm test` | **205/205 script + 166/166 app/Host/mission**, 0 failed/skipped | `test-results/ma0r/full-test.log` |
| `npm run test:ui` | **20/20**, 0 failed/skipped | `test-results/ma0r/ui-test.log` |
| typecheck | exit 0 | `typecheck.log` |
| lint | 0 errors, the same 10 existing warnings | `lint.log` |
| production build | exit 0; existing dependency directive notices; database service migration skipped with auth/database off | `build.log` |
| Migration / legacy rollback read | Both current Host and pre-M2 backup snapshots: all old rows unchanged after two opens; actual `ea0e803` persistence code reads them; source main/WAL unchanged | `migration-evidence.json` |
| Dev / built render | Desktop/mobile visible, no console/page errors or overflow; changed approval and skill cards and buttons pass with isolated RPC fixtures on both | `approval-ui-evidence.json`, `screenshots/ma0r-*` |

**391 tests**, up from the reviewed 362; no tests removed. Raw production smoke's shorter body is its offline Host state, while dev reads the running Host; this is recorded, not represented as an identical connected baseline. Fixture QA verifies the same mission authority UI on both outputs without changing the Host bridge or running any provider. The existing optional share-card placeholder notice remains outside this targeted utility remediation.

## IMPLEMENTED

* **Mission layer** — persisted missions and step graphs; validated mission/step state machines; DAG validation (cycles, unknown dependencies, size); dependency-aware scheduling with parallel independent steps; configurable concurrency (3), steps (12), retries per step (2), replans (2), runtime (120 min), active missions (3).
* **Model steps through TaskManager** — `TaskManager.submit(…, delegated)` and `TaskManager.approveDelegated()`; children routed by the unchanged BunnyRouter, with immutable execution scope carried into the existing provider adapters. Codex read-only sandbox and Claude Read-only tools follow explicit access, regardless of role. Legacy unscoped direct defaults remain. MissionManager imports no provider adapter.
* **Scoped mission authorization** — displayed plan binds step access, finite provider sessions including retries, roots and budgets. Child ≤ step ≤ envelope is checked at launch, including additional direct approval. Retry/reroute preserve access; replan requires a new approval. Direct, envelope, delegated, additional capability and paired-device approvals have distinct audit provenance. Skill requests accurately say **Allow this skill run**.
* **Capability Bus** — manifests, health, single decision function, recorded/redacted runs, events, artifacts, abort/timeout, grant policies enforced (`always_allow, allow_for_mission, ask_every_time, read_only, never_allow`).
* **Local capabilities** — filesystem, terminal (canonical executable identity captured at permission time), git (owned merge transaction with independently bounded conflict/failure/Stop cleanup and explicit results), notifications. Direct capability/skill cwd validation rejects malformed/unauthorized paths without creating folders.
* **Browser Runtime** — isolated profile and checking proxy; all DNS answers checked before each connection, checked literal IP pinned, redirects/subresources/CONNECT/WebSockets covered. Real isolated-browser attempts reach a disposable Bunny Host **zero times**; public fixture navigation succeeds.
* **Computer Runtime (Windows)** — list_windows, read_controls, focus_window, invoke_control (Invoke/Toggle/Select/Expand), type (ValuePattern), capture, open_app (allowlist). `list_windows` verified live; others verified for refusal/permission paths only (see NOT TESTED).
* **GitHub** — `pr_list`, `issue_list`, `repo_view` through the signed-in gh CLI (health verified; queries not executed in tests).
* **Skill Library** — 12 built-in skills, versioning, failure stop + repair candidate, verified promotion, retired history, semantic record/replay.
* **Artifact Bus** — inline/file artifacts with SHA-256, consumers, verification status; dependents get excerpts + references.
* **Mission memory** — bounded, provenance, verified vs. unverified enforced by provenance.
* **Bunny Inbox** — event classification, suggestions, auto-acknowledgement of answered items.
* **Workspace safety** — persisted shared/exclusive locks with nested-path conflicts; writers on one workspace serialized; git worktree isolation per step (`isolation: "worktree"`).
* **Verification** — Bunny's own checks: TaskManager VerifySpec, file exists/contains, command exit code, non-empty git diff, artifact present. Mission result reports verified vs. unverified steps separately.
* **Failure/retry/recovery** — category-specific bounded retries, reroute only when an alternative provider exists, dependency blocking, mission stop with child cancellation (only its own children), Host-restart recovery that never claims resumption.
* **Host API** — 24 mission/capability/skill/trigger/inbox commands, validated, with remote/workstation split; `HostSnapshot.missions` (optional).
* **Feature flag** — off by default; `settings.missions_config` + `BUNNY_MISSIONS`; Settings → Missions toggle.
* **UI** — Bunny Bar mission strip (title, role glyphs ✓ ● ○ ! ✕, +N), expanded Mission Control (approval scope card, permission cards, agent list, agent detail with executor/activity/provider-plan progress/elapsed/artifacts/dependencies/verification, retry/stop, model-call accounting), 8 s completion state + auto-collapse, Task/Mission composer switch, Home and phone mission sections with Inbox, capability availability list.
* **Persistence** — additive schema v3 and 14 tables, recorded migration key, idempotent.

## PARTIALLY IMPLEMENTED

* **Planner** — deterministic heuristic (`bunny-planner-deterministic-v1`): deterministic intents, simple/medium/complex templates, explicit user graphs. No model-assisted planning; replanning re-runs the same planner (completed steps kept).
* **Self-improvement** — evidence is collected (child outcomes via the existing outcomes table and policy engine, capability runs, skill reliability, mission accounting, retries). Candidate/replay/promote/rollback exists for routing policy (pre-existing) and skills (new). No candidate *mission-planning* policy generation.
* **Provider/resource routing for missions** — mode per reasoning level, local preference, budget-forced local, reviewer independence (deny producer provider when an alternative exists). No quota-aware scheduling beyond what BunnyRouter already does.
* **Phone companion** — remote mission create/inspect/approve/respond/stop implemented and HTTP-tested with a paired device token; mission section renders in the companion view. Not exercised through the public tunnel or on a phone.
* **Resource accounting** — runtime, cloud vs. local model calls, deterministic steps, retries, provider-reported tokens. No dollar cost (not available).

## ARCHITECTURE ONLY

* Email, calendar, messaging, SMS, WhatsApp, phone/voice connectors: manifests + `CommunicationProvider` contract; report **unconfigured**; nothing simulated.
* GitHub mutations (`pr_create`, `comment`): contract only.
* Triggers from filesystem, GitHub, message, email, calendar sources: in the contract; creation refused ("no event feed on this Host yet").
* Inbox Supervisor decisions: rule-based suggestion only; nothing acts automatically.
* Persistent-permission UI: data model and enforcement exist; no UI to set grants (Host command only).

## NOT IMPLEMENTED

* Native WPF Island (`install/Bunny-Island.ps1`) mission display.
* Skills "start server" and "restart approved Bunny component".
* Automatic (LLM-driven) skill repair; repaired steps are supplied explicitly.
* Raw mouse/keyboard input (intentionally not offered).
* Windows wake-from-sleep, Android background push (unchanged from M3: unavailable).

## NOT TESTED

* **Any live provider mission.** No Codex/Claude/Ollama child task was launched by a mission; mission→TaskManager integration is tested with fake adapters through the real TaskManager. No external model quota was spent.
* Computer Runtime `focus_window`, `invoke_control`, `type`, `capture`, `open_app` success paths on the real desktop (not run to avoid disturbing the user's session).
* GitHub queries against the API; `browser.search` against DuckDuckGo (network); browser tests used a local page.
* The Windows standalone package; dev and production browser rendering and fixture approval UI are now tested.
* Opening an M-A-0 database with the released v10/v13 binaries.
* The live installed Host after restart (not restarted).
* Public-HTTPS phone flow for missions.

## BLOCKED

None.

## Defects found and fixed during M-A-0

Found by tests or live QA, fixed, and covered by tests: reroute could deny the only provider (retry could never launch); relative paths were scope-checked against the Host's cwd; allow-once did not extend containment to the approved path; capability-step writes were missing from the envelope write scope; skill steps' commands were missing from the envelope (a "Run the tests" mission asked for permission it should already have); answered approvals stayed in the Inbox; Retry was offered when nothing had failed; "Draft a CONTRIBUTING guide" planned read-only; an allowed `provider.execute` request could leave its step stuck when the provider had become ineligible.

## Deviations from the specification

* Suggested module names were adapted (`store.server.ts` instead of a separate `scheduler/recovery` module; scheduling and recovery live in `manager.server.ts`).
* Mission states follow the suggested list exactly; step states add `blocked` and `skipped`.
* The feature flag defaults to **off**, so the live installation is unchanged in behaviour until missions are enabled.
* GLM review: **not performed.** A read-only advisory review was dispatched through the Cline delegate (GLM 5.2 profile; GLM 5.3 Flash is not available here), but the run failed at startup because the `cline` CLI is not installed (`spawn cline ENOENT`, run `c92b4ef7`, zero tool calls). It was not retried. A focused self-review was done instead; it found one defect (an allowed `provider.execute` request could leave a step stuck if the provider became ineligible), which is fixed and tested.

## Git

Original commits `32ce245`, `dbab79e`, `60d54e0`, `33723ee` are preserved. Remediation code commits: `02d6a7e` (authority, approval clarity, safe Git cancellation and low findings), `b975026` (browser DNS isolation), followed by the documentation/handoff commit containing this report. No push, merge, reset, clean or history rewrite. New local evidence lives under ignored `test-results/ma0r/` and `screenshots/ma0r-*`; the pre-existing untracked Review 0 report is preserved.

## Verdict

Original architecture verdict: **BUNNY_MA0_IMPLEMENTATION_COMPLETE**. Remediation verdict: **BUNNY_MA0_REMEDIATION_COMPLETE** — H1/M2/M3 and L1/L2/L3 are fixed with regression evidence; M1 is mitigated through explicit bounded session authority, matching desktop/phone consent and honest provider-internal side-effect disclosure. All 391 tests, typecheck, lint with no new warnings, build, migration and legacy regressions pass. Provider CLI trust, same-path binary replacement, failed/unproven Git cleanup and hard crashes remain documented limits. No live provider mission quota was used; M-A-1 owns live acceptance.
