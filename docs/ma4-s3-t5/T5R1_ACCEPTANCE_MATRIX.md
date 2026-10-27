# T5R1 provisional evidence-backed matrix

This conservative reassessment records evidence available in this worktree, not a final acceptance decision. The historical matrix is retained. Engineering integration: **PARTIAL**. Consumer release: **NO-GO**.

| Gate | Criterion | Status | Basis |
| --- | --- | --- | --- |
| T5-G1 | Lineage and exact-head CI | FAIL | PR #51 head 08a22c5 has a failed MA4 job; no correction head has been checked. |
| T5-G2 | Benchmark entry reconciliation | PARTIAL | The claim count was twelve and the repair category has fifteen entries; the original twelve task IDs remain unidentified. |
| T5-G3 | Deterministic process runner | PASS | The audit launched and verified a disposable Node test process; this is not process evidence for a benchmark task. |
| T5-G4 | Dataset split | PASS | The reconciliation runner checked 60 frozen tasks, with 30 development and 30 held-out. |
| T5-G5 | Benchmark pass-rate accounting | NOT TESTED | Historical live and controlled results have not been re-audited in this run. |
| T5-G6 | Windows consumer journey | BLOCKED | Native end-to-end desktop journey has not been exercised. |
| T5-G7 | Notch placement | PARTIAL | Four edges pass only in the JavaScript geometry shim; actual window interaction remains untested. |
| T5-G8 | Agent states | NOT TESTED | Live rendered states have not been independently verified in this run. |
| T5-G9 | Agent artwork | NOT TESTED | Loaded artwork and runtime rendering have not been verified. |
| T5-G10 | Motion and display ergonomics | BLOCKED | Reduced motion and mixed-DPI interaction have not been exercised. |
| T5-G11 | Voice software | NOT TESTED | This correction has not completed the full voice suite. |
| T5-G12 | Physical acoustics | BLOCKED | No authorized physical microphone and speaker session was run. |
| T5-G13 | Audio device reconnection | BLOCKED | No physical device disconnect/reconnection was run. |
| T5-G14 | Android build and manifest | NOT TESTED | The APK artifact has not been independently inspected in this run. |
| T5-G15 | Remote security invariant | NOT TESTED | The paired-device policy has not been requalified for a native Android client. |
| T5-G16 | Physical phone pairing | BLOCKED | No authorized physical Android device session was run. |
| T5-G17 | Pairing security | NOT TESTED | Native client pairing and token storage have not been qualified. |
| T5-G18 | Onboarding | BLOCKED | A native first-run journey has not been exercised. |
| T5-G19 | Agent workflows A–F | NOT TESTED | The v2 runner does not invoke the Host or a model for these scenarios. |
| T5-G20 | Distribution signing | BLOCKED | No applicable release signing and distribution evidence has been produced. EV is not a universal Microsoft Store requirement. |
| T5-G21 | Approval Center | BLOCKED | Native exact-payload review and decision controls are not implemented or exercised. |
| T5-G22 | Install and upgrade | BLOCKED | No native candidate installation, upgrade, or uninstall was exercised. |
| T5-G23 | Memory persistence | NOT TESTED | Native project-memory controls and recovery were not exercised. |
| T5-G24 | Accessibility | BLOCKED | No Narrator, TalkBack, or complete native keyboard qualification was performed. |
| T5-G25 | Security regression | NOT TESTED | The complete native-client security matrix has not been performed. |
| T5-G26 | Documentation and review | PARTIAL | Preliminary findings are documented; complete deliverables and reviewable native PRs are outstanding. |

Counts out of 26: PASS 2 (7.7%); PARTIAL 3 (11.5%); FAIL 1 (3.8%); BLOCKED 10 (38.5%); NOT TESTED 10 (38.5%).

These counts are not a measure of product readiness: several criteria require independent platform and device sessions.
