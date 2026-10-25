# Baseline benchmarks

No pre-T1 latency corpus was captured on this head before the router change. The 15% median latency target for C0/C1 is therefore **not claimed**.

What was measured on the old behavior, by executing the unchanged branch of the router:

| Case | Model chosen |
| --- | --- |
| Local-only, current model `huihui_ai/qwen2.5-abliterate:7b`, both 7B tags installed, no preference | `huihui_ai/qwen2.5-abliterate:7b` |

That is the T0R1 discrepancy, reproduced in `ma4-s3-t1.test.ts`.

Call-count baseline for a four-role coding team is 4 model roles. The new classes use 1, 0, 2, and 3 model calls. Those counts are strategy counts, not traces from a live agent session.

Hardware baseline for one prompt is in `REAL_HARDWARE_RESULTS.md`. Cold 7383 ms and warm 356 ms are candidate measurements without a paired old-build run.
