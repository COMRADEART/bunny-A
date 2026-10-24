# MA4-S2-T3 — Engineering report

```text
BUNNY A — MA4-S2-T3 ENGINEERING REPORT                       STATUS: see GATES (hosted CI recorded at the end)

REPOSITORY
  Base SHA:      bddd575 (PR #24 merge into ma4-s1r3-agent-reliability; PR #25, same head, was closed unmerged;
                 main does not yet contain S2-T2 — REPOSITORY_AUDIT.md)
  Final SHA:     see the draft PR head (code last changed at a96acd8; later commits are docs/evidence/scripts)
  Branch:        ma4-s2-t3-proactive-companion (worktree ../bun-router-s2t3)
  Draft PR:      → ma4-s1r3-agent-reliability (not merged, nothing deployed)
  Hosted CI:     recorded in the PR

PROACTIVE INTELLIGENCE
  Goal engine:          durable goals PROPOSED → AWAITING_APPROVAL → ACTIVE …; progress only from COMPLETED tasks'
                        step receipts (hashes kept with the goal); a model's "done" claim meets nothing (E2E-C)
  Scheduled tasks:      once / daily (IANA zone, weekdays) / condition; reminders or S2-T1 task templates
  Condition monitoring: approved local files, task states, Host-registered synthetic sources; no internet source;
                        deterministic 7-class change detection; zero model calls
  Trigger correctness:  pure decide(): exactly one of 8 outcomes, authority first (28 cases, T3-D1)
  Duplicate prevention: per-slot occurrence PRIMARY KEY in the decision transaction; deterministic task id;
                        notification key = event identity; no overlap with an open/uncertain run
  Agent delegation:     existing Worker/Reviewer executors via the S2-T2 broker; Planner proposes only;
                        smallest team; one-GPU-call gate, pins, budgets, sandbox unchanged

PERSISTENCE
  Schedule storage:     additive tables on the Host SQLite file, hash-checked records, versioned schema
  Restart recovery:     38 ms with 21 schedules + 8 monitors; time off recorded as a gap, nothing replayed
  Missed-run policy:    per schedule: skip (default) or run_once (latest only); never all; grace period
  Uncertain operations: S2-T1 UNCERTAIN, owner reconciles; next slot defers; one notice
  Cancellation:         schedule cancel stops its run; child processes killed; process table empty

USER EXPERIENCE
  Windows notch:        real WPF render: Monitoring/Scheduled muted below all task states; approvals lead;
                        working run named; "While you were away"; last-known offline
  Goals dashboard:      panel on the routed Tasks page: goals/schedules/monitors, approve (PC only), pause/resume/
                        cancel/turn off, notifications; 0 console errors; no overflow at 390 px
  Phone status:         rendered through a synthetic HTTPS pairing fixture (real pairing route, real device cookie,
                        real device snapshot): no approve controls, no paths, pause works, offline last-known, 0 buttons
  Notifications:        9 categories, in-app, deduplicated, sanitized; answered approvals leave the list
  Quiet hours:          held until they end in their own zone; count shown
  Approval Center:      S2-T2, unchanged; scheduled consequential actions still wait for it (E2E-D)

SECURITY
  Permission enforcement: approvals bound to spec hashes, always expiring, re-checked every pass and step
  Model pins:             never substituted; missing pin defers
  Project isolation:      monitors, schedules, goals, links and tasks share one project (T3-M5)
  External actions:       0 unauthorized; consequential sends only after a payload-bound owner approval
  Cloud inference:        not expressible (envelope literals ollama + localOnly)
  Background authorization: window attached, or owner background policy + envelope background

PERFORMANCE (pre-registered at a96acd8, decisive run after; all 12 met — PERFORMANCE_REPORT.md)
  Scheduler latency:    p95 20 ms, max 20 ms (target ≤ 1,000 / 2,000)
  Recovery latency:     38 ms (≤ 2,000)
  Idle CPU:             0.13 % of one core with 8 monitors + 10 schedules (≤ 1 %)
  Memory usage:         heap +3.0 MB (≤ 20 MB)
  Monitor resource cost: 8 checks / 60 s for 8 monitors (≤ 16); idle wake 60 s
  Inference calls:      0 for monitoring; 2 per scheduled summary (= its GPU steps)
  Energy/battery:       not measured (declared before the run)

END-TO-END (real Host HTTP API; recorded fake model; synthetic connected service)
  Scheduled summary:            PASS (success, denial, cancel, restart, expiry, dedup)
  Build-status watch:           PASS
  Persistent goal:              PASS
  Synthetic connected workflow: PASS (approve, deny, restart, proposal expiry, cancel; sent once)

RELEASE
  New tests:          ma4-s2t3.test.ts 30/30, ma4-s2t3-scenarios.test.ts 4/4, proactive-model.test.ts 3/3,
                      island-ptask.test.mjs +1 notch test (3/3)
  Full regression:    npm test exit 0 — stage 1 457/457, stage 2 1,653/1,653, stage 3 58/58, stage 4 (test:ma4)
                      220 pass / 1 skip (opt-in live free-model contract, skipped at base too) — evidence/npm-test.log
  S2-T1/S2-T2:        68/68 + 1 skip (native helper not built in that run; passes in the full regression)
  UI:                 415/415
  Typecheck:          pass
  Desktop build:      pass (JEV_DESKTOP_BUILD=1 npm run build)
  Mobile-web build:   pass (npm run build)
  Sandbox:            WSL2 adversarial suite inside test:ma4: pass
  Security audit:     npm audit --omit=dev --audit-level=high: 0 vulnerabilities
  Hosted CI:          see PR
  Installed Windows release: NOT TESTED
  Physical Android:   NOT TESTED (browser-level phone via the synthetic HTTPS fixture only)

GATES
  T3-G1  baseline verified ........................ PASS
  T3-G2  durable goal lifecycle ................... PASS
  T3-G3  one-time and recurring schedules ......... PASS
  T3-G4  condition monitoring / change detection .. PASS
  T3-G5  scheduling survives restart .............. PASS
  T3-G6  no duplicate triggers / blind replay ..... PASS
  T3-G7  permission and approval scope ............ PASS
  T3-G8  model pins and resource limits ........... PASS
  T3-G9  notifications deduplicated ............... PASS
  T3-G10 quiet hours and user controls ............ PASS
  T3-G11 notch reflects actual state .............. PASS (real WPF render)
  T3-G12 phone state and pairing controls ......... PASS at browser level (synthetic HTTPS fixture);
                                                    physical Android reported separately: NOT TESTED
  T3-G13 four end-to-end scenarios ................ PASS (synthetic service, fake model)
  T3-G14 adversarial tests ........................ PASS (25/25 cases)
  T3-G15 performance targets ...................... PASS (12/12 pre-registered)
  T3-G16 regression and hosted CI ................. local PASS; hosted CI: see PR
  T3-G17 draft PR and evidence .................... see PR
```

