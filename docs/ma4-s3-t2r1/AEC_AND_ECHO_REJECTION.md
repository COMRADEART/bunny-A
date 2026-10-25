# AEC and echo rejection

**BLOCKED** as a room measurement.

The worker reported Windows Voice Capture DSP source mode as available. That flag is the same fact recorded in the device enumeration. It is not an echo-return measurement.

No duplex session was opened, so there is no reference loopback sample, no playback-versus-capture level, and no echo-rejection figure. The 250 ms interruption budget in `VOICE_STAGE_BUDGETS_MS` was not used as a result and was not edited.

Native fixture tests that keep pre-roll from mixing with audible output passed in the library stage. They use injected PCM. They do not measure this room.
