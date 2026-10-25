# Turn-taking and barge-in

The controller is still `VoiceTurnTaking`. It has no clock. The session owns timers.

## Rules that stayed

- Level evidence never interrupts.
- Speech onset during playback pauses. A short burst resumes.
- An interrupt phrase needs at least 180 ms. Two content words need at least 500 ms.
- "yeah", "mm-hmm", and "uh-huh" during output resume the reply.
- Echo is judged per spoken chunk. "stop" is not echo by overlap.
- "stop" / "stop talking" is `speech_stop`. "stop the agent" is a proposal. Neither runs from the transcript alone.

## Correction

Before this change, `CANCEL` treated a leading "no" as a cancel even when more words followed, unless a question caused the lead word to be stripped. "No, I meant the other file" became "Nothing is waiting to be cancelled." and never reached the conversation.

It is now chat when nothing is pending. `isSpokenCorrection` adds one instruction: answer the correction from the previous turn, and do not claim a file read, a test, or an action. With a proposal pending, "No, …" still cancels that proposal and does not answer the rest of the sentence.

## Unfinished speech

"I want to create a task that" now matches the fragment policy because it ends on "that". The wait is still the existing 2.5 s, bounded by 9 s. A status question is not held. This is a simulator result (`isUnfinishedChat`). No acoustic pause was recorded.

## Interruption latency

No new onset-to-silence sample was taken. The registered budget is 250 ms (`VOICE_STAGE_BUDGETS_MS.interruptToSilence`), chosen before this run and not fitted to it. MA3-T12 reported worker-visible onset to render-meter silence around 177 ms median on an earlier build. That number is not a result for this commit.

Simulator coverage is in `voice-t2-eval.test.ts` and the existing `voice-duplex.test.ts` controller cases. Those passes are not human barge-in proof.
