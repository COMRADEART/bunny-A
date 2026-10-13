# M-A-3 T10 — Voice baseline audit (pre-implementation, HEAD `c06313f`)

**Method.** Seven parallel read-only code readers plus a completeness critic, followed by spot checks and a LIVE feasibility spike on this machine. Nothing in the repository was modified during the audit.

**Classification key:** WORKING · PARTIAL · PRESENT BUT UNVERIFIED · UNSUPPORTED · NOT INSTALLED

## Capability inventory

| # | Capability | Where | Classification | Evidence |
|---|---|---|---|---|
| 1 | Microphone interface (desktop UI) | `src/components/island/voice.tsx` `useVoiceInput` | PARTIAL | Uses the browser Web Speech API (`SpeechRecognition`, `continuous=false`, interim results). There is no `getUserMedia`, no `AudioContext`, no device selection and no level metering. |
| 2 | Microphone interface (native WPF Island) | `install/Bunny-Island.Motion.ps1:104` | UNSUPPORTED | It is a static panel: "Voice input unavailable … no speech-service attachment". |
| 3 | Push-to-talk | Island hold timer (`Motion.ps1:107`); `VoicePanel` copy | PARTIAL | The Island "hold" only opens the stub panel. The web copy says "Hold Bunny to speak. Release to finish.", but recognition ends by itself (`continuous=false`), so the copy is inaccurate. |
| 4 | Audio device detection and selection | — | UNSUPPORTED | There is no enumeration, default-device tracking or disconnect handling anywhere in `src/` or `install/`. |
| 5 | Speech recognition | Web Speech API in the browser tab | PRESENT BUT UNVERIFIED, and **non-compliant** | In Chrome/Edge this is a vendor cloud service: audio leaves the PC with no consent UI. It violates T10 §24 and is removed in T10. |
| 6 | Local speech recognition engine (Vosk, Whisper, etc.) | — | NOT INSTALLED | There are no Vosk, Whisper or Pocket TTS components in Bunny-A, despite other Bunny projects. |
| 7 | Windows SAPI recognizer | OS component | WORKING (LIVE spike) | `MS-1033-80-DESK` en-US, `DictationGrammar`. Streaming partials and finals worked on synthesized audio fed through a real-time paced stream: "bunny did the tests pass in my last mission", conf 0.72. Not used by Bunny before T10. |
| 8 | Text-to-speech | — | UNSUPPORTED in Bunny | There is no `speechSynthesis` or TTS anywhere. |
| 9 | Windows SAPI synthesizer | OS component | WORKING (LIVE spike) | David and Zira synthesize to a 16 kHz PCM memory stream. |
| 10 | Audio playback | — | UNSUPPORTED in Bunny | — |
| 11 | winmm waveIn/waveOut | OS component | WORKING (LIVE spike) | Enumeration works. `waveOutReset` silenced playback in 6.65 ms. Capture from the default microphone opened but returned silence because the endpoint is muted. |
| 12 | Barge-in / interruption | — | UNSUPPORTED | — |
| 13 | Conversation API | Host `submit` → Task → `approve` | PARTIAL for voice | There is no chat object or history store. Every prompt is a Task that waits for "Approve & Run" (`manager.server.ts:1000-1011`). codex/claude run with workspace-write tools; only Ollama is tool-free. |
| 14 | Provider streaming | `exec.server.ts` Ollama `/api/generate stream:true` | WORKING (code) | Only Ollama streams real token deltas (`hooks.output`). codex/claude deliver whole messages. Token text never reaches the Island (`presentation.ts:451` blanks the output). |
| 15 | Generation cancel | `stop` action → Ollama fetch abort | WORKING (code) | `manager.stop` aborts the fetch immediately. It is in `safeActions`. |
| 16 | AgentRuntime commands | `agent.pause/resume/stop {id, revision}` | WORKING (T4/T5/T9 evidence) | Stop is terminal. Names are not unique. There is no free-form Talk/Redirect. |
| 17 | Agent activity SSE | `GET /events` journal replay; `/api/bunny-events` bridge | WORKING | Sequence-keyed. The bridge forwards `{sequence}` only. |
| 18 | Bunny Bar native WPF | `install/Bunny-Island*.ps1` | WORKING (T8), with no voice and no edge placement | Primary-monitor WorkArea top with left/center/right presets; synchronous 2 s `/state` poll on the UI thread; no hotkeys; no DPI code. |
| 19 | Desktop UI | React tab served by the gateway on `127.0.0.1:8084` | WORKING | A browser tab, not WebView2. |
| 20 | Keyboard shortcuts | Island Ctrl+Enter / Escape (window-local) | WORKING | There are no global hotkeys. |
| 21 | Host authentication | Bearer token (workstation) / per-device token (paired) | WORKING | `DEVICE_RIGHTS` is default-deny. The gateway's `authorizeBridge` enforces loopback/relay rules. |
| 22 | Native Job Object launcher | `native/bunny-owned-process.c`, `OwnedProcessGroup` | WORKING (F04) | Interactive stdin is capped at **512 KiB cumulative per group**, so audio cannot ride stdin. |
| 23 | Packaged Windows dependencies | `scripts/package-bunny-desktop.ps1` | WORKING (F04 package) | The install file list is hard-coded. New `install/*.ps1` files must be added. |
| 24 | Wake word | — | NOT INSTALLED | — |
| 25 | Acoustic echo cancellation | — | NOT INSTALLED | — |

## Consequences for the design

- A real local engine exists with no downloads: SAPI recognizer and synthesizer plus winmm, all Windows components. This is chosen over installing Vosk or Whisper models (see `stt-engine-decision.md`).
- The browser Web Speech path must be removed (privacy §24, §35 "never silently select an unapproved cloud service").
- Audio must be owned by a Bunny-launched worker process under the F04 Job Object boundary. Audio stays inside the worker; only small JSON commands travel on stdin, which keeps the 512 KiB cumulative budget.
- Voice turns need an admission decision. The user decided on 2026-10-10 to auto-admit only local, tool-free Ollama generations routed by the existing T3 router under forced `localOnly`/`offlineOnly` constraints. Everything else goes to on-screen approval.
- Agent Talk/Redirect remains unsupported and is disclosed (§15 option B).
