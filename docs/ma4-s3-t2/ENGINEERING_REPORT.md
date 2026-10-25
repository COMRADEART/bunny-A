# MA4-S3-T2 engineering report

Bunny A already had a full-duplex voice session from MA3-T12: separate capture and playback, an explicit hands-free grant, turn-taking, streaming chunks, and Host-fact answers. This milestone audited that path and changed it only where a transcript or the notch misrepresented the situation.

PR #42 is merged. This branch starts at that merge (`f429037`). Its checks were green. The post-merge main run was still going when the branch was cut.

## What changed

A correction that starts with "no" and continues ("No, I meant the other file") is no longer thrown away as a cancel. It stays in the conversation, and the prompt tells the model it is a correction and not permission to claim an action. If a proposal is actually pending, "no" still cancels that proposal.

"What's my agent doing?", "Did the tests pass?", "Is the build finished?", and "Which model is running?" resolve from Host rows. An absent row is said to be absent. A final that ends on "that", "which", or "who" uses the existing fragment wait so "I want to create a task that" is not finalized as a complete request.

The notch can say Processing, Speaking, Listening and speaking, Interrupted, and Error when a fresh snapshot proves them. Approval still outranks voice. Idle voice does not hide a real agent count. Horizontal agent chips stay on the left; vertical ones stay on top.

The 60-second voice wait no longer says the model has stopped. It says waiting stopped and the stop is unconfirmed.

Android was not given a microphone permission or a voice adapter.

## What was measured

On this PC the worker started, reported Windows Voice Capture DSP as available, and saw one Intel microphone array and Realtek speakers. Microphone privacy was allow. The input endpoint was muted. The probe did not open the microphone and did not unmute it. There is no new duplex, barge-in, or latency sample. Whisper was not staged; recognition in the probe was SAPI. The native fixture suite passed 24 tests and skipped the whisper fixture.

`npm run test:ui` passed 421. `npm run build` exited 0. Final typecheck exited 0. The library stage passed 1670 with 1 skip, the agent stage passed 58, and `test:ma4` passed 271 with 1 skip. The scripts stage passed 387 and failed 1: the desktop package test requires a Node LICENSE file that is not next to this machine's `node.exe` and is not in the fallback install path. A plain `npm test` also failed 7 whisper checks because the vendor runtime is not staged. CI's scripts stage omits that whisper file. Neither miss is a voice-policy change. They keep a clean local `npm test` from being a pass.

## What this does not claim

The product does not yet have a new human conversation trial. Simulator passes are not human-like conversation quality. Public beta remains NO-GO. Do not merge on acoustic gates that are NOT TESTED.
