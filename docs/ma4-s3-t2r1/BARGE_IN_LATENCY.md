# Barge-in latency

**NOT TESTED** on a microphone.

Scenario A ("Wait, that's not what I meant.") was not spoken. There is no onset-to-silence sample. p50 and p95 are not reported because there are no valid measurements to summarize.

The registered budget remains `interruptToSilence: 250` milliseconds in `src/lib/bunny-host/voice/voice-stages.ts`. It was not changed after this qualification, because nothing was measured.

Worker capability flags are not latency evidence.
