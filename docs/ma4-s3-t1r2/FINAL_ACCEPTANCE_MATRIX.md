# Final acceptance matrix

The milestone is not complete. Public beta stays NO-GO. MA4-S3-T2 was not started.

| Gate | Status | Evidence |
| --- | --- | --- |
| T1R2-G1 Current merged baseline verified | PASS | `BASELINE.md`. Merge `51217cb` matches PR #40 head `ba4fdca`. Hosted run `40192245873` is that head, not this branch. |
| T1R2-G2 Full local regression PASS | PARTIAL | `CI_RESULTS.md`. Typecheck, UI, both builds, audit, and the `npm test` stages after the scripts stage passed. `npm test` as one command exited 1 because the package test could not find a Node license file. |
| T1R2-G3 Voice-worker runtime qualification | PASS | `VOICE_WORKER_QUALIFICATION.md`. Pinned whisper.cpp 1.9.4, 76/76. |
| T1R2-G4 55 real workflow evaluations completed | PASS | `REAL_TASK_EVALUATION.md`. C2 and the two edits were measured again after the runner stopped sending `dependsOn` on a step. |
| T1R2-G5 Functional correctness measured | PARTIAL | C0 45/45 contain the expected token, with 11/15 exact text. C1 15/15. C2 15/15. C3 writes and failures behaved as recorded. `C3-10` printed `DROP TABLE users` as model text. |
| T1R2-G6 Independent completion verification measured | PARTIAL | Model receipts say verification was not established. File hashes, the missing-file error, the stale hash, and process exit 3 are observed tool results. |
| T1R2-G7 Baseline/T1 performance comparison completed | PARTIAL | `PERFORMANCE_AB.md`. Warm median 1,095 ms versus 1,273 ms (14.0%, short of 15%). Cold start was slower. C1 was not paired. |
| T1R2-G8 Actual Host Stop under contention tested | PASS | `HOST_STOP_AND_RECOVERY.md`. Stop while `running` settled to `stopped` in 1,390 ms. Output did not grow. An earlier stop arrived after completion and is not the result. |
| T1R2-G9 Model preference and hard-pin integrity verified | PARTIAL | `MODEL_ROUTING.md`. A stored missing preference fails closed. Saving an unknown model clears it. The receipt has the model name and not the digest. `AUTO_LOCAL` was checked in unit tests, not through a live submit. |
| T1R2-G10 Installed Windows application qualified | BLOCKED | `INSTALLED_WINDOWS_TEST.md`. The packager refused to ship without a Node license file. No install was performed. |
| T1R2-G11 No security or resource-regression defects | PASS | `SECURITY_REGRESSION.md`. Audit reported 0 vulnerabilities. The license refusal is fail-closed packaging, not a Host bypass. |
| T1R2-G12 Final-head hosted CI PASS | NOT TESTED | No hosted run exists for this branch yet. Run `40192245873` does not count. |
