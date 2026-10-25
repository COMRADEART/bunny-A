# Conversation quality

Spoken scenarios A–E were **not run**. The microphone endpoint is muted and capture was not authorized. No p50 or p95 exists for interruption, recovery, or endpointing on this head.

The policies those scenarios depend on are already in the merged voice session, and the library stage that covers them passed (1671 tests, 0 failures).

| Scenario | Policy on this SHA | Acoustic result |
| --- | --- | --- |
| A Immediate interruption | Playback cancel is separate from a Host task stop. Budget 250 ms, unchanged. | NOT TESTED |
| B "No, I meant the other file." | `isSpokenCorrection` keeps it as chat. A bare "no" still cancels a pending proposal. | NOT TESTED |
| C "Mm-hmm." | A pure backchannel during output resumes the reply and is not routed as a cancel. | NOT TESTED |
| D "Create a task that..." | Fragment wait is 2500 ms for an unfinished final. A partial is displayed and is not acted on. | NOT TESTED |
| E Explicit stop | Stopping playback does not claim the model task stopped unless Host Stop is acknowledged. | NOT TESTED |

Simulator coverage is not a conversation trial.
