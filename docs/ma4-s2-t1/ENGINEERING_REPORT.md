# MA4-S2-T1 — Engineering report

```text
BUNNY A — MA4-S2-T1 ENGINEERING REPORT

REPOSITORY
  Base SHA:      2cba36b (PR #18 merge into ma4-s1r3-agent-reliability; test:ma4 117 pass / 1 skip at base)
  Final SHA:     code a4a8687 (this report and later commits change docs only)
  Branch:        ma4-s2-t1-persistent-runtime (worktree ../bun-router-s2t1; all other worktrees untouched)
  PR:            draft → ma4-s1r3-agent-reliability (see PR link); not merged
  Hosted CI:     PENDING at the time of writing (see the PR checks)

PERSISTENT RUNTIME
  Durable task storage:     additive tables on the Host's SQLite file; one BEGIN IMMEDIATE transaction per change
                            (version, lease+fence, transition table, append-only history, atomic receipts/checkpoints/
                            notifications); record hashes; corrupt rows refused; schema-version guard; bounded retention
  State machine:            CREATED → VALIDATED → AWAITING_APPROVAL → QUEUED → RUNNING ⇄ PAUSED/RESUMING →
                            COMPLETED | FAILED | CANCELLED | UNCERTAIN (owner reconciliation); explicit table, enforced
                            in the store
  Checkpoint recovery:      durable "started" before every effect, receipt after; recovery: read-only retried,
                            idempotent verified by stable key, irreversible → UNCERTAIN (never replayed)
  Background Host behavior: tasks run inside the Host process; with every window closed only if the owner policy AND the
                            task's approved envelope allow it; otherwise pause at the next step boundary
  Startup policy:           default: recovered tasks wait for the user (PAUSED "Bunny-A restarted"); optional resume-on-
                            start. No service, scheduled task or startup entry installed
  Task scheduling:          dependency-aware, fair across projects, ≤ 2 active tasks, Host-wide one-GPU-call gate (S2
                            grouped schedule reused), per-step timeouts and attempt budgets, task model-call and time
                            budgets
  Resource limits:          pinned model must be installed locally; 4 GiB free-memory floor for GPU steps; existing
                            thermal/sandbox/quota protections untouched

RECOVERY
  Crash tests:              5 fault boundaries × irreversible send, idempotent upsert, read-only, dependency graph,
                            stale worker, authority expiry, pins; 3 real taskkill /F process tests; 1 real Host + real
                            local model kill — all pass
  No-duplicate action tests: 0 duplicated consequential operations in every scenario (recorded fake services)
  Stale worker prevention:  fencing token bumped on takeover; superseded worker's commits refused (tested)
  Uncertain-action reconciliation: workstation-only "happened" / "did not happen" / "stop the task"
  Pause/resume:             pause at a step boundary; resume via RESUMING with re-authorization; no step re-run
  Cancellation:             aborts the step, kills its children, records UNCERTAIN if an irreversible step was dispatched

USER EXPERIENCE
  Windows notch:            one neutral task cell in the existing agent strip (left of a horizontal notch, above a side
                            notch), urgent state first, deduplicated by task id, "last known" when offline; idle status
                            line shows the task headline. Real WPF Island renders before/after a Host restart
  Task dashboard:           "Background tasks" on the Today page with controls and the two policy switches
  Mobile status:            "Background tasks" on phone Home; list/progress/approval-needed/recovery/evidence; pause,
                            resume, cancel
  Stale-state handling:     rows not confirmed by the Host read "Last known: <state> (<time>)" and offer no controls
  Notifications:            local, in-app (Host journal, dashboard, notch); deduplicated by key across Host lives;
                            respects the owner's per-kind settings. No OS toast, email, SMS or push
  Approval controls:        workstation-only, hash-bound, expiring (default 24 h, ≤ 7 d)

SECURITY
  Sandbox:                  WSL2 adversarial F4.1–F4.11 and F5 seccomp pass live (stage 4 log)
  Permissions:              owner envelope; create/approve/reconcile/revoke/policy/output workstation-only, also at the
                            HTTP boundary; phone rights read + supervise only
  Model pins:               pin ∈ envelope, served-model receipt must equal the pin, unavailable pin blocks; hosted tag
                            blocked live
  Credentials:              credential-shaped step inputs refused; checkpoints pass the MA3 material guard
  Cross-project isolation:  envelope project scope; same-project dependencies only
  Cloud inference:          DISABLED (not expressible in an envelope); skill and memory injection DISABLED

PERFORMANCE (targets pre-registered in d0bafcc; all met)
  Recovery latency:         50 interrupted tasks 373 ms; real Host restart → correct state 909 ms
  Checkpoint overhead:      per-step bookkeeping p95 15.4 ms; create p95 12.4 ms; claim p95 20.6 ms
  Idle CPU:                 0.29 % of one core (real Host, 60 s)
  Memory usage:             +10.7 MB RSS for 200 tasks
  Scheduling impact:        peak concurrent model calls 1 with 4 active tasks; fairness strict alternation

RELEASE
  Runtime tests:            ma4-s2t1.test.ts 26/26, ma4-s2t1-host.test.ts 1/1, ma4-s2t1-process.test.ts 3/3,
                            island-ptask.test.mjs 2/2, ptask-model.test.ts 3/3
  MA4/S2 tests:             test:ma4 147 pass / 1 skip (the same opt-in live free-model contract skipped at base)
  Full regression:          stage 1 456/456, stage 2 1,643/1,643; stage 3 first run interrupted by Windows Modern
                            Standby (lid closed ~2 h; a fixture Host declared HOST_FATAL on wake; all its tests had
                            passed) — unchanged rerun 58/58; stage 4 = test:ma4 above. Both logs kept
  Voice:                    voice suites inside stage 2 pass (local; whisper runtime staged)
  UI:                       409/409
  Typecheck:                pass
  Desktop build:            pass (JEV_DESKTOP_BUILD=1)
  Mobile-web build:         pass (automated web build only)
  Security audit:           npm audit 0 vulnerabilities (prod and all); package-lock.json unchanged
  Hosted CI:                PENDING
  Installed Windows:        NOT TESTED (source Host and source Island scripts only)
  Physical mobile:          NOT TESTED

GATES
  Passed:   T1-G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, G12, G13, G14
  Failed:   none
  Partial:  T1-G11 (Host projection, pairing and stale semantics tested over real HTTP and in the row model; the phone
            UI component was built but not rendered in a browser; physical phone NOT TESTED)
  Pending:  T1-G15 (hosted CI), T1-G16 (draft PR open; complete once CI reports)

FINAL STATUS:
PARTIAL — runtime, recovery, safety, notch and performance gates pass with real-process and real-model evidence;
hosted CI pending; phone UI not browser-rendered; installed release and physical mobile not tested

NEXT RECOMMENDED ACTION:
Let hosted CI finish on the draft PR. Then, with owner approval: render-check the phone "Background tasks" section
against a paired device, walk the installed release (Island + Host) through a close-window/restart cycle, and decide
whether to enable background execution by default for any task kind. Keep automatic Windows startup off until the owner
approves it separately; register no consequential executor until a specific integration is approved.
```

