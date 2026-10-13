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
- **Speech recognition**: SAPI (`System.Speech`) with the en-US dictation grammar, streaming, unless `--stt whisper` is set
  (see the Whisper engine section). The recognizer reads a
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

## Whisper engine (`--stt whisper`)

Production flags, passed by the Host (they are not test-only):
`--stt whisper --whisper-dir <absolute runtime dir> --whisper-model <absolute model path> [--whisper-threads <n>]`.
Without `--stt whisper` the worker uses SAPI exactly as before.

- **Runtime**: whisper.cpp v1.9.4 (tag b5130, commit 927cfce, MIT), CPU build. The pinned artifacts and hashes are in
  `whisper-pin.json`. `scripts/stage-whisper.mjs` verifies the release zip, the source tarball, the vendored headers and
  the model against the pin, then stages `native/voice/vendor/runtime/` (gitignored). It never downloads: a missing
  file is reported with its pinned URL. `scripts/build-voice-worker.mjs` builds `bunny-whisper-shim.dll` from
  `whisper-shim.c` with gcc and records its hashes under `whisperShim` in the build record.
- **Model**: ggml-base.en (MIT), loaded once at startup (about 150 ms on the test machine). The `ready` event reports
  `stt: {engine: "whisper.cpp v1.9.4", recognizer: "ggml-base.en", culture: "en", local: true}`.
- **Fallback, never silent**: if the runtime or model is missing or fails to load, `ready` reports SAPI and an `error`
  event with code `STT_UNAVAILABLE` and the message `whisper unavailable: <reason>; using Windows SAPI` follows it.
- **Feed and endpointing**: the recognizer input is a bounded float buffer of the current turn (up to `maxMs`, at most
  30 s), holding the AGC'd audio. Levels and VAD still use the raw frame. There is no recognizer evidence, so the VAD ends
  a turn after 900 ms of silence following at least 250 ms of speech, and reports `no_speech` after 8 s without an onset.
- **Partials**: genuine decodes of the buffered audio, after a VAD onset, at most one in flight, about every 1.2 s once
  1 s of audio exists. A partial is never sent after the terminal event.
- **Final**: one full decode of the bounded utterance on the finalize thread, never on the command loop. A `capture.abort`,
  mute or shutdown that arrives during the decode discards the result: the turn ends as `stt.none` `aborted`.
- **Acceptance**: `stt.final` confidence is the mean probability of the non-special tokens. A decode is rejected as
  `stt.none` when it is empty, bracketed (`[BLANK_AUDIO]` gives `no_speech`, other brackets `noise_only`), when a segment's
  no-speech probability exceeds 0.6, or when a short utterance (under 1 s of speech) is only a known silence phrase such
  as "you" or "thank you". Without a VAD onset there is no decode, and the turn ends as `no_speech` or `noise_only`.
  Whisper's own no-speech score is not reliable on silence (zero PCM decoded to "you" with probability 0.000), so the
  VAD gate is what stops silent hallucinations.
- **Measured here** (Windows x64, 4 threads): a decode of a 2 to 3 s fixture utterance finished 0.87 to 1.4 s after
  speech end. That time includes the 900 ms endpoint silence in the buffer.
- **Logs and data**: whisper and ggml logs go to a no-op callback. The only stderr line is the model load time. Raw audio
  is never written to disk. Transcript text appears only in `stt.partial` and `stt.final`.

## Local-only engines

SAPI and `System.Speech` are Windows components that ship with the OS. Nothing is downloaded, nothing is
installed, and the worker makes no network connection. Recognition and synthesis run locally. The whisper runtime is
staged once from artifacts the operator fetched and pinned by hash, and the worker opens no connection to load it.

## Fixture flags are test-only

`--input-synth <text>`, `--input-silence`, `--input-noise`, `--input-wav <path>`, `--output null` and
`--fixture-pace <factor>` exist only for the automated tests. The Host never passes them. Fixture input is labelled
`fixture:<kind>` (device index -2) in `capture.started`, so evidence can never mistake it for a microphone.
The null sink is a real-time clock, not an audio device: nothing is audible during tests.
With fixture input, the worker does not touch the microphone and does not apply the hardware pre-checks
(privacy and endpoint mute). Those checks run only on real devices.

## Full-duplex input (M-A-3 T12)

`duplex.start` opens one continuous input through the Windows Voice Capture DSP in source mode (`CLSID_CWMAudioAEC`), bound
to the default render endpoint as its reference. If the DSP, the endpoint identity or the reference binding fails, the
session reports `duplex.error` and never falls back to a raw microphone. Turns attach with `capture.start` `duplex: true`.

- Startup: the first 20 frames (about 400 ms) measure the ambient floor. `duplex.started` carries `floor`, and no onset is
  admitted before it. Stop and mute are honored before, during and after the device open.
- Ambient model (`AmbientFloor`): the floor is a min-follower over 500 ms with slow attack and fast release, clamped to
  [0.0002, 0.005]. It learns from every frame while no speech is in progress, between turns too. The floor cap bounds the
  onset threshold, so ambient above about 0.015 RMS can still start a turn. It cannot hold one open: a duplex turn takes
  the window's quietest frame at onset as its quiet reference, and a frame within 1.5x of that reference counts as silent.
  Stationary ambient therefore ends its turn after the 900 ms silence clock (or the 4 s soft wait), not at the 30 s cap.
  Speech after silence is judged against that silence, so only a steady level with no quiet part is affected.
