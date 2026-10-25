# Windows acoustic evidence

Date: 2026-10-25. Machine: this Windows workstation. Probe: `scripts/ma4-s3-t2-voice-probe.mjs --acoustic`. Raw summary: `evidence/windows-device-probe.json`.

## What was observed

The contained worker became ready.

| Fact | Value |
| --- | --- |
| STT | Windows SAPI 5.4 System.Speech |
| TTS | Windows SAPI 5.4 System.Speech |
| `ready.duplex.supported` | true |
| `ready.duplex.backend` | Windows Voice Capture DSP/source |
| Inputs / outputs | 1 / 1 |
| Default input | Microphone Array (Intel Smart Sound Technology for Digital Microphones) |
| Default output | Speakers (Realtek Audio) |
| Microphone privacy | allow |
| Input endpoint muted | true |
| Output endpoint muted | false |

`ready.duplex.supported` is the worker's capability flag. It is not a measurement of echo cancellation in the room.

## What was not done

The probe did not call `duplex.start`. The default input endpoint was muted, and the precondition for an echo-cancelled open was refused. The microphone was not unmuted, and raw capture was not started.

No human utterance, barge-in, backchannel, or device unplug was recorded. Whisper.cpp was not staged (`T10-whisper` skipped: runtime not staged), so this probe did not exercise the pinned recognizer.

Capture-during-playback on a real speaker remains **not tested** on this head. The native fixture that overlaps silence-input with a null sink passed (24 worker tests, 1 whisper skip). That fixture is not acoustic evidence.

Historical MA3-T12 human trials stay historical. They were not rerun on this commit.
