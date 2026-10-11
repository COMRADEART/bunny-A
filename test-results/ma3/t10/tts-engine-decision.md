# M-A-3 T10 — Text-to-speech engine decision

## Decision

**Selected: Windows SAPI 5.4 synthesizer (`System.Speech.Synthesis`), installed voices `Microsoft David Desktop` (default) and `Microsoft Zira Desktop`. Each synthesized chunk is rendered to 16 kHz/16-bit/mono PCM in memory and played by Bunny's own winmm `waveOut` player inside the contained voice worker.**

## Why render to PCM and play it ourselves

The worker does not use `SpeakAsync` to the default device. It owns the playback buffer queue, for these reasons:

- Barge-in becomes a single `waveOutReset`, which measured **6.65 ms** in the LIVE spike, plus dropping queued chunks. There is no dependence on SAPI's internal audio thread.
- Every chunk carries `(turn, gen, seq)`, so ordering is strict and stale chunks can never play (§19).
- The output device is chosen explicitly (winmm index). The worker never silently re-routes to another device (§23).
- Audible stop is measured with the render endpoint's peak meter (`IAudioMeterInformation`). This measures actual playback termination, not a UI flag (§21).

## Candidates evaluated

| Criterion (§17) | SAPI (selected) | OneCore / WinRT `SpeechSynthesizer` | Piper / Kokoro / Pocket TTS | Browser `speechSynthesis` | Hosted TTS |
|---|---|---|---|---|---|
| Present | **Yes** (LIVE) | Yes (David/Mark/Zira OneCore) | **No**: download needed; Pocket TTS is not in Bunny-A | Yes (tab) | No |
| Natural and intelligible | Intelligible, robotic | Somewhat better | Best | Varies; may be online voices | Best |
| Incremental | Per chunk (sentence) | Per chunk | Per chunk | Per utterance | Streaming |
| Startup latency | Low (in-process) | Low | Model load | Low | Network |
| Cancellation | Our `waveOutReset` | Ours, if rendered to a stream | Ours | `cancel()`, limited | — |
| Offline and private | **Yes** | Yes | Yes | Some voices are cloud | **No** |
| Callable from .NET Framework 4 without WinRT projection | **Yes** | Needs WinRT interop | Separate runtime | — | — |

OneCore voices are a reasonable follow-up. They are not used in T10 because WinRT interop from a C# 5 / .NET Framework 4 worker adds risk without changing the architecture.

## Limitations

- SAPI desktop voices sound noticeably synthetic. "Natural" quality is limited by the selected offline engine.
- Pronunciation is stable but not customizable in T10 (no lexicon).
- The only voices offered are the installed ones (David, Zira). No voice is downloaded.
