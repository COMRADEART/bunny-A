# M-A-3 Gate T10: Live Conversational Voice and Interruptible Bunny Companion

- **Branch:** `claude/ma3-t9-phone-remote`
- **Builds on:** T9R-F04 (source `43ffee8`, evidence `c06313f`). The F01–F04 source contracts and sealed evidence are unchanged.
- **Source pin:** `2d5646d`. T10 commits:
  - `b80fab6`: source;
  - `ae026b1`: review round 2;
  - `a23fd8e`: whisper.cpp and round 3;
  - `08aab35` and `e80d313`: live Part-B fixes;
  - `aed363b`: review round 4;
  - `8f043c1`: lint;
  - `2d5646d`: packager.
- **Evidence:** `test-results/ma3/t10/`, sealed with SHA-256 in `INDEX.sha256` and committed in the evidence commit that adds this report.
- **Not done, as instructed:**
  - no push;
  - no T10 deployment;
  - no production restart, migration, credential, phone, tunnel, firewall, Startup or Missions/Triggers change;
  - no change to installed files, Windows microphone privacy, audio drivers or audio settings;
  - no rebuild of Bunny-A;
  - no T11 work.
- **Physical phone:** **NOT TESTED**.

## 1. Result

| Item | Result |
|---|---|
| V01–V60 adversarial matrix (`adversarial-matrix.json`, derived from recorded results) | **60 / 60 PASS**, 0 NOT COVERED |
| Full regression on `aed363b` (`full-regression.log`) | **1,694 / 1,694 pass**, 0 fail, 0 skipped, 0 cancelled: scripts 353, lib 1,133, agent 24, UI 184. The floor of 1,295 is met, with **399 new tests**. The only pre-existing test file touched gains one appended test; no existing assertion was edited. Scripts suite rerun on `8f043c1`: 353/353. Release tests on `2d5646d`: 5/5. |
| Live spoken conversation through the real WPF Island (`live-e2e-conversation.json`) | **PASS.** Five human turns over Ctrl+Alt+Space were transcribed correctly by whisper.cpp. Status and verification answers came from Host facts, chat came from a local tool-free model, and replies played on the real speakers. A **spoken barge-in** during a story stopped audio in 99 ms (worker reset 7.6 ms). A turn ended by voice activity. |
| Human STT on the real microphone (`live/human-stt-session-5-whisper-beep.json`) | whisper base.en: **8/10 near-exact, WER 0.167**, mean confidence 0.75. SAPI baseline: WER 0.95. |
| Ten live interruption scenarios (`barge-in-adversarial.json`) | **10 / 10**, 0 stale resumes. Audible silence on the Core Audio meter: p50 92 ms, p95 109 ms. A Host kill ends the worker in 341 ms. |
| Spoken agent supervision (`agent-voice-supervision.json`) | **PASS** on a live disposable Host: status from canonical facts; pause through `agentCommand` with id+revision; stop by on-screen confirmation only; clarification on an ambiguous agent; redirect explicitly unsupported |
| Glass Notch (`notch-placement-acceptance.json`, `notch/`) | **PASS** on the top, bottom, left and right edges. Indicators sit left of a horizontal notch and on top of a vertical one. Overflow `+N`, reduced motion and the product hotkey also pass. |
| Windows test package `Bunny-A-Windows-MA3-T10-TEST` | **PASS.** Built from `2d5646d`; the 389-file manifest verified before and after. The packaged Host verified and selected the packaged whisper runtime, answered a turn aloud, and left 0 workers after close. The packaged contained provider session also passes. |
| Independent review (`independent-security-review.md`) | Rounds 1–4 with adversarial verification. **No unresolved HIGH.** Two MEDIUM were fixed in round 4. One MEDIUM endpointing limit (T10-VAD-2) and the LOW residuals are disclosed. |
| Typecheck, lint, build | EXIT 0; EXIT 0 (0 errors after `8f043c1`; the 22 warnings are pre-existing, as in F04); EXIT 0 |
| Production v26-MA2-R1 | Unchanged (read-only observation; §12) |

