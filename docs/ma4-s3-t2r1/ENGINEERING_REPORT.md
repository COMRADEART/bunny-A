# MA4-S3-T2R1 engineering report

Bunny A already has one duplex voice session. This milestone qualified that session on the Windows machine that holds the installed product. It did not replace the worker, the grant rules, or the 250 ms interruption budget.

The integrated source is `4af7d9f313ee46b98698fe12662b11676b3391cd`, the merge of PR #43. Hosted CI on the PR head and on that merge commit succeeded. The qualification branch was cut from that commit in a new worktree. The installed release and its startup shortcut were not modified.

## Runtime

Local `npm test` had been blocked by a Node install with no license file beside `node.exe`, and by an unstaged Whisper runtime. This run used an official Node v24.18.0 zip whose SHA-256 matches `nodejs.org` `SHASUMS256.txt`, license included. The pinned whisper.cpp 1.9.4 archives already on disk matched `native/voice/whisper-pin.json` and were staged by `scripts/stage-whisper.mjs`. Nothing was invented and nothing was downloaded for Whisper.

## Regression

`npm run typecheck`, `npm run test:ui` (421), both production builds, and the static security checks passed. The library stage passed 1671, the agent stage passed 58, and `npm run test:ma4` passed 271 with the usual opt-in live-model skip.

The first `npm test` process exited 1. `MA2 T1 Windows controller: after-config` sat for about 40 minutes and then failed because stderr was empty. The same test passed in 17.3 seconds when run alone. Hosted CI on this SHA had already passed it. The hang is in the migration controller's process wait, not in the voice path. The later `npm test` stages were run with the same commands after that, and they passed.

## Audio

The default input is the Intel microphone array. Windows microphone privacy is Allow. The endpoint is muted. The probe enumerated devices and did not call `duplex.start`. The worker was `whisper.cpp v1.9.4` with Windows SAPI speech output, and it reported Voice Capture DSP support. That flag is not echo rejection, duplex, or latency.

No spoken interruption, correction, backchannel, fragment, or stop was performed. There is no p50 or p95. No bottleneck was proven, so the voice path was not changed.

An isolated package of this SHA started a Host on port 43991 and was stopped. It did not open the microphone. The installed Bunny A was still the 18 October release afterward.

## Decision

Acoustic gates G4, G5, G6, G7, G9, and G12 are BLOCKED. G2, G8, and G11 are PARTIAL. G10 was not run as a live session. Hosted CI on `70b579e` passed: https://github.com/COMRADEART/bunny-A/actions/runs/40242544117. Public beta stays NO-GO. Do not merge on these results.

The microphone can be tested only after it is unmuted by hand and the acoustic run is explicitly authorized. This qualification will not unmute it.
