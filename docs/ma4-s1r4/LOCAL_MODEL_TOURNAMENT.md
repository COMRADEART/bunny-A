# MA4-S1R4 — Local model intelligence tournament (Phase B, R4-G3)

## Field

| Model | Digest | Backend | Quant | Status |
|---|---|---|---|---|
| `qwen2.5-coder:7b` | `dae161e27b0e` | Ollama 0.40.6 llamacpp, CUDA partial offload (81.5 % of weights in VRAM at 4k ctx; 76 % at 8k) | Q4_K_M | tested |
| `huihui_ai/qwen2.5-abliterate:7b` | `103482475c9b` | same | Q4_K_M | tested |
| `huihui_ai/qwen3-abliterated:30b` | `45838c4ad568` | — | Q4_K_M | BLOCKED_RESOURCE_LIMIT (HARDWARE_RESOURCE_REPORT) |
| `huihui_ai/Qwen3.8-abliterated:27b` | `bdc5e13cd164` | — | Q4_K_M | BLOCKED_RESOURCE_LIMIT |
| `deepseek-v4.1-flash:cloud` | — | — | — | refused (cloud-backed) |
| Intel AI Boost NPU | — | no Ollama backend | — | NOT TESTED |

## Part 1 — frozen capability suite (S1R2 `bench-tasks.mjs`, unchanged; temperature 0.2, 4k ctx, fixed seeds)

`scripts/ma4-s1r2/benchmarks.mjs --split dev|heldout`; task hash `219381cc3912…` (same suite as S1R2/S1R3).
Development split: 3 samples × 2 tasks per category; held-out: 3 samples × 1 task.

| Category | coder dev | abliterate dev | coder held-out | abliterate held-out |
|---|---|---|---|---|
| 1 coding (programming) | 3/6 | 4/6 | 3/3 | 3/3 |
| 2 planning | 6/6 | 6/6 | 3/3 | 3/3 |
| 4 debugging | 6/6 | 6/6 | 3/3 | 3/3 |
| 5 code-review defect detection | 3/6 | 3/6 | 3/3 | 3/3 |
| 6 mathematics | 0/6 | 0/6 | **3/3** | **0/3** |
| 7 structured output (json-schema) | 6/6 | 6/6 | 3/3 | 3/3 |
| 8 tool calls (native, frozen suite) | 0/6 | 0/6 | 0/3 | 0/3 |
| 9 multi-agent handoffs | 3/6 | 3/6 | 3/3 | 3/3 |
| 10 instruction adherence | 0/6 | 0/6 | 3/3 | 3/3 |
| **Total** | **27/54** | **28/54** | **24/27** | **21/27** |

**Reproducibility:** the development split matches S1R3 `bench-dev-repro.json` **exactly, per category, for both
models** (27/54 and 28/54). Served model = pin on every sample; 0 timeouts; 0 external requests.

| Performance (frozen suite) | coder | abliterate |
|---|---|---|
| Median / P95 latency, dev | 1.17 s / 3.26 s | 0.92 s / 3.73 s |
| Median / P95 latency, held-out | 0.95 s / 4.84 s | 0.46 s / 5.66 s |
| Throughput (median eval tok/s) | 28.8–28.9 | 28.8–30.7 |
| Loaded size / VRAM | 5.15 GB / 4.2 GB (≈ 4.1 GiB VRAM peak) | same |

## Part 2 — test generation, repair and roles inside the agent workflow (category 3 and roles)

Development set `dev-tasks.mjs` (10 tasks × 2 trials, disjoint from G7), S1R4 strategy v3b, same sandbox and runner:

| Measure | coder (all roles) | abliterate (all roles) |
|---|---|---|
| Final verified correctness | 11/20 | 12/20 |
| First-attempt success | 9/20 | 9/20 |
| Repair success (rounds resolved) | 4/24 | 3/23 |
| Worker: final code passes independent acceptance | 13/20 | 13/20 |
| Tester: no Tester fault attributed (Python test generation) | 15/19 | 16/20 |
| Planner: no contract fault | 20/20 | 20/20 |
| Reviewer: verdict agrees with the gate | 18/20 | 14/20 (6 false approvals, blocked) |
| Median / P95 call latency | 18.3 s / 61 s | 12.0 s / 39.7 s |
| Timeouts | 0 | 0 |

Native tool calling (S1R3 probe, unchanged): abliterate 6/6, coder 0/6. In the frozen suite's tool-call tasks both
models score 0 (they answer in prose or as JSON text), so neither model is qualified for model-native tool execution.

## Conclusions

* No local model is qualified for unattended coding: both 7B models land at 55–60 % on the development workflow and
  the frozen suite reproduces S1R3 exactly. The two 7B models are statistically indistinguishable on coding.
* The tournament was not tuned against G7: G7 tasks were never used for development, selection or prompts.
