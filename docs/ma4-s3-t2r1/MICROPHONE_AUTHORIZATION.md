# Microphone authorization

Date: 2026-10-25. Enumeration only. Capture was not opened.

| Check | Result |
| --- | --- |
| Windows microphone consent (`ConsentStore\microphone`) | `Allow` |
| Non-packaged desktop consent | `Allow` |
| Probe | `scripts/ma4-s3-t2-voice-probe.mjs` without `--acoustic` |
| Worker STT | `whisper.cpp v1.9.4` |
| Worker TTS | Windows SAPI 5.4 System.Speech |
| Duplex capability flag | `supported: true`, backend `Windows Voice Capture DSP/source` |
| Default input | Microphone Array (Intel Smart Sound Technology for Digital Microphones) |
| Input present | true |
| Input muted | **true** |
| Default output | Speakers (Realtek Audio) |
| Output muted | false |
| `duplex.start` | not called |
| Raw audio saved | none |

The capability flag is not a capture. The mute state was read and left unchanged. This session does not contain an explicit authorization to open the microphone, and the endpoint is muted. Physical capture stays closed until both are true: the endpoint is unmuted by hand, and the operator says the acoustic test is authorized.

Live-microphone indication was not shown, because no session opened the device.
