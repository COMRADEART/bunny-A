# MA4-S3-T2 baseline and architecture

Branch `ma4-s3-t2-realtime-voice` starts at `f429037c2f1523789a7341ffceee0aa6693a1e55`, the merge of PR #42 (`ma4-s3-t1r3-production-closure`) into `main`. PR #42 was MERGED at 2026-10-25T20:21:20Z. Its own checks were SUCCESS (runs 40227862737 and 40227847847). The post-merge `main` run 40230372194 later completed SUCCESS at `f429037`.

No second Host, scheduler, authorization system, or agent runtime was added. Voice remains a modality on the existing Host session.

## What already existed

The MA3-T12 voice path is still the implementation:

- `src/lib/bunny-host/voice/voice-protocol.ts` — commands, events, grant limits, timing stamps, barge-in receipts.
- `voice-session.server.ts` — one worker, input-turn ids, output generations, hands-free grant, fragment wait, Host-fact answers, proposal path.
- `voice-worker.server.ts` and `native/voice/BunnyVoiceWorker.cs` — contained worker, separate capture and playback, Windows Voice Capture DSP for duplex.
- `voice-turn-taking.ts` — pause, resume, interrupt, accept, drop. Energy alone does not interrupt.
- `voice-fsm.ts` — illegal transitions are refused.
- `voice-chunker.ts` — first speakable chunk can leave before the model finishes.
- `voice-intent.ts` — speech stop is not an agent stop. Approvals stay on the Host screen.
- `src/components/island/voice.tsx` and `install/Bunny-Island.Voice.ps1` — clients render Host snapshots. They do not open the microphone themselves.
- `native/voice/whisper-pin.json` — the pinned whisper.cpp runtime. It was not staged on this machine for the device probe (the worker reported Windows SAPI).

`duplex.start` and the Start hands-free control are not, by themselves, a physical full-duplex result.

## Evidence classes

| Behavior | Implemented | Unit-tested | Native-worker fixture | Installed Windows | Physical acoustic | Android |
| --- | --- | --- | --- | --- | --- | --- |
| Explicit hands-free grant, expiry, mute does not reopen | Yes | Yes | Fixture duplex | Not re-run on this head | Not opened: default mic endpoint was muted | No capture permission |
| Capture while playback runs | Yes, separate lanes | Session tests with a fake worker | Yes, `--input-silence` / null sink, 2026-10-25 | Not this head | Not tested | No |
| AEC required for duplex; raw capture refused when AEC fails | Yes | Yes | Worker reports `AEC_UNAVAILABLE` paths | Not this head | Worker `ready.duplex.supported` was true. DSP effect was not measured | No |
| Backchannel does not take the turn | Yes | Yes | Not a human trial | Historical T12 only | Not this head | No |
| Interrupt phrase / sustained speech cancels playback | Yes | Yes | Fixture pause/cancel | Historical T12 only | Not this head | No |
| Unfinished fragment wait | Yes | Yes | No | Historical, unit-only at T12 close | Not this head | No |
| Streaming chunks before full completion | Yes | Chunker tests | Fixture speak | Historical | Not this head | No |
| Status answers from Host facts | Yes | Yes | No | Not this head | Not this head | Phone can show Host UI; it does not run the worker |
| Notch voice words | Extended this milestone | Yes | n/a | Not walked in the installed Island | n/a | Web UI only if the phone loads it |

## Known limits carried forward

One previously measured laptop configuration does not become a new acoustic pass. Whisper was not staged here. Bluetooth, headphones, USB microphones, and hot-unplug were not exercised. Android has no voice adapter. Public beta stays NO-GO.
