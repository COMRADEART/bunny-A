# Bunny native voice worker

`BunnyVoiceWorker.cs` builds to `bunny-voice-worker.exe` (with `bunny-voice-worker.json`, the build record).
It is the only process that owns the microphone and speaker handles for M-A-3 T10 voice.

## Purpose

The worker turns real microphone audio into recognized text, and turns text into real speech on the output device.
It is an input/output modality only. It has no authority to act on what it hears: the Host
(`VoiceSessionManager`) decides what a transcript means and what may run.

## Protocol

The wire contract is `src/lib/bunny-host/voice/voice-protocol.ts` (`bunny-voice/1`).
Commands arrive on stdin as JSON lines (UTF-8). Events leave on stdout as JSON lines, one object per line,
each with `t` (epoch ms) and `mono` (Stopwatch ms). Every turn-bound event carries the `turn` and `gen` it was started with.
Lines are ASCII-only and capped at 64 KiB. Command lines over 64 KiB are rejected.

Lifecycle: the worker emits `ready`, then answers commands. EOF on stdin or `{"op":"shutdown"}` stops capture and
playback, releases every handle, emits `bye`, and exits with code 0 (within about 2 s).

## Audio paths

- **Capture**: `winmm` `waveInOpen` on the chosen device (or `WAVE_MAPPER` for -1). 16 kHz, mono, 16-bit PCM,
  20 ms buffers in a rotating set of six. Completion is polled; no callbacks are used.
  Device loss is reported after 1.5 s with no completed buffer.
- **Speech recognition**: SAPI (`System.Speech`) with the en-US dictation grammar, streaming. The recognizer reads a
  blocking PCM pipe. It sees audio only after the worker's own voice-activity gate; text without a speech onset
  is never reported as a final. Recognizer text that SAPI rejected, with no recognized text in the turn, ends as
  `stt.none` with reason `rejected`; rejected text is never promoted to a final.
- **Endpointing (VAD, `endpointing: "vad"`)**: energy VAD on the raw frame. The noise floor is the quietest frame in
  the first 400 ms, and the onset threshold is `max(floor * 3, 0.0006)`. Onset needs 120 ms above it. Speech ends after
  900 ms of silence AND 700 ms with no recognizer evidence (a hypothesis or speech-detected event), so a recognizer that
  is still hypothesizing keeps the turn open. `no_speech` fires only after 8 s with no onset and no recognizer evidence.
  `capture.end` always finalizes, whatever the VAD state.
- **Automatic gain (fed audio only)**: the recognizer receives audio scaled by a smoothed gain, 1x to 24x, that drifts
  toward a speech RMS of 0.1 while speech is active. Outside speech the gain is held at 1x, so the noise floor is never
  amplified. Levels (`level` events) and the VAD always use the raw frame, so AGC never changes a reported level.
- **Synthesis**: SAPI `SpeechSynthesizer` renders each chunk to PCM. Chunks are queued (at most 24, at most 400 characters each)
  and played in `seq` order.
- **Playback**: `winmm` `waveOutOpen` / `waveOutWrite`. The output handle stays open across chunks and for 3 s after
  `playback.idle`, then closes; it also closes on shutdown and after a device failure. Only the playback thread calls the
  device, and never with the state lock held. `speak.cancel` marks and drops chunks at once, then waits at most 250 ms
  for the playback thread to apply `waveOutReset`. If the driver has not returned by then, the receipt carries
  `resetPending: true`, the reset still happens when the driver returns, and the command loop is never blocked behind it.
  Afterwards one background meter worker polls the default render endpoint peak meter (`IAudioMeterInformation`) every
  5 ms, for at most 1 s, to report `meterSilentMs`. The worker queues at most 4 requests. A receipt beyond that is sent
  at once with `meterSilentMs: null`, and no thread is started per cancel.
- **Device index**: `device` must be absent, `null`, or an integer in [-1, int.MaxValue]. Anything else is refused with
  `DEVICE_UNAVAILABLE` (`capture.error` or `playback.error`), never truncated into another device.
- **Device state**: read-only Core Audio queries (endpoint name, mute, volume), plus the Windows microphone privacy
  value under `CapabilityAccessManager\ConsentStore\microphone` (HKCU and HKLM). The worker never calls `SetMute` or
  `SetMasterVolume`, and never writes any Windows setting.

## Local-only engines

SAPI and `System.Speech` are Windows components that ship with the OS. Nothing is downloaded, nothing is
installed, and the worker makes no network connection. Recognition and synthesis run locally.

## Fixture flags are test-only

