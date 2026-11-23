# Bunny-A — M-A-3 T11 multi-Agent long-run acceptance

**BUNNY_MA3_T11_PASS_WITH_LIMITATIONS**

## 1. Exact T10 baseline

Source `2d5646d5c5a95ab040239b20b034e2c6b0828365`; evidence `bde8186d7fed7643edb6322502177a7f341086a4`. F04 ancestry and the 1,694-test starting inventory are recorded in baseline.md.

## 2. T11 source

Final source/tooling pin `032954fad7c0d66097a1e6efe502eda21a66c3ce`. Earlier T11 implementation and repair commits are listed in source-provenance.json.

## 3. Evidence commit

The separate local evidence commit contains this report and INDEX.sha256. Its exact hash is returned in the final chat; a commit cannot contain its own future hash.

## 4. Branch

`claude/ma3-t9-phone-remote`. No merge, push or production installation was performed.

## 5. Files changed

 45 files changed, 4132 insertions(+), 120 deletions(-). Complete source file list is in source-provenance.json; evidence files are indexed below.

## 6. Architecture

AgentRuntime owns identities; MissionManager owns one graph and scheduler; TaskManager owns child lifecycle; BunnyRouter chooses each model; the Capability Bus and Host verification decide effects and success. No second authority was introduced.

## 7. Agent identity

113 durable team identities were recorded across the run. A Coordinator plus Planner exists before planning; specialist members are allocated only after Host plan validation. Model session identity is separate.

## 8. Roles and delegation

Bounded Planner, Researcher, Implementer, Reviewer, Tester, Documenter and Coordinator roles. One Coordinator approval covers the exact reviewed plan; member roles do not confer principal or consent-owner authority.

## 9. Real planning

40 recorded planner invocations. Actual Ollama receipts, accepted plans and rejected proposals are retained; rejected plans never execute.

## 10. Plan validation

Schema, dependency cycles/missing edges, file types, requirement coverage, roles, task/Agent budgets, scope, and reserved marker checks. PA-01..04 regressions preserve the reviewed-plan and advisory-data boundaries.

## 11. Mission execution

14 live Missions completed. The scope-reduced Service status team stopped without completing prohibited writes. Other holds/failures, if any, remain recorded rather than being called success.

## 12. Real Agent inference

130 main-run actual provider receipts; 65 distinct durable Agents with completed model work. Invocation files bind Agent, Task, Mission, provider/model and receipt. The focused Reviewer supplement has 6 separately retained real receipts and is not added to regression test counts.

## 13. Model selections

Every model-backed step used BunnyRouter. See per-task-model-routing.json for selected candidates, exclusions and fallbacks; no Project or role permanently pins a model.

## 14. Concurrency

Peak 4 overlapping step intervals; 4 overlapping model request intervals. See the single-GPU limitation above.

## 15. Artifact handoffs

Immutable source/destination Agent and step references, hashes, purpose, and Host verification. A hash mismatch, missing or unverified producer, or corrupt advisory review is refused. Data handoffs carry no executable authority.

## 16. Independent verification

Final file reads/hash checks and bounded HTML/Markdown/data requirements passed for completed Missions. Offline DOM inspection was a supplementary harness observation, not a substituted Host verdict.

## 17. Rework and conflicts

The integrated Mission used 1 reserved rework round(s). Original failures remain in history. Its first advisory Reviewer missed the seeded id, while the Host correctly withheld completion. In a separate real-model supplement the Reviewer reported blocking R1, the Host independently confirmed it, and rework completed the Mission (PASS). Pre-image guards and existing workspace locks refuse foreign changes and serialize writes. 0 duplicate successful writes by the same step.

## 18. Authorization and budgets

Coordinator-only approval/consent mutation; current scope intersections; finite model/token/task/Agent/retry/concurrency/time budgets. Live removal of filesystem.write stayed effective despite a one-time permission answer.

## 19. Process containment

Existing F04 native tests and the packaged provider/child Job test passed. Test-owned process trees were used; the independently managed Ollama service was never claimed Job-contained. The live harness npm parent left a test UI child on Windows; its exact PID, creation time and command line were checked before closing that tree. test-ui-cleanup.json records the closed test listener; production and the dev preview remained running.

## 20. Host recovery

