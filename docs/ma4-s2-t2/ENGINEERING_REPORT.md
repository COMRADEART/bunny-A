# MA4-S2-T2 — Engineering report

```text
BUNNY A — MA4-S2-T2 ENGINEERING REPORT                                        STATUS: PARTIAL

REPOSITORY
  Base SHA:      c3bff8a (PR #21 merge into ma4-s1r3-agent-reliability; push + pull_request CI green, PR #21 final
                 head f28377c green — REPOSITORY_AUDIT.md)
  Final SHA:     code 58d12b9 (this report and later commits change docs only)
  Branch:        ma4-s2-t2-connected-actions (worktree ../bun-router-s2t2; other worktrees untouched)
  Diff:          54 files, +3,788 / −50 vs base (before these reports)
  PR:            draft → ma4-s1r3-agent-reliability (see PR link); not merged, nothing deployed
  Hosted CI:     PENDING at the time of writing (see the PR checks)

CONNECTED ACTIONS (CONNECTED_ACTION_ARCHITECTURE.md)
  Principle:            models propose; the Host validates, authorizes, executes and verifies
  Execution:            every connected action is a step of an S2-T1 persistent task; executors exist only through
                        the permission broker (`brokered()`), built from a versioned contract (ma4.action.v1)
  Gates on every run:   input schema → grants ∩ Host registry (creation AND each execution AND recovery) →
                        consequential: approval for exactly this payloadSha256 → receipt → effect → result schema →
                        redaction → receipt (SHA-256 chain)
  Approvals:            Approval Center, workstation only: Approve / Deny / Inspect details / Cancel; one approval =
                        one step's one payload; expires (15 min default, ≤ 1 h, ≤ envelope); any change → invalidated
  Recovery:             read-only re-run; idempotent verified by key/condition; irreversible → UNCERTAIN, owner
                        reconciles (CRASH_AND_REPLAY_SAFETY.md)

CONNECTORS
  Local files:          list, read, stat, search, changes; previewed edit → approval → atomic apply with backup.
                        Refused: traversal, drive/ADS/device/8.3 names, links/junctions/hard links out of the folder,
                        credential/binary/oversized files, over-broad folder registration
  Browser:              read-only, exact granted origins, per-task profile deleted at task end, no form submission,
                        no downloads, private networks refused (MA3 isolated browser reused)
  Email/calendar/docs:  provider-neutral adapters; qualified against SyntheticWorkspace only. Production registers
                        no provider → these steps are refused at validation

AGENT TEAM (AGENT_WORKFLOW_INTEGRATION.md)
  Planner proposes only (cannot create or approve); Worker reads earlier results fenced as untrusted data; Reviewer
  can stop a task before anything is sent; models are hard pins, served-model mismatch → PIN_VIOLATION

HOST STARTUP (F-CI1-1, HOST_STARTUP_CLEANUP.md)
  Worse than recorded: a refused second Host marked the live Host's running MA3 tasks failed. startHost() now binds
  the port before opening any state; a failed start releases everything it opened. T2-H1..H3: 0/3 old code, 3/3 now

S2-T1 DEFECTS FIXED
  Background tasks were mounted only on the unrouted legacy dashboard → now on the routed Tasks surface
  The dashboard command boundary dropped ptask.output / Approval Center data → allowlisted
  action.inspect was treated as mutating → read

USER EXPERIENCE (USER_EXPERIENCE_VALIDATION.md)
  Real dashboard + real WPF notch rendered against an isolated Host; 0 console errors; Approve in the page sent
  exactly one message. Notch tooltip shows each task's activity. Phone sees only "a <connector> action is waiting
  on the PC" — never recipients, paths or content

SECURITY (SECURITY_AND_ADVERSARIAL_TESTS.md)
  38/38 T2 tests incl. adversarial 7/7; paired devices default-deny for every new command; cloud inference still
  not expressible; S2-T1 and earlier security suites pass unchanged

PERFORMANCE (PERFORMANCE_REPORT.md; budgets fixed before measuring; all met)
  file.read step p95 47 ms / 50 (marginal) · search 500 files 379 ms / 1,000 · ledger verify 1,000 = 5 ms / 200
  browser first open 532 ms / 10,000, later p95 431 ms / 3,000 · refused start 1 ms / 100 · heap +100 tasks ≤ 0 MB / 50

RELEASE
  T2 suites:            files 13/13, services 6/6, browser 6/6 (real Chromium), adversarial 7/7, workflows 3/3
                        (real Host), startup 3/3
  S2-T1 regression:     31/31
  UI:                   412/412
  Full regression:      npm test exit 0 in 20 m 55 s — stage 1 456/456, stage 2 1,653/1,653, stage 3 58/58,
                        stage 4 (test:ma4) 186 pass / 1 skip (the opt-in live free-model contract, skipped at base too)
                        — evidence/npm-test.log
  Typecheck:            pass
  Not committed:        native/voice/bunny-voice-worker.exe/.json rebuilt by pretest (restored)

GATES NOT PASSED / LIMITS
  T2-G12 phone status:  PARTIAL — phone screen not rendered in a browser (needs the HTTPS companion origin)
  Services:             synthetic stand-in only; no live provider connected
  Model:                recorded fake model only — proves Host controls, not model quality
  Settings:             folder registration and the Planner are Host commands; no settings form yet
  NOT TESTED:           installed Windows release; physical Android phone
```