`--input-synth <text>`, `--input-silence`, `--input-noise`, `--input-wav <path>`, `--output null` and
`--fixture-pace <factor>` exist only for the automated tests. The Host never passes them. Fixture input is labelled
`fixture:<kind>` (device index -2) in `capture.started`, so evidence can never mistake it for a microphone.
The null sink is a real-time clock, not an audio device: nothing is audible during tests.
With fixture input, the worker does not touch the microphone and does not apply the hardware pre-checks
(privacy and endpoint mute). Those checks run only on real devices.

## Containment

The Host launches the worker inside a `KILL_ON_JOB_CLOSE` Job Object. The worker spawns no child processes.
All of its threads are background threads, and it holds only the `winmm` and COM handles listed above.

## Limitations

- Recognition is en-US dictation (SAPI `MS-1033-80-DESK`). Accuracy depends on microphone quality and speaking style.
- The render endpoint meter includes audio from other applications. `meterSilentMs` is a measured endpoint
  silence, not proof of this worker's output alone. It is null for the null sink and when the meter is unavailable.
- There is no acoustic echo cancellation. Voice is half duplex: the Host cancels speech before listening, and the worker
  refuses `capture.start` (`BUSY_PLAYBACK`) while playback is queued or active.
- Per-turn recognizers are created for each capture. Creating one costs a few hundred milliseconds, and it is the
  price of a clean finalize.
- If the recognizer does not complete even after cancel, the turn finishes on its normal decision (a final only for text
  recognized with a VAD onset, otherwise `stt.none`), its raw audio buffer is zeroed and released at once, and the engine
  is kept until the recognizer completes, then disposed.
  At most 2 such engines are kept. While the bound is reached, `capture.start` is refused with `STT_UNAVAILABLE`, and
  the worker must be restarted if the recognizer never completes.
- Thread faults: a fault on the playback, synthesis or finalize thread is reported as one `playback.error` (`INTERNAL`)
  or `stt.none` (`aborted`) and ends the affected chunk or turn. It never terminates the process.
- Capture thread faults: the capture body runs under the same guard. A fault there, including a protocol write that fails
  because the Host pipe closed, ends the turn with `capture.error`. Error and stop events on those paths never throw.
- Recognizer start failure: a recognizer whose start throws is disposed before the error is reported as `STT_UNAVAILABLE`.
- Playback timeout: a chunk whose header never completes is released only after `waveOutReset` returns it. The handle
  closes even when the first `waveOutClose` fails (one reset and one retry). A header the driver still reports as playing
  is never freed; it is kept for the process lifetime.
- Raw audio: capture buffers are overwritten with zeros before they are freed, and the capture frame and feed buffers are
  cleared when the turn ends. The recognizer pipe is wiped at finalize.
- Known, not fixed: protocol events are written while `Speaker.gate` or `Program.Gate` is held. If the Host stops reading
  stdout for a long time, a blocked write stalls the command loop (speak.cancel and barge-in wait behind it). A closed
  pipe does not block, it throws. Moving writes out of the locks would reorder `playback.started` against cancel receipts,
  which the Host protocol relies on, so this needs a protocol-level change.
- Stale `speak` commands (gen at or below the highest cancelled gen) are dropped without playback. `speak.cancelled`
  reports `staleDropped`: the count since the previous cancel receipt.
- Live loopback (synthetic SAPI voice through the laptop speakers into the real microphone, user's volume): the VAD and
  endpointing fire and produce finals, but the transcripts were wrong and the confidence was very low (0.005 to 0.09).
  Accuracy on this path is not usable yet. Ambient-only capture produced `no_speech` and no final.
- Ambient bursts up to about 0.004 RMS (about 30x the quiet floor) were observed on this microphone. They are comparable
  to quiet speech, so an energy VAD can open an onset on them. A final still needs an onset, but a burst can open one.
- The first playback turn after more than 3 s of idle costs about 400 to 550 ms (`waveOutOpen`); a warm turn within the
  window costs about 1 ms.
- Real-device capture and playback paths are implemented and compile, but the automated tests use fixtures only.
  They have not been run against the real microphone or speakers.

## Build

`node scripts/build-voice-worker.mjs` compiles with the .NET Framework 4.x `csc.exe` (C# 5, x64) and
records the source, binary, compiler and `System.Speech` hashes in `bunny-voice-worker.json`.
The build is skipped when the record matches. On non-Windows platforms it exits 0 with a skip notice.
`npm test` runs this step through `pretest`.

## Tests

`node --test scripts/voice-worker.test.mjs` spawns the built exe with fixture flags and checks the V-matrix
behaviors listed in the test names. It is Windows-only and skips on other platforms.

`bunny-voice-worker.exe --selftest` runs the endpointing, stop-decision and gain rules with no devices and no audio, and
prints one `selftest` event. The T10 tests use it, and a WAV fixture check confirms that reported levels equal the raw
samples window by window.
