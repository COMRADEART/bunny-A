# M-A-3 T10 — Speech-to-text engine decision

## Decision (final, 2026-10-11)

**Selected: whisper.cpp v1.9.4 (commit `927cfce`) with the `ggml-base.en` model, CPU only, running inside the Job-Object-contained Bunny voice worker through a small C shim (`bunny-whisper-shim.dll`).**

**Fallback: Windows SAPI 5.4 (`System.Speech`, `MS-1033-80-DESK`).** It is used only when the pinned whisper runtime is absent or fails verification. The Host then says so on screen: `sttNotice` shows the reason, so it never silently degrades.

This replaces the earlier decision for SAPI, which is kept in the history section below. The **user explicitly approved** the change and the download of the pinned artifacts on 2026-10-11, after SAPI failed on the user's real voice.

## Why the decision changed: live evidence

All sessions below used human speech on the real microphone and real speakers, with phrases prompted aloud by Bunny. Only text, confidence, timing and level numbers were kept: no audio.

| Session | Engine | Finals / 10 | Near-exact (WER ≤ 0.25) | Mean WER | Mean confidence | File |
|---|---|---|---|---|---|---|
| 1 | SAPI 5.4 dictation | 10 | 0 | **0.95** | 0.048 | `live/human-stt-session-1.json` |
| 2 | whisper, AGC-fed | 7 | 1 | 0.845 | 0.51 | `live/human-stt-session-2-whisper.json` |
| 3 | whisper, raw feed | 9 | 0 | 0.813 | 0.54 | `live/human-stt-session-3-whisper-raw.json` |
| 4 | whisper, paced prompt | 6 | 1 | 0.813 | 0.51 | `live/human-stt-session-4-whisper-paced.json` |
| 5 | **whisper, raw feed + "mic open" beep cue** | **10** | **8** | **0.167** | **0.75** | `live/human-stt-session-5-whisper-beep.json` |

**Diagnosis of sessions 2–4, from level envelopes only:**
- **AGC fed to whisper:** the time-varying AGC went from 1× before onset to 24× in speech, so whisper heard only the amplified tail of each utterance. Whisper now gets raw frames. The AGC applies only to the SAPI feed.
- **Speaking before the device opened:** the speaker began talking about 0.5 s before the device opened. `live/mic-onset-diagnostic` shows no device fade-in. The product cue is the Island's "Listening" state; the harness adds a beep.

**Live end-to-end through the real Island, with whisper** (`live-e2e-conversation.json`):
- 5 of 5 spoken turns were transcribed exactly in meaning: "What is my agent doing?", "Did the test pass?", "Tell me a story about a rabbit.", "Stop what is the capital of France?" and "What is the capital of France?".
- **Interim partials are weak:** for example "Did the desk" became "Did the test pass?" in the final. Partials are display-only and never acted on (V08).

## Candidates evaluated

| Criterion (§8) | **whisper.cpp base.en (selected)** | SAPI 5.4 `System.Speech` (fallback) | Vosk / sherpa-onnx | Browser Web Speech (removed) | Windows.Media dictation (WinRT) | Hosted STT |
|---|---|---|---|---|---|---|
| Present on machine | Downloaded with approval, pinned and digest-verified (below) | Yes, OS component | No | Yes | Yes | No |
| Accuracy on the user's real voice | **WER 0.167, 8/10 near-exact** | WER 0.95, 0/10 | not measured | — | — | — |
| Streaming | Interim decodes every 1.2 s on the growing buffer, final on end of capture | True streaming hypotheses | Yes | Yes | Yes | Yes |
| Final latency | 1.0–1.9 s from capture end to final (live e2e, 5 turns, TRANSCRIBING→PROCESSING) | about 1.1 s | Low | Low | Low | Network |
| CPU / GPU | CPU, 4 threads; model 148 MB | CPU, small | CPU | — | CPU | — |
| **Offline** | **Yes**, no network at runtime | Yes | Yes | **No: cloud** | **No: online recognition** | No |
| Licensing | MIT (code), MIT (model) | OS component | Apache-2.0 | — | OS | Contract |
| Cancel | `abortRequested`: an in-flight decode result is discarded; the generation guard drops stale events | `RecognizeAsyncCancel` | Yes | `abort()` | Yes | Yes |
| Host privacy policy | Compliant | Compliant | Compliant | **Violates §24** | Violates §24 | Needs consent |

## Pinned artifacts (`native/voice/whisper-pin.json`)

| Artifact | Pin |
|---|---|
| Release binaries | `whisper-bin-x64.zip`, tag `b5130`, sha256 `f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c` |
| Source (headers for the shim) | `v1.9.4.tar.gz`, sha256 `57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae`. Commit `927cfce` was verified as both b5130 and v1.9.4. |
| Model | `ggml-base.en.bin`, HF revision `5359861c739e955e79d9a303bcbc70fb988958b1`, 147,964,211 bytes, sha256 `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002` |
| Runtime DLLs | 13 files, each sha256-pinned |
| Shim | sha256 recorded in `native/voice/bunny-voice-worker.json` at build time |

**Integrity (`selectSpeechEngine`, `voice-worker.server.ts`):**
- Every runtime file, the shim, the model and the pin are sha-verified **before each spawn**.
- Any unlisted file in the runtime folder refuses whisper, because an extra DLL would be loaded by name.
- Release layouts require the release manifest.
- A failed verification falls back to SAPI with a visible notice.
- The vendor folder is gitignored. The packager copies the verified runtime into the test package.

## Limitations

- English only (`base.en`). Accents and noise are handled better than by SAPI, but the model is small.
- Interim partials are noticeably worse than finals. They are display-only.
- whisper does not distinguish speakers. Speech is never identity (§14, §25).
- There is no acoustic echo cancellation, so the voice path is half duplex. Barge-in is push-to-talk or button, not acoustic (see `voice-architecture.md`).
- A cold first decode includes model load. The worker loads the model once per worker process.

## History: original decision (2026-10-10, superseded)

The first decision selected SAPI 5.4. It was the only engine already installed that was offline, streaming and cancellable, and the brief forbids silently installing large models. Its integration facts still hold for the fallback path:
- the input `Stream.Read` must block until the full count arrives;
- the input must be closed before `RecognizeAsyncCancel`.

The spike's digital self-recognition passed. It was superseded when the live human session 1 measured WER 0.95.
