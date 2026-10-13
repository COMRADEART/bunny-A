# M-A-3 T13.1 routing evaluation

Generated 2026-10-13T04:53:35.116Z at source `aa134f5efb6748f21ec9a5fe4eae83f4c2d8d86f`. Labelled set: 32 author-labelled prompts across 8 task classes (agreement with these labels only).

| System | Category | Task-class accuracy | Latency P50 | Latency P95 | Calibration (ECE) |
| --- | --- | --- | --- | --- | --- |
| BunnyRouter (deterministic) | LIVE VERIFIED (code) | 68.8% (22/32) | 0.005 ms | 0.385 ms | not applicable (no probabilities) |
| Local model qwen2.5-coder:7b | LIVE VERIFIED | 78.1% (25/32) | 341 ms | 461 ms | not applicable (no probabilities) |
| Laya | NOT TESTED | n/a | n/a | n/a | n/a |
| TypeSafe Jev | NOT TESTED | n/a | n/a | n/a | n/a |
| Router + hosted advice | NOT TESTED live | n/a | n/a | n/a | n/a |

Local model cold start: 5592 ms; unparsed answers: 0.

## Laya

- Discovery: LIVE VERIFIED against Ollama on 127.0.0.1:11434. Installed models: deepseek-v4.1-flash:cloud, huihui_ai/qwen2.5-abliterate:7b, huihui_ai/qwen3-abliterated:30b, huihui_ai/Qwen3.8-abliterated:27b, qwen2.5-coder:7b.
- Laya status: **missing**. No Laya model is installed in the local runtime. Bunny keeps routing with the other models.
- Laya inference: NOT TESTED (no Laya model is installed on this Host).
- Benchmark pipeline exercised against stand-in `qwen2.5-coder:7b` (LIVE VERIFIED (pipeline only, not Laya)); runtime-reported digest `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`. A class passes only when every check matches:
  - general: passed (2 of 2 checks), mean 497 ms per check
  - math: failed (0 of 2 checks), mean 375 ms per check
  - extraction: passed (2 of 2 checks), mean 502 ms per check
  - reasoning: passed (2 of 2 checks), mean 395 ms per check

## Hosted advice safety (SIMULATED)

5000 injected recommendations (random keys including out-of-set and injection strings, random confidence, stale generations and ages):

- Outcomes: accept 265, fallback 1076, clarify 323, rejected 2764, router 572.
- False eligibility (final route outside the eligible set): **0**.
- Routes widened to hosted or tool-capable: **0**.
- Fallback to BunnyRouter's choice: 94.7%.
- Mean validation cost: 1.83 µs per decision.

These numbers check BunnyRouter's guard, not TypeSafe's decision quality.