## Defects found and fixed during qualification

* Resume of a schedule or monitor set the state inside `mutate`, which the store resets: a phone resume of a lapsed
  schedule would have stayed PAUSED silently instead of returning to the owner. Fixed (goes through `to`), T3-A1.
* A slot deferred for a transient reason that outlived its grace was recorded as plain "missed", losing the reason.
* Answered approval requests stayed in the notification list (seen in the first dashboard render).
* One-time schedules reached COMPLETED only on a later pass (up to a minute late in the UI).

## Known limits (not hidden by any gate)

* Services are the synthetic workspace; no live provider. Model is the recorded fake: Host control is proven, model
  quality is not. Days are simulated by moving the shared clock; no multi-day soak.
* No creation forms for goals/schedules/monitors in the dashboard (Host commands / Planner proposal, approve in panel).
* No OS toast or Android push (separate integration gates). No `fs.watch`; bounded polling instead.
* Two-Host interleaving is tested in-process on two database connections, not two processes (the port guard prevents
  two Hosts on one machine).
* Away summary also lists short "asleep" gaps produced by test clock jumps in the evidence run (2 s idle cap there);
  with the default 60 s cap the threshold is ~3 minutes.

## Reproduce

```
npm ci && npm run pretest
node --experimental-strip-types --test --test-concurrency=1 src/lib/bunny-host/ma4-s2t3.test.ts src/lib/bunny-host/ma4-s2t3-scenarios.test.ts
node --experimental-strip-types --test src/components/island/proactive-model.test.ts && node --test scripts/island-ptask.test.mjs
node --expose-gc --experimental-strip-types scripts/ma4-s2t3/bench.mjs --idle-s 60 --out bench.json
node --experimental-strip-types scripts/ma4-s2t3/ui-evidence.mjs      # needs Playwright Chromium, openssl, Windows
npm test   # needs the staged whisper runtime (native/voice/vendor) and the runtime LICENSE under releases/
```
