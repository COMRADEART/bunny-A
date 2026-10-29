# MA5-S2 Phase 3 voice evidence

| File | Produced by | What it is |
|---|---|---|
| `windows-voice.json` | `node --experimental-strip-types scripts/ma5-s2/verify-voice-windows.mjs` | UI Automation run of the compiled WPF app (notch + Voice Studio), stages v1–v10 |
| `voice-latency-sapi.json` | `EVIDENCE_NAME=voice-latency-sapi.json node --experimental-strip-types scripts/ma5-s2/measure-voice-latency.mjs` (committed build record: SAPI) | Host and worker receipts: barge-in, cold/warm/under-load model turns, end-to-end synthesized speech, STT |
| `voice-latency-whisper.json` | the same script with a locally rebuilt whisper shim record (not committed) | the same sections with whisper.cpp ggml-base.en |

Both runs use disposable Hosts and the real contained voice worker with **test-only fixture flags** (`--input-silence`
or `--input-synth`, and `--output null`). No microphone or speaker was opened, and no audio was recorded. Transcripts
are the scripted fixture phrases only. Tokens and the disposable project path are scrubbed by `scripts/evidence-guard.mjs`.
None of these files is acoustic evidence.
