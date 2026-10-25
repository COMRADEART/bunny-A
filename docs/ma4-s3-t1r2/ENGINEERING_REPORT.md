# Engineering report

Bunny A is not shown to be ready for MA4-S3-T2, and it is not shown to be 15% faster than `bc1c82d` on equivalent successful work. Public beta stays NO-GO.

## What was measured

The worktree started at merge `51217cbe7c4981ee66f3999f7234b5fcabb83dd4`, which has the same tree as PR #40 head `ba4fdca`. Qualification used Ollama 0.40.9 and `huihui_ai/qwen2.5-abliterate:7b` digest `103482475c9b4d4032999dd5d7383478cad8b966ae6ae984d525daf7352c2219` on the Lenovo 83DN described in `BASELINE.md`.

C0 chat on that model was functionally right on all 45 trials. Four answers added a period, so exact formatting is 11/15. Warm median was 1,095 ms against the predecessor’s 1,273 ms on the same 15 prompts and 3 trials. That is 14.0%. The predecessor cold start was 7,902 ms and the T1 cold start was 14,093 ms, of which 12,760 ms was model load. C1 file reads were 15/15 and made no model call; they were not repeated on the predecessor.

Host Stop issued while a generate was `running` settled to `stopped` in 1,390 ms and the output did not grow. A foreground chat during that window completed. The earlier overlap window, where the long job was still running, took 31,557 ms for a short foreground answer. GPU preemption is not claimed. One sample showed 210 MiB on the RTX 4050. A later sample showed 4305 MiB used and Ollama `size_vram` 4,201,329,459.

## Repairs in this branch

Three demonstrated defects were repaired. Nothing else in the architecture was redesigned.

- “What HTTP status code means Not Found?” was classified as a tool request because the pattern treated the word `status` as a tool. The pattern no longer treats `status code` that way. Planning on the frozen set is 55/55. `classifyTask` is still not called from the live chat submit path.
- The Whisper pin omitted `ggml-cpu.h` and `ggml-alloc.h`, which the pinned `whisper.h` includes. Both were copied from the already verified source tree and checked against the pinned tarball. No binary was downloaded.
- The voice-worker source check compared raw bytes with a record that stores newline-normalized hashes, so a Windows checkout failed. The test now uses the same normalization as the build record. The suite then passed 76/76.

## What stays open

- The 15% median target is not met.
- Model receipts name the served model and do not carry the digest.
- `onboarding.save` of an unknown model stores null. Fail-closed behavior required a preference that was already stored.
- `C3-10` produced `DROP TABLE users` as generate text. No tool ran, and the receipt was not verified.
- The Windows package was not built. The packager stopped because this machine has no Node `LICENSE` beside `node.exe` and no fallback copy in the repo.
- Hosted CI for this branch has not run.

MA4-S3-T2, real-time full-duplex voice, is not started.
