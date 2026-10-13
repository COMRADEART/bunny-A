# M-A-3 T10 — Limitations (disclosed, not hidden)

## Voice capability

1. **Barge-in is by push-to-talk, hotkey, button, mute or close, not acoustic.** The path is half duplex and has no acoustic echo cancellation, so talking over Bunny while it speaks does nothing unless the user also presses. Live evidence:
   - spoken barge-in by hotkey: audible silence 99 ms;
   - 10-scenario matrix: p95 109 ms.
2. **There is no wake word.** Activation is always explicit: the mic button, Ctrl+Alt+Space, or the desktop push-to-talk control. Hands-free mode is opt-in, re-arms only after playback drains, and closes the microphone after 60 s idle.
3. **English only.** STT is whisper.cpp `ggml-base.en`; TTS is the installed SAPI en-US voice.
4. **Interim partials are weaker than finals.** For example, "Did the desk" became "Did the test pass?" in the final. Partials are display-only and never acted on.
5. **Energy endpointing has a limit (review R4 T10-VAD-2).** A turn ends automatically only when the speaker's peak is at least about 12× the room noise. Otherwise it ends on hotkey or mic release, a second tap, or the 30 s cap. Live, turn 1 ended by voice activity; the user held the hotkey for the other turns.
6. **Cold model start.** The first answer from a cold local 7B model took 10.3 s to its first token. A warm turn took 0.68 s.
7. **Voice chat is local and tool-free only, by the user's 2026-10-10 decision.** Anything else (cloud models, tools, missions) is left on screen for approval, not admitted by voice.
8. **Agent Talk/Redirect is explicitly unavailable.** A free-form redirect of a running agent is answered "not supported yet" (V41, option B). Pause, Resume and Stop are supported:
   - Stop and Resume require on-screen confirmation;
   - Pause may also be confirmed by voice.
9. **Classifier residuals.**
   - Approve-synonym questions ("is it okay to accept it?", with or without a lead word such as "Stop, …") are classified as tool-free chat. They grant nothing.
   - The canonical agent pause and stop paths do not re-check revision themselves. Voice re-checks it one tick earlier.
10. **The local model is chosen by the existing router.** The T3 router picked the user's locally installed `huihui_ai/qwen2.5-abliterate:7b` for voice chat. T10 does not curate the user's models.

## Not tested

- **Physical phone: NOT TESTED.** Voice actions are workstation-only. Device refusal is covered deterministically (V38, V56), not live on a phone.
- **Secondary monitors, mixed DPI and multi-monitor notch placement: NOT TESTED.** Only the primary monitor at its current scale was tested.
- **Device hot-unplug during live capture or playback (V26, V27)** is covered deterministically with simulated device-loss events (Host and UI), not by physically unplugging the hardware.
- **Packaged gateway on port 8084: NOT TESTED.** Installed production owns that port. The packaged Host and the packaged voice worker were verified on a disposable port.
- **The X53 10-run stability harness was not repeated.** X53 ran once inside the full regression. T10 changes no process-launch, UIA or calculator path.

## Preserved F04 limitations (verbatim scope from `MA3_T9R_F04_PROVIDER_PROCESS_CONTAINMENT.md`)

The F04 Windows Job Object containment limits still apply unchanged to the voice worker. It runs under the same OwnedProcessGroup contract:
- same-user tampering with binaries is outside the contract;
- the interactive stdin budget is 512 KiB per job group (the voice Host relaunches the worker while idle past 384 KiB);
- breakaway is disallowed;
- there is no uncontained fallback.

## Environment notes

- The whisper.cpp runtime (zip `b5130` / `v1.9.4`) and the `ggml-base.en` model were downloaded once, with explicit user approval, and are sha256-pinned in `native/voice/whisper-pin.json`. They are gitignored, staged under `native/voice/vendor/`, and copied into the test package.
- The Windows microphone was muted when the gate started. The user unmuted it for each live session. Bunny never changed any Windows audio setting.
