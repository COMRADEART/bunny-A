# T10/T11 voice gap audit (before implementation)

## Source inspected

Audit against starting HEAD `e417a22215ffc507e54278c24b36482108ac6b5f`, whose executable source is T11 `032954fad7c0d66097a1e6efe502eda21a66c3ce`.

## Real audio and recognition

`native/voice/BunnyVoiceWorker.cs` owns the devices. `WaveInSource` opens winmm capture at 16000 Hz, mono PCM16 with six 20 ms buffers. A guarded capture thread polls completion and detects device stalls; model inference and final recognition are separate threads. `CaptureTurn` owns a bounded per-turn buffer (30 seconds), zeroes samples on release, and publishes worker monotonic timestamps. There is no AEC or playback-reference path.

Whisper.cpp v1.9.4 runs through `whisper-shim.c`, with pinned DLL/header/model assets and a bounded CPU thread count. A single shared decode gate serializes real partial/final decodes. Partials are revised real decodes after onset and approximately every 1.2 seconds; final decoding is off the command loop. Token probabilities and no-speech evidence are provided by the engine. Missing Whisper explicitly reports local SAPI fallback; neither engine uses cloud audio. T10 live evidence is retained under `test-results/ma3/t10/`, including microphone, speaker, conversation and worker-calibration reports. README caveats predate some of the final T10 acceptance and are not substitutes for those receipts.

## Endpointing

`Vad` uses 400 ms calibration, 120 ms sustained onset, 900 ms silence plus 700 ms recognizer-evidence hold. Peak-relative endpointing is capped at 0.002 RMS and decays so a loud event does not permanently suppress soft speech. A manual `capture.end` fallback and 30 second bound remain. Energy-only attribution cannot distinguish echo from independent speech. Quiet speech close to room noise may fail to endpoint.

## Generation and speech output

`VoiceSessionManager` submits voice chat through the existing TaskManager/BunnyRouter and streams task output into `VoiceChunker`. The worker uses Windows SAPI synthesis to PCM16, then winmm output. `Speaker` has ordered synthesis/playback threads, bounded queues (24 chunks / 400 characters), cancellation-generation floors, device reset, stale-chunk refusal, and endpoint-meter cancellation receipts. No second router or scheduler is needed.

The Host advances its generation on explicit interruption, drops stale worker/task callbacks, and stops only its own tool-free conversational inference. However `bargeIn` currently records inference stopped before the asynchronous stop completes; T12 must distinguish request/acknowledgment from remote cancellation confirmation. Protocol writes inside state locks can block cancellation if the Host stops reading; this is a real reliability gap, not audio latency evidence.

## Why simultaneous listening/speaking fails

1. Native `Program.StartCapture` explicitly rejects `speaker.IsBusy()` with `BUSY_PLAYBACK`.
2. `listenStart` cancels speech before opening capture.
3. `maybeRearm` waits for IDLE, zero queued audio, and no inference/playback, then waits another 400 ms.
4. `setState` clears capture truth outside LISTENING and playback truth outside SPEAKING.
5. A single current turn/generation gates both capture and playback, preventing an independent next input turn.
6. Each `CaptureTurn` closes its device when endpointing/finalization begins.

Simply removing the busy check would feed synthesized speaker echo to recognition and is insufficient.

## Host, Agents and UI

Host voice operations are workstation-only and not phone DEVICE_RIGHTS. Existing controls create bounded proposals with identity, revision, TTL and Host epoch; sensitive actions remain screen reviewed. Partials are never executed. T11 `answerTeam` and canonical Agent/Mission/approval facts answer team supervision queries. Free-form Talk/Redirect remains explicitly unsupported. Voice is not the owner of background Agent sessions. Normal spoken conversation remains tool-free Regular Chat; delegation currently requires the canonical Agentic review path rather than a voice-to-provider channel.

WPF integration is `install/Bunny-Island.Voice.ps1`, polling Host facts every 200 ms; React uses `src/components/island/voice-model.ts` / `voice.tsx`. Both must expose concurrent capture/playback truth without fake waveforms. Existing horizontal-left / vertical-top Agent layouts must stay intact.

## Native process lifecycle and reuse decision

`voice-worker.server.ts` verifies source/binary/runtime manifests, launches through `OwnedProcessGroup` suspended Job admission, uses a minimal environment, and settles Job ownership on shutdown/unknown state. Keep this F04 path. Existing independently managed Ollama must not be seized or terminated.

Reuse capture-turn recognition, Whisper, local TTS, ordered Speaker cancellation, Host Task routing, Agent facts/controls, and process containment. Extend audio ownership with an explicit continuous hands-free capture session and a real Windows AEC source, independent input/output identities, local bounded interruption decisions, and truthful composite UI. AEC initialization/reference failure must refuse full duplex and retain T10 push-to-talk; it must never silently open raw simultaneous microphone input.

## AEC evaluation inputs

Microsoft Voice Capture DSP (`CLSID_CWMAudioAEC`) source mode is a candidate: Windows owns capture and render-reference synchronization and format alignment; application output must use the selected reference endpoint. Documented source: https://learn.microsoft.com/en-us/windows/win32/medfound/voicecapturedmo and https://learn.microsoft.com/en-us/windows/win32/medfound/mfpkey-wmaaecma-system-modeproperty . Source-mode capability/configuration is not proof of acoustic effectiveness. Endpoint identity, real ProcessOutput samples, speaker-only self-trigger trials and human double-talk must be separately verified. Native APO AEC depends on device support; WebRTC AEC3 would require additional pinned native dependencies. Selection remains subject to implementation and device evidence.

## Post-implementation note (2026-10-12)

The VAD figures above describe the **pre-T12 half-duplex** lane and are unchanged for push-to-talk. The T12 duplex lane adds a
continuous ambient model and an output-time residual threshold that was **recalibrated on the real device** (floor
0.002 → 0.0003 RMS, relative learning band) after the first live runs; the measurements and the reason are in
`aec-engine-decision.md` and `acoustic-echo-results.json`. Duplex end-of-turn no longer trusts whisper's trailing punctuation
(live finding: every partial ends with a full stop); see `limitations.md`.
