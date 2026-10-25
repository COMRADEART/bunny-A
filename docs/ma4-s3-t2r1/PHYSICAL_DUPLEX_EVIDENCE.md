# Physical duplex evidence

**BLOCKED.** No physical duplex session was opened.

The device probe recorded one present, muted input and one unmuted Realtek output. `duplex` in the probe summary is null. There is no worker event for `duplex.started`, no playback, and no level captured during speech.

Fixture overlap inside `scripts/voice-worker.test.mjs` uses `--input-synth`, `--input-silence`, or `--input-noise`. Those inputs are labelled `fixture:` and are not this gate.

What would be required, and was not done:

- Hands-free session on the existing worker
- `duplex.started` with `fixture: false`
- A short spoken question and a local transcript
- Playback of Bunny's reply
- A second utterance while that reply is audible
- Turn association from the worker events

No sample here is a physical full-duplex demonstration.
