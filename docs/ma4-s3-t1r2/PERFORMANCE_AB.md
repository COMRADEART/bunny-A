# Performance comparison

Both sides used the same machine, Ollama 0.40.9, and `huihui_ai/qwen2.5-abliterate:7b` digest `103482475c9b4d4032999dd5d7383478cad8b966ae6ae984d525daf7352c2219`. The fixture, local-only constraint, and onboarding preference matched. Each side ran 15 C0 prompts, 3 trials, after `keep_alive: 0`. One warm prompt is not the comparison.

The predecessor is `bc1c82df8f765e39b1bbb64191a08f3e09f00d95`. The T1 numbers are from the merged Host in `evidence/live.json`. The predecessor numbers are from `evidence/followup.json`. The predecessor run does not record queue time, token counts, or load duration.

| | T1 merged Host | Predecessor `bc1c82d` |
| --- | --- | --- |
| Functional C0 | 45/45 | 45/45 |
| Selected model | pinned 7B on every row | pinned 7B on every row |
| Cold end-to-end | 14,093 ms | 7,902 ms |
| Cold load time | 12,760 ms (`loadNs` 12759773900) | not recorded |
| Warm samples | 44 | 44 |
| Warm median | 1,095 ms | 1,273 ms |
| Warm p95 | 1,269 ms | 1,457 ms |
| Warm range | 909–1,294 ms | 981–1,479 ms |
| Median prompt tokens | 43 | not recorded |
| Median output tokens | 3 | not recorded |
| Median queue wait | 112 ms (p95 129 ms) | not recorded |

Warm median moved from 1,273 ms to 1,095 ms, a reduction of 178 ms, which is 14.0% of the predecessor median. The 15% bar on that median is 1,082 ms. This run is 13 ms short of it. The T1 cold start is slower than the predecessor cold start, mostly in model load. The two runs were sequential, not interleaved, so the difference includes machine state as well as the build.

C1 was measured only on the T1 Host: 15/15 hash-verified reads, no model call, median 62 ms. The predecessor comparison did not repeat that tool path, so there is no C1 latency delta.

The 15% median reduction for equivalent successful C0 and C1 work is not shown. Gate T1R2-G7 is **PARTIAL**.
