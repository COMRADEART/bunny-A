# MA4-S3-T2 acceptance matrix

Public beta: **NO-GO**. This matrix does not treat simulator passes as acoustic passes.

| Gate | Result | Evidence |
| --- | --- | --- |
| T2-G1 Existing voice architecture audited | PASS | `BASELINE_AND_ARCHITECTURE.md`, `EXISTING_DUPLEX_CAPABILITIES.md`. PR #42 merged. Branch cut from `f429037`. |
| T2-G2 Physical Windows duplex capture | NOT TESTED | Probe 2026-10-25. Default input endpoint muted. Duplex was not opened. Fixture overlap is not this gate. |
| T2-G3 AEC and echo rejection | PARTIAL | Worker reported DSP support. Echo rules are unit-tested. No room measurement. Muted mic blocked a live AEC trial. |
| T2-G4 Natural interruption measured | NOT TESTED | No new onset-to-silence sample. Budget 250 ms was registered and not fitted. Historical T12 figures are not this commit. |
| T2-G5 Turn-taking and backchannels | PARTIAL | Simulator tests pass, including backchannels and the correction path. No acoustic trial. |
| T2-G6 Streaming pipeline measured | PARTIAL | Stage trace and budgets exist. No live stamps. No model latency change. |
| T2-G7 Voice coexists with background agents | PARTIAL | Routing keeps status off the model. No loaded agent and no contention sample. |
| T2-G8 Task-status answers use Host facts | PASS | Classifier and `answerStatus` / `answerVerification` / `answerModel` tests. Not a spoken session. |
| T2-G9 Voice cannot bypass approvals | PASS | Existing refusal tests plus approve/grant/mark-passed cases. Speech stop is not agent stop. |
| T2-G10 Notch shows confirmed voice and agent states | PARTIAL | Unit tests for the new words and precedence. Narrator and a live Island were not walked. |
| T2-G11 Microphone lifecycle and privacy | PARTIAL | Grant rules unchanged and unit-tested. Probe left the muted endpoint alone and saved no audio. Restart was not live. |
| T2-G12 Device failure and Host restart | PARTIAL | Existing session tests cover worker exit and stale epochs. Physical unplug was not done. |
| T2-G13 Voice-worker regression | PASS, with a skip | 24 pass, 1 skip: whisper runtime not staged. Fixture duplex, not acoustic. |
| T2-G14 Full local regression | PARTIAL | typecheck exit 0. UI 421/421. Build exit 0. Library 1670 pass / 1 skip. Agents 58/58. MA4 271 pass / 1 skip. Scripts stage 387 pass / 1 fail: Node LICENSE file absent on this machine. Plain `npm test` also failed 7 unstaged-whisper checks. |
| T2-G15 Installed Windows voice journey | NOT TESTED | No isolated install and no human voice journey on this head. |
| T2-G16 Android capability recorded | PASS for the record | `ANDROID_VOICE_CAPABILITY.md`. Full duplex is not tested and is not a pass. |
| T2-G17 Hosted CI on this commit | NOT TESTED | Runs on the PR after push. PR #42's green checks are the predecessor. |
| T2-G18 Performance and limits documented | PASS | This directory. No p50/p95 invented for a sample that was not taken. |

`npm run build` exited 0. `npm run test:ui` was 421 pass. Final `tsc --noEmit` exited 0.
