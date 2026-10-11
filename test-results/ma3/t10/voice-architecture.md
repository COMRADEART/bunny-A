# M-A-3 T10 — Voice architecture

**Voice is an interface. It is not an authority.** T10 adds a subordinate voice pipeline beside the canonical path. It does not add a second scheduler, MissionManager, TaskManager, router, authorization engine, event store, memory authority or provider permission system.

```
                    ┌────────────────────── Windows workstation ───────────────────────┐
 WPF Bunny Island ──┤ POST /command voice.*  (Bearer = workstation token, loopback only) │
 (glass notch)      │                                                                    │
 Desktop UI tab ────┤ gateway server fn commandBunnyHost → POST /command voice.*        │
                    │                                                                    │
                    │  Bunny Host (Node)                                                 │
                    │   └ VoiceSessionManager  (only voice state authority; 1 session)   │
                    │       ├ VoiceFsm (explicit table; illegal moves refused + counted) │
                    │       ├ voice-intent (deterministic classifier, no model)          │
                    │       ├ voice-answers (canonical AgentRuntime/Mission/Task facts)  │
                    │       ├ voice-chunker (token deltas → ordered speakable chunks)    │
                    │       ├ chat port → TaskManager.submit (T3 router, localOnly) →    │
                    │       │             approveVoiceTurn (tool-free pin) → Ollama      │
                    │       ├ agent port → agentCommand(agent.pause/resume/stop,{id,rev})│
                    │       └ VoiceWorker transport ── OwnedProcessGroup (F04 Job Object)│
                    │                         │ JSON lines on stdin/stdout (bunny-voice/1)│
                    │                         ▼                                          │
                    │   bunny-voice-worker.exe  (C#, .NET Fx 4, sha256-pinned)           │
                    │     waveIn 16k mono → VAD → whisper.cpp base.en (raw frames, shim) │
                    │       (fallback: AGC → SAPI STT, only if whisper fails verify)    │
                    │     SAPI TTS → PCM chunks → waveOut queue (reset = barge-in)       │
                    │     Core Audio: endpoint names/mute/volume (read-only), peak meter │
                    └────────────────────────────────────────────────────────────────────┘
```

## Pipeline

1. **Activation (explicit only).** The user presses the Island mic button (press-and-hold), presses the global push-to-talk chord **Ctrl+Alt+Space** (hold, or tap with VAD end), or uses the desktop push-to-talk button. Clients send `voice.session.open` and then `voice.listen.start`. A session is never opened at Host start, at UI start, or by any background path (V01).
2. **Capture.** The Host sends `capture.start {turn, gen}`. The worker's pre-checks run in order:
   - worker mute → `MUTED`
   - playback active → `BUSY_PLAYBACK` (half duplex)
   - Windows mic privacy deny → `PERMISSION_DENIED`
   - default endpoint muted → `ENDPOINT_MUTED`
   - `waveInOpen` failure → `DEVICE_UNAVAILABLE` / `DEVICE_BUSY`

   The Host reports `LISTENING` only after the worker's `capture.started`. Buffers are 20 ms, total audio is bounded by `maxMs` ≤ 30 s, and there is one capture at a time (V05, V06).
3. **VAD and endpointing.** An adaptive noise floor sets the onset threshold at `max(floor×3, 0.0006)` sustained for 120 ms. Inside speech, a frame also counts as silence when it is below 8% of the utterance's ~100 ms-smoothed speech peak (capped at 0.004, so one transient cannot end a turn). This was a live Part-B finding: room noise that rose after calibration held turns to the 30 s cap. Speech ends after ≥ 900 ms of silence **and** (SAPI fallback only) ≥ 700 ms with no new recognizer hypothesis, so natural pauses are not cut. Each turn records its `source`, `endpointing` and the worker's `captureStopReason` (`vad`, `end`, `max`, `abort`, `mute`). `no_speech` fires after 8 s only if the VAD saw no onset and the recognizer produced no evidence. Push-to-talk release (`capture.end`) always overrides.
4. **STT.** whisper.cpp v1.9.4 `ggml-base.en` runs in the worker through `bunny-whisper-shim.dll`, on raw frames. Interim decodes run every 1.2 s on the growing buffer and produce partials (`stt.partial`, display only, never acted on: V08). The final decode runs on capture end and yields one final per turn (`stt.final`, with confidence). Silence, noise, gate rejection and aborted decodes end in `stt.none` and never in a fabricated command (V11, V12). If the pinned runtime fails verification, the worker runs SAPI 5.4 dictation instead and the Host shows `sttNotice`. A `listen.start` that arrives while the previous turn is still TRANSCRIBING waits up to 8 s for that final, then starts its own turn. Past the bound it is refused with `BUSY_TRANSCRIBING`, never `DEVICE_BUSY`.
5. **Turn acceptance (Host).** Only the first final of the current turn and generation is accepted (V09, V10). Confidence gates apply:
   - below 0.15: "didn't catch that", nothing is routed;
   - agent controls and spoken confirmations need ≥ 0.40.
   
   The deterministic classifier then decides the turn kind. A leading interruption word (stop, wait, hold on, sorry, actually, no) is dropped only when a question follows it, so "Stop. What is the capital of France?" is a question and not an agent stop. This was a live Part-B finding. The change can only turn a control proposal into a question, never the reverse.
