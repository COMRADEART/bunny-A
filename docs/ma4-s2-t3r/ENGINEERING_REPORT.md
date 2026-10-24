```text
BUNNY A — MA4-S2-T3R ENGINEERING REPORT

REPOSITORY
  Base SHA:   e2225b4 (merge of PR #26; hosted CI 40048602114 success)
  Final SHA:  see the draft PR head (code and docs at eb253a7 + this report)
  Branch:     ma4-s2-t3r-product-qualification
  PR:         draft into ma4-s1r3-agent-reliability (link in the PR list; not merged, not deployed)
  Hosted CI:  recorded in the PR after the final-head run

PRODUCT UX
  Goal creation:      PASS — form → Host preview → approve / save / back; Planner proposal only
  Schedule creation:  PASS — once / daily / weekdays / on monitor change; DST notes; invalid dates refused
  Monitor creation:   PASS — JSON field / first line / task; last check, last change, next check; "Cannot read source"
  Approval Center:    PASS — requester, origin, operation, effect class, exact scope, outcome, recovery, expiry;
                      exact-payload approval kept; cancelled task's stale proposal cleared
  Accessibility:      PARTIAL — 45/45 automated checks; Narrator and TalkBack NOT TESTED
  Responsive UI:      PASS — 1280 / 767 / 390 / 320 px, no horizontal overflow

WINDOWS (isolated TEST install S2T3R4-TEST from 8802e0c; production untouched)
  Installed package:    PASS — built and installed by the supported scripts; 3 release defects fixed on the way
  Host startup:         PASS
  Background execution: PASS — blocked when off, completes when explicitly on
  Window close/reopen:  PASS
  Notch:                PASS — repositioned along the top edge; horizontal and side layouts
  Crash recovery:       PASS — new pid in 6.1 s; no replay; pending approval preserved
  Uninstall cleanup:    PASS — test processes, install root and workspace removed; startup/tasks/services unchanged

ANDROID
  Device:           Samsung SM-S948U, Android 17
  APK:              com.routeragent.jev 2.1 (3), existing install
  HTTPS pairing:    PASS — owner-authorized temporary quick tunnel to the TEST gateway only; closed afterwards
  Task supervision: PASS — pause/resume/cancel confirmed by Host transitions
  Offline behavior: PASS — last known with correct time, controls paused, auto-reconnect after Host restart
  Security:         PASS — no Approve control; wrong code refused; revoked device loses access; 401 for unpaired
  Accessibility:    PARTIAL — large text and landscape checked; TalkBack NOT TESTED

RELIABILITY (real-clock soak from e6b6645, started 2026-10-24 01:32 UTC)
  Real-clock duration:   IN PROGRESS — 24 h window ends 2026-10-25 ~01:32 UTC
  Scheduled occurrences: 16 at 2.4 h (interim)
  Duplicate executions:  0 (interim)
  Missed runs:           0 while available (interim)
  Crash recovery:        first planned restart at 6 h — no data yet
  Idle CPU:              median 0.49 % of one core (interim)
  Memory growth:         undecided — 82 → 92 MB in the first 1.4 h; criterion ≤ 50 MB/24 h after the first hour
  Process leaks:         0 orphans (interim)

MODEL
  Actual pinned model:  qwen2.5-coder:7b (Ollama 0.40.9, digest dae161e2…)
  Planning:             structured proposal returned; steps left unpinned → refused as a plan (quality limit)
  Execution:            PASS — read → Worker → Reviewer, 5.8 s
  Verification:         PASS — Reviewer verdict parsed after fixing the dropped schema (c4f36ff)
  Cancellation:         PASS — 2.7 s mid-generation on the installed release
  Model quality claims: none beyond one bounded synthetic task

SECURITY
  Permissions:             PASS — 15 adversarial cases mapped to tests, 0 unauthorized consequential actions
  Approval expiry:         PASS (S2-T1/T2 suites, unchanged)
  Cross-project isolation: PASS (T3-M5, T1-12/15)
  Mobile authority:        PASS — unit + physical phone
  Sandbox:                 PASS (WSL2/seccomp contract suites in the regression)
  External inference:      none — cloud tag blocked; provider CLIs not probed in the installed run

RELEASE
  New tests:          17 (T3R-T1..T5, A1..A6, H1, closure, installed boot-twice, forms ×3) plus browser/installed harnesses
  Full regression:    2,404 tests — 2,403 pass, 0 fail, 1 opt-in skip
  UI:                 pass (in the regression) + 45/45 browser checks
  Typecheck:          pass
  Desktop build:      pass
  Mobile-web build:   pass
  Dependency audit:   0 vulnerabilities
  Hosted CI:          final-head run recorded in the PR

GATES
  Passed:     G1, G2, G3, G4, G5, G7, G8, G9, G11, G12, G13, G14
  Failed:     none
  Partial:    G6 (screen readers not tested), G15 (memory criterion pending the soak)
  Blocked:    none
  Not tested / in progress: G10 (soak IN PROGRESS); G16 and G17 complete when final-head CI is green on the draft PR

FINAL STATUS:
PARTIAL — the real-clock soak has not yet run its 24 h, and screen readers were not exercised.

NEXT RECOMMENDED ACTION:
Let the soak finish (laptop on, awake) and record its verdict with soak-report.mjs; if S5 memory fails, profile the Host's
private-memory growth before any production rollout. Then decide on an owner-authorized production install.
```

Disclosures: part of the installed and phone qualification ran in a concurrent Codex session that the owner stopped; its
commits and evidence were reviewed, re-run and completed here (see `REPOSITORY_AUDIT.md`). The phone's app keeps the last
test address; the owner re-points it to their usual address.
