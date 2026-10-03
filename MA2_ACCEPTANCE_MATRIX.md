# Bunny-A M-A-2 acceptance matrix

| Gate | Result at this checkpoint | Evidence |
|---|---|---|
| T1 state migration | IMPLEMENTED; live test pending | migration and deployment tests |
| T1 database preservation | SIMULATED PASS | all tables, WAL and field checks |
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