6. **Routing by kind.**
   - **chat.** `TaskManager.submit` runs with forced `{localOnly, offlineOnly}` through the existing BunnyRouter and T3 routing pipeline. `approveVoiceTurn` admits the Task only if it is waiting for approval, has no Mission, has a concrete model and passes `deviceMayLaunch` (a tool-free provider whose model is not remote or `:cloud`). It applies the DEV-01 tool-free pin, so no launch-time or recovery reroute can leave the route. Anything else stays on screen for approval (user decision, 2026-10-10).
   - **agent_status / verification / model / approvals / last mission.** Answers are built only from canonical AgentRuntime, MissionManager and TaskManager records. UNKNOWN stays "unknown".
   - **agent_control.** The target agent is resolved by exact id, with a clarification step when ambiguous. The Host creates a `VoiceProposal` bound to `{agentId, revision, hostEpoch, TTL 30 s}`. Pause can be confirmed by voice or on screen; Stop and Resume only on screen. Execution goes through the same `agentCommand` path as HTTP, and Bunny acknowledges only the canonical post-state.
   - **sensitive_refused, redirect_unsupported, open_ui, cancel.** These get a fixed refusal or acknowledgement text and no side effect beyond an optional `uiIntent`.
7. **Streaming response to speech.** Ollama token deltas reach the session through `manager.onTaskOutput` before the 300 ms coalescing buffer. The chunker releases the first clause early and then splits at sentence boundaries. The worker receives `speak {turn, gen, seq}` commands, synthesizes each chunk with SAPI and plays them strictly in `seq` order (V18). The `waveOut` handle stays open across the chunks of a turn.
8. **Barge-in.** `voice.listen.start` or `voice.interrupt` while PROCESSING or SPEAKING does the following:
   - increments `generation`;
   - sends `speak.cancel(gen)` (worker: `waveOutReset`, drops queued chunks, measures peak-meter silence);
   - stops **only the voice turn's own inference Task** (`manager.stop`);
   - drops stale chunks;
   - starts the new capture.

   Late worker events and late token deltas from the old generation are dropped and counted (V19–V22). Agent and Mission state is never touched (V29).
9. **Close.** `voice.session.close {source}` aborts capture, cancels speech, stops the voice inference Task and shuts down the worker. The OwnedProcessGroup is closed (job empty), so the OS releases every device handle (V25). Closing the Island window sends `voice.session.close` and nothing else (V45). The snapshot keeps `lastClose {source, at}`. The source is a client-declared label (`island_button`, `island_hands_free`, `island_exit`, `desktop_button`) sanitized to `[a-z_]{1,24}`. It is a diagnostic receipt, never authority.

## Process and trust boundaries

| Boundary | Enforcement |
|---|---|
| Who may drive voice | `voice.*` actions are workstation-only: they are absent from `DEVICE_RIGHTS`, so `assertDeviceAction` refuses paired devices before data is read (V38, V56). `viewFor` strips `snapshot.voice` for devices. |
| Degraded Host | `voice.state`, `voice.interrupt`, `voice.mute`, `voice.session.close` and `voice.control.cancel` are safe actions: stopping audio and releasing devices never waits on containment. `listen.start` and `text` are refused while the Host is degraded. |
| Worker binary | The sha256 must match `native/voice/bunny-voice-worker.json` (and the release manifest when present) before launch, else `WORKER_INTEGRITY`, and no process is started. The whisper shim, all 13 runtime DLLs, the model and the pin are verified before each spawn; an unlisted file in the runtime folder refuses whisper. |
| Worker lifetime | `OwnedProcessGroup`: suspended admission, job membership verified before resume, KILL_ON_JOB_CLOSE, no breakaway, no uncontained fallback. On Host death the job closes and the worker dies (F04 semantics). |
| Worker environment | An explicit allowlist of Windows system variables. Secrets (`*_API_KEY`, `*_TOKEN`, `ANTHROPIC_*`, `OPENAI_*`) never reach it. |
| Worker stdin budget | F04's 512 KiB cumulative interactive budget per group. The Host relaunches the worker while idle past 384 KiB; a hard breach ends the session truthfully. Audio never crosses stdin. |
| Audio data | PCM exists only inside the worker process memory, in bounded buffers. It is never written to disk, stdout, logs, events or evidence (V52). |
| Cloud egress | None. STT is whisper.cpp (in the worker, model on disk, no network); TTS is Windows SAPI, in process. The whisper artifacts were downloaded once, with user approval, and are sha-pinned. The voice chat route is forced `localOnly` and `offlineOnly`, and `:cloud` Ollama models are excluded (V16). |
| Journal | Coarse events only (`voice.session_opened/closed`, `voice.turn` kind, `voice.interrupted`, `voice.control_*`, `voice.error`). No transcript, answer text or audio (V52). |

## Clients

- **WPF Island (glass notch).** Supports top, bottom, left and right edges from one placement rule (`Get-BunnyPlacement`). Agent indicators sit left of a horizontal notch and on top of a vertical one (`Get-BunnyIndicatorLayout`). Voice state is polled off the UI thread every 200 ms while a session is open. "Listening" requires `capturing` plus a fresh poll (< 1 s); "Speaking" requires `playing`. The level meter is driven only by `snapshot.level`.
- **Desktop UI.** The browser Web Speech path is removed. The Host-backed `VoicePanel` offers push-to-talk (barge-in allowed while speaking), Interrupt, Mute, Hands-free (explicit opt-in), a typed fallback, proposal Confirm/Cancel and an honest privacy note.

## Modes

- **Push-to-talk (default).**
- **Hands-free (explicit opt-in).** The session re-arms listening 400 ms after playback drains. It is half duplex (no capture during playback, so no echo loop: V28), and after a 60 s idle timeout the microphone closes. **Acoustic barge-in while Bunny speaks is not supported**, because there is no AEC. Interruption is by push-to-talk, hotkey, button or mute. **No wake word.**
