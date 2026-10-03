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
| T2 Codex compatibility gate | NOT TESTED; not implemented | open |
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
All 439 regression tests passed. Typecheck and build passed.
Lint had 0 errors and 10 existing warnings.
The evidence applies to source `898c52cbb439cbaa738f6a44e89ca4c526591cc9` and tooling `e7f82de8f82fb427bc00fdb19a715b58df32fadf`.
