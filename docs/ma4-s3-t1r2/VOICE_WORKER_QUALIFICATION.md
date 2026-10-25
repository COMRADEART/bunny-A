# Voice-worker qualification

The approved runtime is whisper.cpp `v1.9.4`, commit `927cfce34f31707e17f2bff35c349632fb9e2c3a`, release tag `b5130`.

| Artifact | SHA-256 |
| --- | --- |
| `whisper-bin-x64.zip` | `f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c` |
| `whisper.cpp-v1.9.4.tar.gz` | `57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae` |
| `ggml-base.en.bin` | `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002` |

Those three files were already on this machine from an earlier operator fetch. `scripts/stage-whisper.mjs` checked them and every pinned DLL. Nothing was downloaded.

The shim compile failed closed until `ggml-cpu.h` and `ggml-alloc.h` were added to the pin. Both were copied from the already verified source tree and `stage-whisper.mjs` checked them against the tarball. The shim was then built with the local gcc against the staged `whisper.dll`, `ggml.dll`, and `ggml-base.dll`. The build record hash is `cd80c5aa825e1bbc46c1a79037fffdbdaff3195c815ec4517cf145f4bbf17213`. The source hash comparison now uses the same newline normalization as the C# worker record, so a Windows checkout matches the LF blob.

`node --test --test-concurrency=1 scripts/voice-worker.test.mjs` finished with 76 pass, 0 fail, 0 skip, in 85.9 s.

| Check | Result |
| --- | --- |
| Startup | ready event, engine `whisper.cpp v1.9.4`, recognizer `ggml-base.en`, local true, model load 711 ms |
| Recognition | two synthesized phrases, confidence 0.954 and 0.941, key words present, no partial after the final |
| Silence and noise | no final |
| Cancellation | `capture.abort` during the final decode emitted no final |
| Cleanup | existing shutdown test `V25` still exits 0 within 2 s with an active capture |
| Runtime unavailable | a missing model reports `STT_UNAVAILABLE` and falls back to Windows SAPI |
| Microphone denied | no live microphone is opened; out-of-range device index remains `DEVICE_UNAVAILABLE` |

Full-duplex voice was not added. Gate T1R2-G3 is **PASS** for this staged runtime.
