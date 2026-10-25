# Final acceptance matrix

Public beta: **NO-GO**.

| Gate | Status | Evidence |
| --- | --- | --- |
| T1R-G1 Integrated source | PASS | Merge `22b55a4` matches PR head `e9eb8fb`. Workflows `40154246502` and `40154235384` finished success on that merge. |
| T1R-G2 Full regression | PASS | After the worker rebuild: stage 1 exit 0 (1655 pass, 1 skip), stage 2 exit 0 (58 pass), `npm run test:ma4` exit 0 (269 pass, 1 skip), typecheck exit 0, UI tests exit 0 (419), web and desktop builds exit 0. Stage 0 exit 0 (387) was recorded before the worker rebuild. The stage-3 wrapper error is the extra `--test-timeout` flag, not a failing suite. |
| T1R-G3 Voice-worker | PARTIAL | Build record matches the LF source and the rebuilt exe. Duplex self-test passes. 7 whisper tests fail closed because the pinned runtime is not staged. |
| T1R-G4 Real-task evaluation | PARTIAL | Offline C1–C3 fixtures verified. Holdout C0 14/14 on one pinned model via direct Ollama, not via the Host. |
| T1R-G5 Fair baseline comparison | PARTIAL | Routing compared at `bc1c82d` and here. Latency is one model, one run. No 15% claim. |
| T1R-G6 Verified completion | PARTIAL | Fixture verification stayed required. No measured gain in completed real tasks versus the predecessor. |
| T1R-G7 Preference and pins | PASS | Installed preference is selected. A missing preference lists local models and selects none. Pins and digests fail closed in tests. |
| T1R-G8 Concurrent workload | PARTIAL | Policy orders Stop first. Live Ollama serialized a short call behind a long one (8126 ms). |
| T1R-G9 Cancellation and resources | PARTIAL | HTTP abort in 246 ms. No Host Stop, no OOM injection, no GPU preemption. Soak left running. |
| T1R-G10 Installed Windows smoke | NOT TESTED | No installed candidate was driven. |
| T1R-G11 Final-head CI | NOT TESTED | This branch is not the merge commit. Its CI starts when the branch is pushed. |
| T1R-G12 Security and privacy | PASS | Fail-closed preference, synthetic fixtures, no cloud substitute in the live call. Not a full audit. |

## Answers

1. More real tasks completed correctly than the predecessor: **not shown**. Offline fixtures pass their own checks. The predecessor was not scored on those fixtures. The live answers used one model both versions can call.
2. Equivalent work faster or with fewer resources: **not shown**. Warm replies on this 7B are a few hundred milliseconds after a 4.5 s cold load. That is not a product delta.
3. Security, model integrity, and cancellation: **preference and pin rules hold in tests**. The voice worker binary now matches the current source. Live cancellation is an HTTP abort, not a demonstrated Host Stop in front of admission.

MA4-S3-T2 (real-time voice and full-duplex conversation) is the next mission after the remaining blockers move. It is not started. Public beta stays NO-GO.
