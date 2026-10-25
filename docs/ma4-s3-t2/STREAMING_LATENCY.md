# Streaming latency

## Path

Microphone → Windows AEC (duplex only) → VAD → recognizer → Host intent → local model or Host facts → `VoiceChunker` → TTS → speaker.

Host-fact answers skip the model. The chunker can release a first chunk before the model finishes (`FIRST_MIN_CHUNK`, and a timed word boundary on the first chunk). Tool-claim sentences are replaced before they are spoken. A generation change drops late chunks.

## Stamps

`voiceStageTrace` reads stamps the session already stores. A missing or reversed pair is null. It does not fill a gap with a guess.

Registered budgets, fixed before measurement:

| Budget | ms |
| --- | --- |
| activation → first audio | 400 |
| speech end → final | 1500 |
| final → admitted | 100 |
| interrupt → silence | 250 |

No spoken turn was captured on this head, so there is no p50 or p95 for this commit. The muted input endpoint stopped the acoustic probe before a turn existed. Historical T12 warm model answers (speech end to first audio, about 11 s median under agent load) are not remeasured and are not claimed as improved.

The code change on this path is the timeout sentence. At 60 s the session stops waiting and asks the model task to stop. The spoken line says the stop is not confirmed.
