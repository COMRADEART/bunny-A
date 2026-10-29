# MA5-S2 Phase 3: Native real-time full-duplex voice integration

Branch `ma5-s2-phase3-realtime-voice`, cut from `main` at `eab14cc` (PRs #61, #62 and #63 merged).
Target: native Windows 11 Bunny A. No merge, no release, no live audio. Phase 4 (physical acoustic qualification) not started.

**Evidence class.** Every result below comes from code, unit tests, or the real contained voice worker driven with its
test-only fixture flags (`--input-silence` / `--input-synth`, `--output null`). No microphone or speaker was opened in
this phase. AEC effectiveness, real spoken barge-in, human STT accuracy, speaker-to-microphone feedback and acoustic
latency are **BLOCKED** pending owner authorization, and nothing here is offered as evidence for them.

## 1. Verified baseline and gap matrix (P3-0)

The voice engine was already deep (MA3 T10/T12, MA4-S3-T2/T5). It was audited in code at `eab14cc` before any change.

| Area | Already present (verified in code) | Proven by | Phase 3 gap found | Result |
|---|---|---|---|---|
| Protocol | `bunny-voice/1` JSON lines; every turn-bound event carries Host `turn` + `gen` | `voice-protocol.ts`, worker tests | none; preserved unchanged (one additive snapshot field, `watches`) | kept |
| Engine seam (P3-1) | `VoiceSessionDeps.launch → VoiceWorkerPort`; worker owns capture, AEC DSP, VAD, STT (SAPI or whisper.cpp), TTS, playback; Host owns turn-taking and orchestration | code; fake-worker tests use the same seam | none; documented in §2. No second session manager added | kept |
| Full duplex (P3-2) | Windows Voice Capture DSP (`CLSID_CWMAudioAEC`) lane, output-aware onset, echo gate, held replies, push-to-talk fallback when duplex is unsupported | T12 fixture tests; **no acoustic proof** | native app had **no way to start hands-free** | **closed**: Voice Studio "Start/Stop Hands-Free" |
| Turn-taking (P3-3) | `VoiceTurnTaking`: backchannel, hesitation, interrupt phrases, sustained speech, echo match, hallucination list, unfinished-sentence hold, generation fencing | `voice-turn-taking.ts`, 455 voice tests | "goodbye, Bunny" did not end voice | **closed** (bare "bye" still does not: it is a recognizer hallucination) |
| Latency (P3-4) | `VoiceTiming` stamps + `voiceStageTrace`; chunker releases a first chunk before the model finishes | MA4-S3-T2 (no live stamps on that head) | no fresh numbers; "~11 s under agent load" never attributed | **measured** (§5) |
| Agent collaboration (P3-5) | Host-fact answers for status, team roles, last Mission, approvals, follow-ups; Mission drafts; screen-confirmed controls | T10/T11/T12 tests | three of the brief's own examples fell to the **model**: "What failed?", "Tell me when this task is completed.", "Prepare a plan for a new task." | **closed** (§3) |
| Notch (P3-6) | Phase 2 pill: 6 labels; ARMING≡LISTENING, TRANSCRIBING≡PROCESSING; closed ≡ idle; no "user interrupting"; no vertical-edge pill; no Narrator change event; no level | `NotchWindow.xaml.cs` at `eab14cc` | all of those | **closed** (§4) |
| Privacy (P3-7) | nothing opens at Host start (V01); grant only from explicit hands-free start; mute aborts capture; worker in a `KILL_ON_JOB_CLOSE` job | T10/T12 tests | not re-proven on the native app | **re-proven live** (§4, v1/v6/v7/v8/v10) |
| Reliability (P3-8) | worker crash/exit, stale epochs, late events, stdin budgets, relaunch at idle | existing session tests | voice close during a running Mission never measured live | **measured** (§6) |

## 2. Voice architecture (P3-1)

```
 Microphone ─▶ [worker] capture (winmm) ─▶ AEC DSP (duplex) ─▶ VAD/endpointing ─▶ STT (SAPI | whisper.cpp) ─┐
                                                                                                              │ bunny-voice/1
 Speaker  ◀─ [worker] playback (winmm) ◀─ TTS (SAPI) ◀── speak{turn,gen,seq} ◀──────────────────────────────┤ (stdin/stdout)
                                                                                                              ▼
 Host VoiceSessionManager (only voice authority): FSM · VoiceTurnTaking · generation fence · classifyTranscript
   ├─ Host facts (agents, Missions, approvals, completion notices) ── no model
   ├─ chat ─▶ router (local-only, tool-free) ─▶ VoiceChunker ─▶ speak
   └─ controls/drafts ─▶ proposal ─▶ canonical agent.* / mission.* path (screen or spoken confirm only where allowed)
 Clients (native Voice Studio, notch, web Island) render VoiceSnapshot and send voice.* actions; they decide nothing.
```

The replaceable seam is `VoiceSessionDeps.launch(options) → VoiceWorkerPort` (`send`, `onEvent`, `close`, `exited`,
`stdinBytes`). A future engine adapter implements that port and speaks `bunny-voice/1`; the notch, Missions and the
Host authorization path do not change. Phase 3 added no new engine and no second session manager.

## 3. Code changes

Host (`src/lib/bunny-host/voice/`):

- `voice-intent.ts`: "what failed / did anything go wrong" → `agent_team:any_failed`; "tell me / let me know when … finishes"
  → new `agent_watch`; a draft whose objective is only "a new task" (`GENERIC_OBJECTIVE`) is recognized instead of chatted;
  "goodbye / that's all, Bunny" → `voice_close`. Sensitive wording is still refused first.
- `voice-answers.server.ts`: `answerFailures` (every canonical Mission, plain or team, superseded rework excluded) and
  `missionOverNotice`.
- `voice-session.server.ts`: **completion notices**. Read-only: the Mission is resolved from the live referent or the single
  unfinished Mission (never guessed among several), at most 3 per session, 60 min each, polled every 2 s. A notice is spoken
  only at a quiet moment (no inference, no queued or playing output, no held reply, no pending fragment or recognition, no
  open user utterance on the duplex lane) and is skipped forever once voice closes. Notices are in memory only, so a new
  Host process has none. Objective-less plan requests ask for the objective and create nothing.
- `voice-protocol.ts`: `agent_watch` turn kind, `VoiceSnapshot.watches`, three `VOICE_LIMITS`. Additive only.

Native Windows (`native/windows/BunnyA/`):

- `Services/NotchVoice.cs` (pure, unit-tested): Host voice snapshot → one of `OFF, ON, ARMING, LISTENING, RECOGNIZING,
  THINKING, SPEAKING, INTERRUPTING, INTERRUPTED, MUTED, DEVICE_UNAVAILABLE, ERROR, DISCONNECTED`. "Listening" needs the
  worker-confirmed `capturing`; "Speaking" needs confirmed `playing`; "You're interrupting" is the Host's `outputHeld`.
- Notch: pill in both orientations (new `VVoicePill` for Left/Right edges), live level `ProgressBar` from the worker's
  measured RMS (−60..0 dBFS), shown only while capture is confirmed and the reading is under 1.5 s old; Narrator
  `LiveRegionChanged` on a state change only (never on level); high contrast uses system brushes; agent chips untouched.
- Voice Studio: "Start/Stop Hands-Free" (the explicit grant; Stop switches to push-to-talk, which ends the duplex lane and
  revokes the grant), a typed-question box (same Host answer path as speech), "🔴 microphone on" indicator.
- `MainWindow`: while the Host confirms capture, only `voice.state` is read every 250 ms for the level (level changes raise
  no Host event); the timer stops as soon as capture ends.

## 4. Windows notch and Voice Studio evidence (P3-6, P3-7)

`scripts/ma5-s2/verify-voice-windows.mjs` → `evidence/voice/windows-voice.json`. Compiled WPF app, disposable real Host
(Ollama adapter only, local `qwen2.5 7B`), real worker with `--input-silence --output null`; everything read through UI Automation.

| Stage | What was checked | Result |
|---|---|---|
| v1 start is private | app start: pill `OFF`, Host `open=false capturing=false playing=false`, **0 voice workers** | PASS |
| v2 open push-to-talk | session opens without opening the microphone (`capturing=false`) | PASS |
| v3 Host-facts turn | "What failed?": `answerSource=host_facts`, no model route; pill SPEAKING → ON | PASS |
| v4 model turn + barge-in | local model answer; pill SPEAKING; Barge-In → Host interrupt receipt (`source=button`) | PASS |
| v5 hands-free | explicit press → `duplex.active` (fixture lane), pill LISTENING, level bar present, "hands-free microphone on" | PASS |
| v6 mute | pill MUTED, `capturing=false`, duplex released, no level shown | PASS |
| v7 stop hands-free | mode back to push-to-talk, capture released, grant cleared | PASS |
| v8 close | pill OFF, worker process gone | PASS |
| v9 vertical edge | Left edge: `VVoicePill` reports OFF → ON → OFF | PASS |
| v10 Host disconnect | pill DISCONNECTED; after Host restart OFF, nothing reopened, 0 workers | PASS |

10/10 PASS; voice workers after shutdown: 0. `BunnyA.Tests`: 134 checks pass, including the full voice-state table and
the level rules (fresh only, never while muted or not capturing).

Not shown live: THINKING was not caught by UIA sampling in the final run (each UIA read costs about 1 s and a warm model's
PROCESSING phase is shorter; the mapping is unit-checked); RECOGNIZING, INTERRUPTING, DEVICE_UNAVAILABLE and ERROR need
real recognition, real speech over output or a real device fault (unit-checked only). Narrator was not run: the
LiveRegionChanged event and HelpText are wired, but no screen-reader walk was done.

## 5. Latency and resource measurements (P3-4, P3-9)

`scripts/ma5-s2/measure-voice-latency.mjs`, run twice on the final harness, once per recognizer this checkout can select:

- `evidence/voice/voice-latency-sapi.json`: **SAPI** (`Windows SAPI 5.4`, en-US dictation). This is what the committed
  build record selects: `selectSpeechEngine` refuses whisper because the staged `bunny-whisper-shim.dll` differs from the
  record.
- `evidence/voice/voice-latency-whisper.json`: **whisper.cpp v1.9.4 (ggml-base.en)**. `npm test`'s pretest rebuilt the
  shim and rewrote `native/voice/bunny-voice-worker.json` for this machine's gcc build, so whisper was selected. That
  record change is local build churn and **is not committed**: the gcc shim build is not byte-reproducible, and re-pinning
  is an owner decision (§10).

Machine: RTX 4050 laptop (6 GB), Ollama, local model `huihui_ai/qwen2.5-abliterate:7b` (the router's pick).
Boundaries: "playback start" is the worker's `playback.started` on the null sink. A typed turn starts when the Host
receives the text. `speechEndAt` is the Host receipt of the VAD `speech_end`, which the worker emits after 900 ms of
endpoint silence. Output-device latency and microphone capture delay are not included anywhere.

All values are in ms, P50 / P95 by nearest rank; warm-up turns excluded.

| Path | n | SAPI pass | whisper pass | Dominant stage |
|---|---|---|---|---|
| Session open (worker launch in the F04 job → ready → devices) | 1 | 123; worker 23.7 MB | 312; worker 228.9 MB (model loaded) | whisper model load |
| Host facts, typed, text receipt → playback start | 30 | 19 / 37 | 16 / 22 | — (no model route on any turn) |
| Model **cold** (unloaded first), text receipt → playback start | 1 | 7 530 | 6 794 | admitted → first token 6 535 / 6 093 |
| Model **warm**, text receipt → playback start | 10 | **1 006 / 1 150** | **968 / 1 064** | first token → first TTS ≈ 550; admitted → first token ≈ 350 |
| Model warm **under agent load** (1–2 team agents on the same model at every turn start) | 6 | **13 216 / 22 380** | **12 728 / 19 069** | admitted → first token 12 666 / 12 179 (P50) |
| Host facts under agent load | 1 | 66 | 99 | — |
| **End to end**, synthesized speech → VAD → STT → Host → model → TTS → playback start, from VAD `speech_end` | 5 | **937 / 1 137** | **1 878 / 1 960** | STT: speech end → final 8 (SAPI, streaming) vs 1 022 (whisper, one full decode) |
| STT alone on the worker clock, VAD `speech_end` → result | 5 | 14 / 15, confidence 0.49 | 896 / 901, confidence 0.97 | — |

Add the fixed 900 ms endpoint silence to the end-to-end row to get "last word → playback start": about 1.8 s with
SAPI and about 2.8 s with whisper. Both are under 3 s P50 on an idle Host. With SAPI the end-to-end transcript was "…what
does a rabbit **each**" (one word misheard on synthesized speech); whisper transcribed it exactly. Neither is a
human-accuracy figure.

**First-audio time under agent load.** The historical "about 11 s under agent load" is reproduced: 12.7–13.2 s P50,
19–22 s P95. It is now split by stage. Recognition, routing, synthesis and playback together stay under about 0.7 s.
**Waiting for the model's first token is about 95 % of it.** The voice turn waits behind the team agents' requests to the
same local Ollama model, and Ollama serves them one at a time on the 6 GB GPU. The voice path itself is not the bottleneck.
Phase 3 does not change this; options are in §10. Host-fact answers skip the model, so they are unaffected (66–99 ms
under load).

**Barge-in (target: P95 ≤ 200 ms, software acknowledgment).** n = 30 per pass, every one during confirmed null-sink
playback. Worker cancel acknowledgment (`workerCancelWaitMs`: Host `speak.cancel` → playback thread `waveOutReset` done):
**SAPI pass 9.3 / 13.2 (max 14.8); whisper pass 9.8 / 13.2 (max 15.0)**. Host `voice.interrupt` HTTP round trip
8.5 / 10.4 and 7.8 / 12.3. 0 resets pending. `meterSilentMs` is null on all 60 (there is no render endpoint). This
acknowledgment does not prove that sound stopped at a speaker; that is a Phase 4 measurement.

## 6. Host and Mission concurrency (P3-5, P3-8)

From the same two latency passes (real Host, real team Missions on the local model):

| Check | SAPI pass | whisper pass |
|---|---|---|
| Voice answered every turn while 1–2 team agents ran, each interrupted at playback | 6/6 | 6/6 |
| Voice session **closed and reopened while a Mission was `running`** | still `running`; 0 workers after close | still `running`; 0 workers after close |
| Background team Missions after all voice interrupts and closes | 4, all `completed`; **0 stopped by voice** | 4, all `completed`; **0 stopped by voice** |
| Voice workers after clean shutdown (both Hosts) | 0 | 0 |
| Phase 3 temp folders left behind | 0 | 0 |

Unit and fixture coverage (unchanged suites plus the new tests): stale-generation drops, late recognition, cancelled
inference that keeps emitting tokens, rapid repeated barge-ins, worker exit and relaunch, stdin budget relaunch, Host epoch
change, the hands-free grant and idle release, and device errors are all in `voice-session.test.ts`, `voice-duplex.test.ts`
and `scripts/voice-worker.test.mjs`. New: P3-V01..V07 (session) and the hands-free notice test (duplex). Physical
device unplug, playback-device change and a worker crash on real hardware were **not** exercised.

## 7. Privacy and authorization regressions (P3-7)

- No new authority: a completion notice reads canonical records and speaks; it never calls `agent.*` or `mission.*`
  (P3-V03/V05 assert no command, stop or draft). Spoken approval wording is still refused before the watch rule
  (P3-V01: "tell me when you approve the plan" → `sensitive_refused`).
- Nothing opens at start (v1, V01), mute releases capture (v6), Stop Hands-Free releases the lane and grant (v7), close
  ends the worker (v8), a Host restart reopens nothing (v10).
- Evidence files hold no audio, no human transcript (fixture phrases only), no token, no private path (`writeEvidence`
  guard; project path scrubbed).

## 8. Regression and CI

Local, Windows 11, on the Phase 3 source (before the docs-only commits):

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` (pretest builds the ownership addon and voice worker; scripts, library incl. all voice suites, agents, MA4) | **2,544 tests: 2,543 pass, 1 skip, 0 fail** (476 + 1,688 + 62 + 318) |
| `npm run test:ui` | 421/421 |
| `npm run build` | exit 0 |
| `native/windows/build.ps1` (Debug build + `BunnyA.Tests`) | 0 warnings, 0 errors; 134 checks pass |
| `scripts/verify-ma5-s1r1-outcome.mjs` (outcome-unknown handling, scripted + real Host) | 114/114 + 11/11 |
| `native/windows/package-dev-candidate.ps1` | two Release builds byte-identical (4 files); unsigned dev candidate zip built to a scratch folder, not committed |
| `scripts/ma5-s2/verify-voice-windows.mjs` | 10/10 |
| `scripts/ma5-s2/measure-voice-latency.mjs` (SAPI pass and whisper pass) | exit 0 both; 0 workers after shutdown |

Second-opinion review: the owner's Bunny CLI (`COMRADEART/bunny` @ `169ba05`, local `qwen2.5-coder:7b`, `--permission-mode
plan`, read-only) reviewed the latency harness. The first attempt only grepped for words and reported nothing, which is
not a review. A second attempt read the file. Of its five findings, two were valid after checking them against the code
and were fixed: the STT loop now closes its worker and removes its temp folder in `finally`, and the mid-load close check now
asserts "not stopped" instead of "still running", since a Mission may finish during the close. Three findings were not
defects (top-level `finally` already closes every Host; null gaps are intended; no concurrent model load at unload time).
A third harness defect was found by inspecting the results: the STT section labelled a run "sapi" while the launcher had
selected whisper. It now names the engine from the worker's own `ready` event. Both committed evidence files come from the
harness with all three fixes.

Not this phase's: the existing containment suite (`npm test`) leaves `%TEMP%\bunny-f04-*` folders behind (84 present
here). Phase 3 scripts leave none.

Hosted CI: see the PR (results recorded in the PR description once the run finishes).

## 9. Acceptance matrix

| # | Requirement / target | Result | Evidence |
|---|---|---|---|
| A1 | Gap matrix before implementation | PASS | §1 |
| A2 | Pluggable engine seam, no second session manager | PASS | §2 (existing `launch → VoiceWorkerPort`; documented, not rebuilt) |
| A3 | Explicit hands-free activation in the native app; push-to-talk fallback kept | PASS (fixture lane) | v5, v7; existing fallback tests |
| A4 | Stale-turn execution: zero | PASS (software) | generation and turn fencing suites; P3 tests add no unfenced path |
| A5 | Unauthorized voice actions: zero | PASS | notices are read-only (P3-V03/V05); approvals still refused (P3-V01); existing T10–T12 refusal suites |
| A6 | Orphaned voice workers after clean shutdown: zero | PASS | v8, v10, latency run: 0 |
| A7 | Barge-in cancellation acknowledgment P95 ≤ 200 ms (controlled) | **PASS: 13.2 ms** in both passes (n=30 each, null sink) | §5. Not proof of audible silence |
| A8 | Warm first audible model response P50 ≤ 3 s | **PASS, idle Host**: 1.0 s from text (both engines); last word → playback start ≈ 1.8 s (SAPI) / ≈ 2.8 s (whisper), null sink | §5 |
| A8b | Same target with agents working | **MISS: 13.2 s / 12.7 s P50, 22.4 s / 19.1 s P95** | §5. Cause: first-token queueing on the shared local model. Not fixed in Phase 3 |
| A9 | Voice active during background Mission: no unintended cancellation | PASS | §6: 0 of 8 stopped; close during `running` left it running (both passes) |
| A10 | Closed session leaves no capture or playback | PASS | v8 (`capturing=false playing=false`, worker gone) |
| A11 | Agent questions from Host records | PASS | P3-V01/V02 + existing T10–T12 answer tests; v3 live (`host_facts`) |
| A12 | "Tell me when this task is completed" | PASS (fixture) | P3-V03..V06, hands-free notice test |
| A13 | Notch: 10 voice states + off, beside agent chips, 4 edges, high contrast, level only from real data | PASS for the mapping and live OFF/ON/LISTENING/SPEAKING/MUTED/DISCONNECTED; **PARTIAL** for live THINKING, RECOGNIZING, INTERRUPTING, DEVICE_UNAVAILABLE, ERROR (unit-checked only) | §4 |
| A14 | Narrator announcements | **PARTIAL**: LiveRegionChanged + HelpText wired; no Narrator walk | §4 |
| A15 | No live audio without permission; no raw audio or transcripts stored or uploaded | PASS | fixture flags only; evidence guard |
| A16 | AEC effectiveness | **BLOCKED** (Phase 4) | — |
| A17 | Real spoken barge-in (onset → audible silence) | **BLOCKED** (Phase 4) | — |
| A18 | Human STT accuracy (SAPI and whisper) | **BLOCKED** (Phase 4). With the committed build record, this checkout selects SAPI (shim ≠ record) | — |
| A19 | Speaker-to-microphone feedback, acoustic latency | **BLOCKED** (Phase 4) | — |
| A20 | Physical device unplug, playback-device change, real worker crash | **NOT TESTED** on hardware | fixture/unit only |
| A21 | Regression, packaging, hosted CI | see §8 | — |

Overall: **PARTIAL**. The software integration is complete and measured. The latency target under agent load is missed and
reported. Everything acoustic waits for Phase 4.

## 10. Phase 4 prerequisites and owner approvals needed

Owner approvals needed (each separately):

1. **Live microphone and speaker session** on the Windows workstation: which devices, the volume, the room, and that
   Bunny may open the default endpoints for a bounded, attended session. The default input endpoint was **muted** in the
   last MA4 probe; the owner unmutes it, and Bunny never will.
2. **Spoken test script**: the phrases to speak (status, interrupt, backchannel, close), so no personal speech is
   captured. No audio is recorded or stored. Transcripts in evidence are limited to the scripted phrases.
3. **Whisper runtime**: re-stage `native/voice/vendor/runtime` so `bunny-whisper-shim.dll` matches the pin
   (`node scripts/stage-whisper.mjs`, then `node scripts/build-voice-worker.mjs`), or approve a re-pin. Until then the Host
   uses SAPI, which MA3 measured as unusable on this microphone (WER 0.95).
4. **Under-load latency decision** (A8b). Options, in rising cost: (a) say a Host-authored "still thinking" line when
   the first token is late; (b) give voice turns priority at the router (pause or yield queued agent model calls);
   (c) run a smaller dedicated voice model or raise `OLLAMA_NUM_PARALLEL` (VRAM-bound on the 6 GB GPU). Each
   changes product behaviour, so none was chosen here.

Phase 4 measurements, once approved: onset → render-meter silence (`VoiceBargeInReceipt`), echo rejection rate during
playback, false-interrupt rate on backchannels and room noise, human WER and confidence per engine, speech end → audible
first word, device unplug and default-device change mid-session, and Narrator walk-through of the voice pill.
