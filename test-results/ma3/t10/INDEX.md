# T10 evidence index: live conversational voice and interruptible Bunny companion

- **Source pin:** `2d5646d` (branch `claude/ma3-t9-phone-remote`; nothing pushed). T10 source commits:
  - `b80fab6` and `ae026b1`: source and round-2 fixes;
  - `a23fd8e`: whisper.cpp and round-3 fixes;
  - `08aab35` and `e80d313`: live Part-B fixes;
  - `aed363b`: round-4 fixes;
  - `8f043c1`: lint-clean test regexes;
  - `2d5646d`: the packager compiles the whisper shim from the pinned archive.
- **Report:** `MA3_T10_LIVE_VOICE_ACCEPTANCE.md` (repository root).
- **Seal:** `INDEX.sha256` lists every file here except the `windows-package/` binaries (not committed, as in F03 and F04), plus the report. Verify the committed copy with `node test-results/ma3/t10/seal-evidence.mjs --verify-staged`.
- **Results are derived, not hand-asserted.**
  - `assemble-evidence.mjs` builds the topic `*-results.json` / `*-acceptance.json` files, `regression-inventory.json` and `full-regression.log` from the logs and live receipts.
  - `build-adversarial-matrix.mjs` builds `adversarial-matrix.json`.
  - A missing input is reported as missing, never as PASS (`assembly-report.json`: no missing inputs).
- **Failed attempts are retained:** `live/live-e2e-attempt1-partB.json`, `live/live-e2e-attempt2-no-input.json`, `live/barge-in-attempt1-before-B03-fix.json`, and the SAPI and whisper sessions 1–4.
- **No raw audio anywhere.** The live harnesses keep only text, confidence, timing and level numbers. `secret-scan.json` also scans every file for audio by extension and by RIFF/WAVE header: 0 found.

| File | What it shows |
|---|---|
| `baseline.md`, `baseline/` | starting point `c06313f`: 1,295/1,295, plus the production snapshot |
| `voice-baseline-audit.md` | the voice surface before T10: browser Web Speech (cloud), no Host voice, no worker |
| `stt-engine-decision.md`, `tts-engine-decision.md` | engine choice. STT: SAPI first, then **whisper.cpp v1.9.4 base.en** with user approval after SAPI scored WER 0.95 on the real voice. TTS: SAPI. |
| `voice-architecture.md`, `speech-turn-state-machine.json` | pipeline, trust boundaries and the explicit FSM |
| `agent-talk-redirect-status.md` | Talk/Redirect explicitly unavailable (option B); pause, resume and stop supported |
| `audio-device-inventory.json`, `device-inventory.mjs` | read-only device enumeration by the worker |
| `microphone-permission-results.json` | privacy and endpoint-mute handling; Bunny never changed Windows audio settings |
| `live/human-stt-session-*.json`, `streaming-stt-results.json`, `live-microphone-acceptance.json` | human speech on the real microphone. SAPI: WER 0.95. whisper session 5: 8/10 near-exact, WER 0.167. Envelope diagnostics in `live/mic-onset-diagnostic.json`. |
| `live-e2e-conversation.json`, `live/live-e2e.mjs`, `live/live-e2e-run3.log` | **the human spoken conversation through the real WPF Island** (Ctrl+Alt+Space): 5 turns transcribed correctly; status and verification answers from Host facts; local-model chat; spoken barge-in during a story (reset 7.6 ms, audible silence 99 ms); VAD end-of-turn |
| `streaming-tts-results.json`, `live-speaker-acceptance.json` | SAPI playback on the real speakers, chunk order, playback timing |
| `voice-latency-results.json` | per-turn timing: activation → capture → final → first token → first audio → completed |
| `barge-in-adversarial.json`, `barge-in-latency.json`, `live/barge-in-matrix.mjs` | the 10 live interruption scenarios: 0 stale resumes, meter silence p50 92 ms / p95 109 ms, Host kill ends the worker in 341 ms |
| `audio-resource-cleanup.json` | worker and device release on close, Host death, budget relaunch |
| `agent-voice-supervision.json`, `voice-command-authorization.json`, `live/agent-supervision.mjs` | spoken agent queries and controls through canonical Host authority (live disposable Host); authorization tests |
| `cloud-egress-verification.json`, `voice-privacy-audit.json` | no network API in the worker; local-only routes; journal without transcripts; environment allowlist; device redaction |
| `notch-layout-contract.md`, `notch-placement-acceptance.json`, `notch/` | glass notch on all four edges, indicator side and axis, overflow, reduced motion, product hotkey receipts and screenshots |
| `desktop/` | desktop and mobile render of the Host-backed voice panel |
| `host-restart-results.json` | Host restart and death: no revived session or approval |
| `native-containment-regression.json`, `calculator-x53-regression.json` | F04 containment tests and the live X53 Calculator test, both in the full regression |
| `adversarial-matrix.json` | V01–V60: **60/60 PASS** (derived) |
| `independent-security-review.md`, `review/round1…4-findings.json` | four independent review rounds with adversarial verification and the disposition of every finding |
| `regression/`, `full-regression.log`, `regression-inventory.json`, `typecheck.log`, `lint.log`, `build.log` | full regression on `aed363b`: **1,694/1,694**, 0 skipped, 0 cancelled (floor 1,295). Scripts suite rerun on `8f043c1`: 353/353. Release tests on `2d5646d`: 5/5. Typecheck 0, build 0. Lint 0 errors after `8f043c1` (22 pre-existing warnings, same as F04). A first run on `e80d313` was stopped after its scripts suite (353/353) because source changed; its logs were overwritten. |
| `windows-package-results.json`, `packaged-voice-acceptance.json`, `windows-package-release-manifest.json`, `windows-package-build.log`, `package-boot.mjs`, `package-runtime.log` | `Bunny-A-Windows-MA3-T10-TEST` (`1.0.0-MA3-T10-TEST`, built from `2d5646d`): 389-file manifest verified before and after; packaged boot healthy; **packaged voice**: whisper verified and selected, a typed turn answered aloud, 0 workers after close; packaged contained provider session |
| `production-before.json`, `production-final-observation.json`, `production-final.json`, `production-observe.mjs`, `production-compare.mjs` | read-only observation of installed v26-MA2-R1: release bytes, install.json, listeners, PIDs, Startup and microphone privacy all unchanged. The only DB differences are production's own `provider.status_changed` events about the shared Ollama model. The audio endpoint list changed because a dock display's speakers disconnected. |
| `limitations.md` | every disclosed limitation, including the preserved F04 limits |
| `secret-scan.json`, `secret-scan.mjs` | secret patterns, exact production credential values, and audio files |
| `assemble-evidence.mjs`, `build-adversarial-matrix.mjs`, `seal-evidence.mjs`, `assembly-report.json` | derivation and seal |