- Output-aware onset: while our own speaker is audible, or held for 1.5 s after it was last audible, the onset threshold is
  at least `residual * 2`. The residual is a session value. It is seeded once from the median of the first five
  output-window frames (never from one frame). It jumps to its cap when the median of the latest five is above 0.0045, so
  a loud echo that follows a quiet start (AEC latency) is learned. Its effective value is never below 0.002 (so a quiet
  first frame cannot seed it low) and never above 0.003 (so a sustained talker is not absorbed into it). The EMA learns
  only from frames between 0.001 and 0.0045. Silence never decays it: a paused chunk is silent on the device while still
  in flight, and an inter-chunk gap is silent too. User speech above 0.0045 never raises it. Net effect while held: the
  threshold is between 0.004 and 0.006, so steady echo at 0.003, 0.0045 or 0.005 (from a steady start or a quiet one) is
  never an onset, and user speech at about 0.008 is.
  Limits (disclosed, measured with the selftest): the threshold never exceeds 0.006, so echo above 0.006 RMS at the device
  still starts a turn while output is audible. Speech at or below 0.006 RMS does not barge in during output or the 1.5 s
  hold, so quiet speech over output (Limitations: 0.003 to 0.008 on the owner's microphone) may be held back. This trade
  is accepted pending a product decision on the measured quiet-speech level. Level events report `floor`, `residual` (null
  when nothing is held) and `outputActive`.
- Pre-roll and echo: each pre-roll frame keeps its capture time (Out.Clock). A frame captured while our output was audible,
  or in its 260 ms reverb tail, is echo when it is below 0.006 RMS, and such a frame is dropped rather than replayed. A
  louder frame in that window is user speech over our output, so it is kept. A new turn replays the kept frames, and its
  onset (`onsetMono`) is the capture time of the first loud frame, so an echo of our own speech is never replayed as the
  start of a user turn.
- Duplex stop reason (`duplex.stopped`): `stop` (the Host asked for it), `mute` (the microphone was muted and the loop
  ended for it), `lifetime` (the lifetime bound ran out; a mute that lands in the same read as an expired bound is
  reported as `lifetime`), or `error`.
- Pause release on failure: a `playback.error` for a generation releases that generation's device pause, so the next
  chunk of the generation is not paused and can complete. (The Host side of this, releasing its own hold, is a Host-lane change.)
- Endpointing: duplex speech always ends with `speech_end` after the silence clock. A burst under 250 ms ends the turn with
  `short: true` and `stt.none` reason `too_short`, with no decode. Speech with no frame above the onset threshold for 4 s
  ends the turn regardless of recognizer evidence.
- A `playback.error` for a generation releases that generation's pause request on the worker, so the rest of the gen plays
  unpaused. The Host clears its hold on that error and must not rely on the worker keeping the gen paused.
- Pause receipts: `playback.paused` (on) reports `requestMono` (when the request arrived), and `silentMono`/`meterSilentMs`
  when the render meter read silent within 1.5 s. Both are measured from the moment the device was paused, not from the
  request, so a pause requested before any audio plays is not charged for the wait. `wasAudible` is the meter at that
  moment. The meter is polled on a separate worker, never on the playback thread. `playback.paused` (on: false) is sent
  once for each real transition back to playing, including a barge-in reset that restarts a paused device.
- The preroll is 3 s. The next turn can attach as soon as the previous capture stops, while that turn still finalizes.
  `capture.abort` with `turn` and `gen` reaches only the matching capture, active or finalizing.
- Timing: `timeBeginPeriod(1)` is held for the life of a session and always released. Output is drained while the DSP
  reports INCOMPLETE, into a bounded one-second buffer. Three rotating silence buffers keep the reference endpoint fed.

## Containment

The Host launches the worker inside a `KILL_ON_JOB_CLOSE` Job Object. The worker spawns no child processes.
All of its threads are background threads, and it holds only the `winmm` and COM handles listed above.

## Limitations

- Recognition is en-US dictation (SAPI `MS-1033-80-DESK`). Accuracy depends on microphone quality and speaking style.
- Live microphone accuracy with SAPI was measured as unusable on the owner's machine: 10 spoken phrases gave a word error
  rate of 0.95 and a mean confidence of 0.048, with speech RMS of about 0.003 to 0.008. That is why `--stt whisper` exists.
  The whisper engine has been tested with synthesized fixtures only. Its live-microphone accuracy must be measured before
  it is relied on.
- The render endpoint meter includes audio from other applications. `meterSilentMs` is a measured endpoint
  silence, not proof of this worker's output alone. It is null for the null sink and when the meter is unavailable.
- Half-duplex capture (the default, T10) is unchanged: the worker refuses `capture.start` (`BUSY_PLAYBACK`) while playback
  is queued or active. The full-duplex lane (below) is implemented, but its acoustic effectiveness is not verified by any
  test here. Only device evidence can show that echo is actually cancelled.
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

Whisper runtime: `node scripts/stage-whisper.mjs` (verify and stage, no download), then `node scripts/build-voice-worker.mjs`
(builds the shim when the runtime is staged, and prints why it skips otherwise).

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