The exact disposable Host was abruptly terminated during work, then restarted. Agent identities, dependencies and checkpoints survived; interrupted inference was requeued under current authority. A separate landed-write regression proves one write before and after recovery.

## 21. Long-run acceptance

34 minutes elapsed on the final pin, 14 completed substantive team Missions, 1054 checkpoints and 7317 retained journal events. Work spans test CSVs, Git history, offline pages and documentation; no timer padding was added.

## 22. Fault injection

Dependency pause/resume, real Ollama stream abort, seeded verification failure and bounded repair, write-scope reduction, exact-PID Host restart and UI closure/reopen. Outcomes are retained in integrated-mission.json and the timeline.

## 23. Agentic UI

The live UI closed while authorized work continued; reopening after restart matched canonical Mission phase. Live screenshots and closure facts are retained. Dev and desktop-production views were visually checked at laptop and mobile sizes with clean consoles.

## 24. Bunny Bar and Notch

Shared Host-derived chip facts and role/model separation retained. Horizontal indicators are left of the Notch; vertical indicators are above its interaction area. Windows PowerShell layout fixtures passed; no T11 physical Island interaction is claimed.

## 25. Voice

Real disposable voice-session typed supervision answered team questions from Host facts, and approval-like speech stayed refused. Push-to-talk and T10 pipeline regressions passed.

## 26. Calculator

Real Calculator/X53 outcome and evidence classification are recorded in calculator-x53-results.json and the full regression logs.

## 27. Full regression

1750/1750 distinct tests passed, 0 failed, 0 skipped. Parts: scripts 355, library 1152, agent 57, ui 186. Typecheck, lint and builds passed; lint retains 22 pre-existing warnings.

## 28. Independent security review

Two recovered terminal reviewers plus fresh lifecycle/handoff/surface adversarial reviews. All reproduced findings were repaired and independently disposed; no unresolved BLOCKER/HIGH. Original failures and follow-up passes are retained.

## 29. Windows package

`Bunny-A-Windows-MA3-T11-TEST`, exact source and tooling pin above. Manifest/import closure, real packaged planning and distinct identities, packaged native provider/child containment, voice worker and graceful shutdown passed. No installation performed.

## 30. Production preservation

Read-only before/after release, install metadata, process/listener identity, state-table and event comparison is in production-final.json. Permitted provider-observation drift is distinguished from T11 writes; no whole-task byte-equality claim is made.

## 31. Limitations

All live team inference used one routed local Ollama model. Other eligible models were observed, but hosted-provider diversity and multi-Agent Claude/Codex inference were not exercised. The RTX 4050 laptop has one 6 GB GPU. Distinct Agent requests overlap; Ollama queues GPU generation. This is concurrent admission and real canonical work, not proof of simultaneous GPU inference. Local Ollama is an independently managed HTTP service and is not Windows Job-contained. Native contained provider fixtures and the packaged provider/child test passed separately. Physical phone, LAN, internet tunnel and Windows reboot/logon persistence remain NOT TESTED. T9 limitations remain open. T11 voice supervision used typed turns in a real disposable voice session and real output playback; it did not repeat microphone capture or complete hands-free acoustic barge-in. T10 voice limitations remain. The packaged gateway uses the protected production gateway port and was not started there. Packaged Host startup, real planning, native containment, voice worker and shutdown were tested on a disposable listener. Several 80-row matrix cases are static or scripted-model fixtures. Rows without a direct final assertion are explicitly NOT TESTED; the matrix never claims 80 live cases. The separate generic Vercel preview renders cleanly but cannot act as this native workstation gateway. Desktop QA uses the actual node-middleware build and has no render divergence from dev. The administrative dashboard retains the platform share-card placeholder. No new custom branding was required or generated. The main integrated Mission advisory Reviewer missed the seeded missing id. The Host independently caught it and repaired it. A separate source-pinned real-model focused review reported blocking R1, the Host confirmed the failed check, and the Mission completed after rework. Advisory review remains fallible and never decides canonical success.

## 32. Evidence root

test-results/ma3/t11/. INDEX.md lists evidence; INDEX.sha256 seals retained files and this report. Runtime state, temporary fixture trees and package payload directories are excluded; their manifests/validation receipts are retained.

BUNNY_MA3_T11_PASS_WITH_LIMITATIONS
