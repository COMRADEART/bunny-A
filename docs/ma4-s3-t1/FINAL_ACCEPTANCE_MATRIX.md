# Final acceptance matrix

Status values are only PASS, PARTIAL, FAIL, BLOCKED, or NOT TESTED.

| Gate | Status | Why |
| --- | --- | --- |
| T1-G1 Baseline and predecessor CI | PARTIAL | Closure runs 40151445420 and 40151461863 succeeded on `6c65165`. `main` run 40152910433 full regression was still in progress |
| T1-G2 Complexity routing | PASS | C0–C3 classifier and `boundedTeamCapabilities` covered by tests |
| T1-G3 Fewer agents on simple work | PASS | C0 is one model call. C1 is zero. This is the strategy, not a live UI trace |
| T1-G4 Preference / AUTO_LOCAL / HARD_PIN | PASS | Unit tests plus a Host submit that keeps the onboarding model |
| T1-G5 Digest enforcement | PASS | Mismatch and missing digest fail closed in policy and revalidation |
| T1-G6 Hardware detection | PASS | CPU, RAM, RTX 4050, 6141 MiB, Ollama 0.40.9, Intel AI Boost present with execution unconfirmed |
| T1-G7 Admission | PASS | Unit tests. Not a live OOM injection |
| T1-G8 Warm-state policy | PASS | Cold 7383 ms, warm 356 ms, then the model was stopped |
| T1-G9 Interactive responsiveness | PARTIAL | Priority order is tested. Live voice plus background was not |
| T1-G10 Planning quality | PARTIAL | Role counts are bounded. No new live planning score |
| T1-G11 Context and replanning | PASS | Budget, labels, and approval clearing are tested |
| T1-G12 Deterministic verification | PASS | Reviewer cannot replace a Host check. Completion is not verification |
| T1-G13 Evaluation set | PARTIAL | 100 synthetic class cases passed. They are not end-to-end tool tasks |
| T1-G14 Measured improvement | PARTIAL | Preference routing and call counts improved. Latency versus the old build was not measured, so the 15% target is not claimed |
| T1-G15 Adversarial suite | PARTIAL | 16 of 20 policy cases passed or are the same unit tests. Sleep, restart, and one dependency recheck were not run |
| T1-G16 Full local regression | NOT TESTED | `npm run test:ma4` passed 266, 0 failed, 2 skipped. `npm test` was not run while the soak is still active |
| T1-G17 Real hardware | PASS | One real Ollama model, mixed CPU/GPU, no NPU claim |
| T1-G18 Hosted CI on the T1 head | NOT TESTED | No T1 head has been pushed yet at the time this matrix was drafted |
| T1-G19 Shutdown, permissions, voice, recovery | NOT TESTED | Not re-run this session. No code in those subsystems was rewritten. Voice-worker file remains the inherited gap until executed |
| T1-G20 This report | PASS | Published with the limits above |

T1 is not complete.
