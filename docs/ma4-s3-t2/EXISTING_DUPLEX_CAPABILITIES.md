# Existing duplex capabilities

Audited on the MA4-S3-T1R3 main tip before any T2 edit. The duplex path was reused.

## Lanes

The native worker keeps capture and playback apart. `duplex.start` opens the Windows Voice Capture DSP source mode (`SINGLE_CHANNEL_AEC`) and a render-loopback reference. `duplex.started.fixture` is true only for the test sink. A fixture start is not a room recording.

The session will not send `duplex.start` without an explicit hands-free start. Mode switches do not create a grant. Mute, expiry, worker exit, device loss, and close revoke it. A later idle re-arm does not reopen the microphone after the grant is gone.

If AEC or the reference endpoint fails, the worker emits `duplex.error` / `AEC_UNAVAILABLE`. The session does not fall through to an uncancelled raw capture. The client copy tells the person to use push-to-talk.

## Identifiers

Each hands-free input turn has its own id and `VoiceTurnTaking` instance. Each spoken answer has its own generation. Stale worker events and late model callbacks increment a drop count and do not resume playback.

## What this milestone did not replace

Host task admission, agent runtime, mission approval, and the voice worker process job are unchanged. Speech stop still silences playback or asks which stop was meant. It does not call agent stop.

## What this milestone changed inside that design

- A leading "no" with more words ("No, I meant the other file") is chat, and the prompt says it corrects the previous turn. With a proposal pending, a leading no still cancels that proposal.
- "What's my agent doing?", "Did the tests pass?", "Is the build finished?", and "Which model is running?" classify to Host-fact intents.
- A final that ends in "that", "which", or "who" uses the existing fragment wait.
- The voice wait timeout no longer says the model has stopped. It says waiting stopped and the stop is unconfirmed.
- The notch can show Processing, Speaking, Interrupted, and Error from a fresh snapshot.