## Gate table

| Gate | Status | Evidence |
|---|---|---|
| T1-G1 verified baseline | PASS | ARCHITECTURE_AUDIT.md; `evidence/baseline-test-ma4-2cba36b.log` |
| T1-G2 durable transitions and migrations | PASS | TASK_STATE_MACHINE.md, PERSISTENCE_AND_MIGRATIONS.md; T1 storage/crash-safe/malformed tests |
| T1-G3 UI closure does not stop an authorized Host task | PASS | T1-1; live Q2/Q4 (no window ever attached) |
| T1-G4 crash recovery with checkpoints | PASS | CRASH_INJECTION_RESULTS.md A, B, C |
| T1-G5 no duplicated consequential actions | PASS | T1-5 × 7, process send test |
| T1-G6 stale worker commits rejected | PASS | T1-7 |
| T1-G7 pause/resume/cancel | PASS | T1-2, T1-3, Host API test |
| T1-G8 expired permissions and unauthorized restarts blocked | PASS | T1-8, T1-11, live Q3 |
| T1-G9 pins and resource limits preserved | PASS | T1-9/13, live Q5, P8 |
| T1-G10 notch reconnection | PASS | WINDOWS_NOTCH_INTEGRATION.md, `evidence/notch/` |
| T1-G11 mobile pairing and stale semantics | PARTIAL | MOBILE_TASK_CONTINUITY.md (UI not browser-rendered; physical NOT TESTED) |
| T1-G12 local notifications and dedup | PASS | T1-16, process send test, live ledger |
| T1-G13 privacy and sandbox regression | PASS | SECURITY_VALIDATION.md; stage 4 F4/F5 live |
| T1-G14 performance budgets | PASS | PERFORMANCE_REPORT.md §2 |
| T1-G15 hosted CI | PENDING | PR checks |
| T1-G16 draft PR, documents, evidence | PENDING (PR open) | this directory |

S2 and S2R1 benchmark results and evidence are unchanged (no file under `docs/ma4-s2/` or `docs/ma4-s2r1/` modified).
