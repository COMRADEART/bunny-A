# T12 acoustic echo cancellation: engine decision

## Selected

**Windows Voice Capture DSP (`CLSID_CWMAudioAEC`) in source mode, `SINGLE_CHANNEL_AEC`**, hosted inside the existing
F04-contained native voice worker (`native/voice/BunnyVoiceWorker.cs`, `AecSource`). Windows owns the capture endpoint,
the render-endpoint loopback reference, their clock alignment and sample-rate conversion; the worker reads 16 kHz mono
PCM16 echo-cancelled frames with `IMediaObject::ProcessOutput`.

## Why this engine

| Option | Assessment |
|---|---|
| Windows Voice Capture DSP (source mode) | In-box on Windows 11, no new native dependency or license, Windows performs the render-reference capture and capture/render synchronization (the hard part of AEC), reachable from the existing .NET Framework 4 csc toolchain through COM. **Selected.** |
| Endpoint APO "communications" processing | Device-dependent and not controllable or verifiable per stream from the worker; enabling it means changing Windows audio settings, which the user forbids. Rejected. |
| WebRTC AudioProcessing / AEC3 | Strong canceller, but requires a new pinned native build (C++ toolchain, BSD license review) and an application-maintained, delay-aligned render reference through the existing winmm output path. Larger risk and supply-chain surface for T12. Deferred, not needed after measurement. |
| Push-to-talk only (T10) | Not full duplex. Kept as the fallback. |

## Reference ownership

Synthesized speech → `waveOut` on the **default render endpoint** (the same endpoint the DSP's device-index property names)
→ Windows render loopback inside the DSP → echo-cancelled microphone stream. Speech is refused (`AEC_UNAVAILABLE`) if the
output index no longer identifies the reference endpoint (device reorder or default-device change), and the duplex lane
stops truthfully when either default endpoint changes. A keep-alive silence stream (3 rotating buffers) keeps the render
endpoint active so the reference never starves between replies.

## Real-device bring-up findings (all fixed, commit 4a0f5c5)

1. `IMMDeviceCollection` was declared with a wrong IID → `InvalidCastException` at duplex start.
2. `IMediaObject.ProcessOutput`'s buffer array was marshalled as a SAFEARRAY → `E_INVALIDARG`; now an `LPArray` sized by
   the count parameter.
3. The render-reference guard queried the endpoint id through an opened `HWAVEOUT`, which this driver does not answer →
   every keep-alive refill failed the guard; the guard now re-checks by device index (a reorder still refuses).
4. AEC setup failures now name the failing step and HRESULT.

None of these were visible to the fixture tests (which use `fixture:no-aec` and a null render sink); they are why a real
device run is required before any AEC claim.

## Measured effectiveness (Intel Smart Sound mic array + Realtek laptop speakers, volume 40%)

Evidence: `acoustic-echo-results.json`, `probes/human-doubletalk-levels-2.txt`, `probes/human-doubletalk-levels-3.txt`.

- Bunny speaking alone: the **raw** microphone lane (separate test worker, no AEC) carried the echo at 0.001–0.004 RMS and
  whisper transcribed Bunny's words from it; the **echo-cancelled** lane stayed at ~0 (p95 1.8e-5, max 8e-5 RMS) and
  produced **0 onsets, 0 partials, 0 finals**.
- Human double-talk over Bunny: the echo-cancelled lane carried the user at 0.003–0.016 RMS (comparable to raw), so the DSP
  is genuinely full duplex on this device, not a half-duplex gate.
- After calibrating the output-time residual floor to the measurement (0.002 → 0.0003), human barge-in onset was detected
  ~100 ms after speech began, at the same moment as the raw lane.

## Limits

- One device configuration measured (built-in array + built-in speakers). Headphones, Bluetooth and external speakers
  were not available: **NOT TESTED**.
- The DSP's AGC/noise suppression are left at Windows defaults; the ERLE ratio is an upper bound on pure cancellation.
- The monitor speaker (SD4780P) was too quiet at the laptop microphone to act as a synthetic second talker; those trials
  are recorded as inconclusive (`live/synthetic-doubletalk-1.json`), not as product evidence either way.