Failed attempts were kept, and each was diagnosed before the next run:
- **SAPI human STT** (WER 0.95) led to the engine change, with the user's approval.
- **Whisper sessions 2–4.** The AGC fed to whisper and speaking before the device opened caused poor results. The fixes were a raw feed and a "mic open" cue.
- **Barge-in attempt 1.** A cancelled chunk still counted as "busy" (B03), so push-to-talk during speech was refused. Fixed.
- **Island attempt 1** exposed three bugs, all fixed in `08aab35`:
  - turns ran to the 30 s cap when room noise rose;
  - a press during transcription was refused as "microphone in use";
  - one close came from an unknown source, so close receipts were added.
- **Island attempt 2:** no input was given. It is recorded as such, not as a failure of the product.
- **Island attempt 3** passed. "Stop, what is …" was proposed as an agent stop; fixed in `e80d313`.

## 2. What was built

| Layer | Implementation |
|---|---|
| Voice worker | `native/voice/BunnyVoiceWorker.cs` (C#, .NET Framework 4), contained in an F04 Job Object. It does the following:<br>• winmm capture and playback at 16 kHz mono;<br>• adaptive VAD with a peak-relative end rule;<br>• **whisper.cpp v1.9.4 `ggml-base.en`** through `bunny-whisper-shim.dll` (pinned, sha-verified before each spawn), with SAPI 5.4 as a visible fallback;<br>• SAPI TTS rendered to PCM and played by its own queue;<br>• `waveOutReset` barge-in with a Core Audio peak-meter silence receipt. |
| Host | `VoiceSessionManager`: an explicit FSM; the only voice state authority; one session. It contains:<br>• a deterministic intent classifier;<br>• answers from canonical facts;<br>• voice chat through `TaskManager.submit` with forced `localOnly`/`offlineOnly` and `approveVoiceTurn` (tool-free local only, DEV-01 pin);<br>• agent control proposals bound to id, revision, epoch and a 30 s TTL;<br>• streaming tokens to a chunker and then to TTS;<br>• generation-guarded barge-in. |
| Protocol | `bunny-voice/1` JSON lines over stdin/stdout; every event carries a turn and a generation. Audio never crosses stdin. |
| Clients | The WPF Bunny Island glass notch, placeable on four edges, with the global push-to-talk chord Ctrl+Alt+Space. In the desktop React voice panel, the browser Web Speech path (cloud) was **removed**. |

## 3. Streaming STT (§8–§10)

The SAPI baseline measured WER 0.95 on the user's real voice. With the user's explicit approval (2026-10-10), pinned whisper.cpp artifacts were downloaded once and sha-pinned (`native/voice/whisper-pin.json`):
- release zip `b5130`;
- source `v1.9.4` (commit `927cfce`);
- model `ggml-base.en`, HF revision `5359861c`, sha256 `a03779c8…`.

Results:
- **Partials:** interim decodes run every 1.2 s and are display-only (V08).
- **Final latency:** 1.0–1.9 s from capture end, live.
- **Never fabricated:** silence and noise end in `stt.none` (V11, V12).

See `stt-engine-decision.md` and `streaming-stt-results.json`.

## 4. Routing and conversation (§11–§13)

- **Chat** goes through the existing T3 router under forced local/offline constraints. It is auto-admitted only as a local tool-free Ollama generation (the user's decision); everything else stays on screen. `:cloud` and hosted tags are refused at execution time (V16).
- **Live routes:** the router picked the user's local `huihui_ai/qwen2.5-abliterate:7b`. First token was 0.68 s warm and 10.3 s cold.
- **Agent answers** use canonical AgentRuntime, Mission and Task records only. UNKNOWN stays unknown (V15, V30, V31).

## 5. Streaming TTS and barge-in (§16–§21)

- Chunks play strictly in `seq` order (V18). Live final-to-first-audio was 112–543 ms for Host-fact answers.
- **Barge-in** works by push-to-talk, hotkey, button, mute, close or Host death. It advances the generation, resets the device, stops only the voice turn's own inference, and drops late events (V19–V22). Agent and Mission work is never touched (V29).
- **Acoustic hands-free barge-in is not supported.** The path is half duplex with no AEC; this is disclosed.

## 6. Agent voice supervision and authority (§14, §15, §22–§27)

- Spoken status, verification, model, approvals and last-mission queries are answered from canonical facts.
- Pause, Resume and Stop are proposals executed through `agentCommand`. Stop and Resume need on-screen confirmation. Pause may be confirmed by voice, but only within its 30 s TTL and with a matching revision and epoch.
- **Talk/Redirect: option B, explicitly unsupported.** See `agent-talk-redirect-status.md`.
- Speech is never identity: `voice.*` actions are workstation-only and paired devices are refused (V35, V38, V40, V56).
- Sensitive phrasing (approval, shell, deletion, publishing, credentials, settings) is refused (V36, V37, V39).

## 7. Privacy and egress (§24, §25)

- No raw audio is retained anywhere. The secret scan also checks for audio files and found 0 (V52).
- The worker contains no network API. STT and TTS are local.
- The worker environment is an allowlist of `SystemRoot` and `windir`.
- The journal carries no transcript or answer text.
- Device views redact voice prompts.

## 8. Glass Notch (§28–§33)

`Get-BunnyPlacement` and `Get-BunnyIndicatorLayout` form one shared rule for all four edges (`notch-layout-contract.md`):
- Indicators sit **left of a horizontal notch** (V47) and **on top of a vertical notch** (V48).
- The notch is always inside the work area (V49).
- Voice state shown on the notch is driven only by fresh Host facts (V46).
- Controls are accessible and the product chord works (V50).
- Reduced motion stays quiet (V51).
- **Secondary monitors and mixed DPI: NOT TESTED.**

## 9. F04 containment (§36)

The voice worker runs under the F04 OwnedProcessGroup:
- suspended admission, with membership verified before resume;
- KILL_ON_JOB_CLOSE, with no breakaway and no uncontained fallback;
- the 512 KiB stdin budget, with an idle relaunch past 384 KiB.

Live: a Host kill during speech ended the worker in 341 ms, and 0 workers remained after every run. The F04 regression passes; see `native-containment-regression.json`.

## 10. Regression, X53 and package (§43, §44)

- Regression totals are in §1. X53 ran live inside the full regression and passed (`calculator-x53-regression.json`); the 10-run stability harness was not repeated.
- The package was built from the pinned archive. The worker and shim were compiled there, and the shim is linked against the pin-verified runtime.
- The packaged gateway on port 8084: **NOT TESTED**, because installed production owns that port.

## 11. Independent security review (§42)

| Round | Survived verification | Outcome |
|---|---|---|
| 1 | 1 HIGH, 12 MEDIUM | Fixed |
| 2 | 13 MEDIUM | Fixed |
| 3 | 4 MEDIUM | Fixed |
| 4 (live fixes) | 3 MEDIUM, 6 LOW | 2 MEDIUM and 4 LOW fixed in `aed363b`, with a mutation-checked race test and a new VAD selftest. T10-VAD-2 (the endpointing limit) and D1 (classifier wording) are disclosed. |

No residual affects authority, identity, egress, privacy or containment. Details are in `independent-security-review.md` and `review/`.

## 12. Production preservation (§45)

Read-only before and after (`production-final.json`):
- **Unchanged:** release bytes, install.json, listeners, PIDs and start times, Startup, and microphone privacy.
- **Changed by production itself:** 10 `provider.status_changed` events, with matching `providers` and `sqlite_sequence` rows. The running production Host's provider probe observed which model the shared local Ollama had loaded during T10's disposable live tests.
- **Changed by the environment:** the audio endpoint list differs because a dock display's speakers are now disconnected.

T10 wrote nothing to production.

## 13. Remaining limitations

Full list: `limitations.md`.

1. Barge-in is push-to-talk, hotkey, button or mute. There is no acoustic barge-in and no AEC.
2. There is no wake word; hands-free mode is opt-in.
3. English only. Interim partials are weaker than finals.
4. Energy endpointing needs the speaker's peak to be at least about 12× the room noise (T10-VAD-2). Otherwise release, a second tap or the 30 s cap ends the turn.
5. A cold local model is slow on its first token.
6. Voice chat is local and tool-free only. Talk/Redirect is unavailable.
7. Physical phone, secondary monitors and mixed DPI, physical device hot-unplug, and the packaged gateway: **NOT TESTED**. The X53 10-run harness was not repeated.
8. Classifier residuals: approve-synonym questions are tool-free chat. The canonical pause and stop paths do not re-check revision themselves.
9. The F04 limitations are preserved unchanged.

## 14. Evidence root

`test-results/ma3/t10/`. Start with `INDEX.md`; `INDEX.sha256` is the seal.

T11 is not started and needs explicit user authorization.

BUNNY_MA3_T10_PASS_WITH_LIMITATIONS
