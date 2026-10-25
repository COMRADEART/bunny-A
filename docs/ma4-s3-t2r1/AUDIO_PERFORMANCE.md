# Audio performance

No spoken turn was taken, so these stages have no sample on this commit:

- VAD onset
- Endpointing delay
- Whisper final-transcript latency
- Host routing delay
- Model queue latency
- First model token
- First synthesized chunk
- First audible playback
- Interruption-to-silence
- Recovery after interruption

p50 and p95 are omitted. There are no failed samples to exclude, because no measurement run was started.

The only Whisper timings in this qualification are fixture decodes inside `scripts/voice-worker.test.mjs` (model load 177 ms; two synthesized phrases decoded in 1577 ms and 1095 ms after `speech_end`). Those numbers are worker fixture timings. They are not physical speech-response latency, and they are not used as p50 or p95.

No voice-path change was made. No bottleneck was proven on a live turn, so none was optimized.
