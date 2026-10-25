# MA4-S3-T2R1 acceptance matrix

Public beta: **NO-GO**. Acoustic gates are not passed by fixtures or by the duplex capability flag.

| Gate | Result | Evidence |
| --- | --- | --- |
| T2R1-G1 Baseline and hosted CI verified | PASS | `BASELINE.md`. Integrated SHA `4af7d9f313ee46b98698fe12662b11676b3391cd`. Workflow 40234165018 success on PR head `c2e3d8d`. Merge push 40236068024 success on that SHA. |
| T2R1-G2 Full local regression completed | PARTIAL | `LOCAL_RUNTIME_AND_REGRESSION.md`. One `npm test` process exited 1 on a 40-minute migration hang. That test passed on rerun. Library 1671, agents 58, MA4 271 pass / 1 opt-in skip, UI 421, typecheck 0, both production builds 0, security checks clean. |
| T2R1-G3 Pinned Whisper worker qualified | PASS | Pin-verified stage of whisper.cpp 1.9.4. Fixture tests in `scripts/voice-worker.test.mjs` passed, including ready `whisper.cpp v1.9.4`. Fixture PCM is not a microphone. |
| T2R1-G4 Physical microphone capture verified | BLOCKED | Input endpoint muted. Capture was not opened. `MICROPHONE_AUTHORIZATION.md`. |
| T2R1-G5 Physical full-duplex operation demonstrated | BLOCKED | `PHYSICAL_DUPLEX_EVIDENCE.md`. No `duplex.started`. |
| T2R1-G6 AEC and echo rejection measured | BLOCKED | DSP support was reported. No room measurement. `AEC_AND_ECHO_REJECTION.md`. |
| T2R1-G7 Real acoustic interruption measured | BLOCKED | No onset-to-silence sample. 250 ms budget unchanged. |
| T2R1-G8 Natural correction and backchannel tests completed | PARTIAL | Simulator coverage passed inside the library stage. Spoken scenarios A–E were not run. |
| T2R1-G9 Speech-response latency measured | BLOCKED | No valid physical samples. p50 and p95 are not stated. |
| T2R1-G10 Background agent coexistence demonstrated | NOT TESTED | No live agent and no spoken Host-status questions. Classifier tests passed with the library stage. |
| T2R1-G11 Host permission and privacy controls preserved | PARTIAL | Consent was read and not changed. The mic was not opened and did not reopen. Physical revocation and unplug were not done. |
| T2R1-G12 Installed Windows voice journey completed | BLOCKED | Isolated candidate host started and stopped. Existing install untouched. Voice journey on that UI was not walked. |
| T2R1-G13 Full final-head hosted CI passed | PASS | Push run https://github.com/COMRADEART/bunny-A/actions/runs/40242544117 conclusion success on evidence commit `70b579e9dba88f5097f806e74444069d413df50c`. Jobs: fast checks, full `npm test`, static security. |
| T2R1-G14 Evidence and limitations published | PASS | This directory. |

No voice architecture was replaced. No second engine was added.
