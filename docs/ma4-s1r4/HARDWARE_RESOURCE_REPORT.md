# MA4-S1R4 — Hardware and resource report (Phase B1/B2, R4-G11)

## Measured inventory (2026-10-22)

| Resource | Value |
|---|---|
| CPU | Intel Core Ultra 9 185H, 16 cores / 22 threads |
| RAM | 31.6 GiB total; **10.7–11.8 GiB available** at rest (browser, IDE, agents, WSL VM resident) |
| GPU | NVIDIA RTX 4050 Laptop, 6 GiB VRAM (driver 616.92), idle 0 MiB used |
| NPU | Intel AI Boost — present (device OK); **NOT TESTED**: no NPU backend in Ollama 0.40.6 |
| Runtime | Ollama 0.40.6 (`llamacpp` runner), local only; WSL2 Ubuntu 24.04 (15 GiB VM limit) for the sandbox |

## Local models (`ollama list` / `ollama show`)

| Tag | Arch | Params | Quant | Disk | Context | Status |
|---|---|---|---|---|---|---|
| `qwen2.5-coder:7b` (`dae161e27b0e`) | qwen2 | 7.6B | Q4_K_M | 4.7 GB | 32k (run at 8k) | runnable: 24 % CPU / 76 % GPU split at 8k context (5.4 GB loaded) |
| `huihui_ai/qwen2.5-abliterate:7b` (`103482475c9b`) | qwen2 | 7.6B | Q4_K_M | 4.7 GB | 32k | runnable |
| `huihui_ai/qwen3-abliterated:30b` (`45838c4ad568`) | qwen3moe (30.5B, ~3B active) | 30.5B | Q4_K_M | 18 GB | 40k | **BLOCKED_RESOURCE_LIMIT** (measured) |
| `huihui_ai/Qwen3.8-abliterated:27b` (`bdc5e13cd164`) | qwen35 dense + vision projector | 27.3B | Q4_K_M | 17 GB | 262k | **BLOCKED_RESOURCE_LIMIT** (measured) |
| `deepseek-v4.1-flash:cloud` | — | — | — | — | — | refused: cloud-backed tag |

## Controlled large-model trials (`scripts/ma4-s1r4/load-probe.mjs`)

Procedure, one model at a time: measure available RAM and VRAM; one short prompt (`is_prime`), `num_ctx` 4096 (30B) /
2048 (27B), `num_predict` 256, temperature 0, thinking off; a watchdog samples available RAM every 250 ms and **aborts
the request and unloads the model below 3 GiB available**. No process was killed, no page-file, driver or model change,
nothing downloaded or converted.

| Model | Available before | Minimum during load | VRAM peak | Outcome |
|---|---|---|---|---|
| qwen3-abliterated:30b (MoE) | 10.81 GiB | **2.58 GiB** at 10.6 s | 3,423 MiB | aborted by guard → **BLOCKED_RESOURCE_LIMIT** |
| Qwen3.8-abliterated:27b (dense) | ≈ 11.5 GiB | **2.09 GiB** at 8.9 s | 2,023 MiB | aborted by guard → **BLOCKED_RESOURCE_LIMIT** |

After each abort the model was unloaded (`ollama ps` empty) and available RAM returned to 11.5 / 11.8 GiB.
Estimate: 18 GB of Q4 weights minus ≤ 5.5 GiB in VRAM leaves ≈ 12.5 GiB of host memory before KV cache, against ≈ 8 GiB
usable above a 3 GiB floor. Freeing ≈ 6 GiB (closing applications, or capping the WSL2 VM) would be needed — an owner
decision, not something S1R4 may do. Evidence: `evidence/load-probe-*.json`.

## Resource behaviour during S1R4 runs

* The runners refuse any model call when free RAM is below 2.5 GiB. During S1R4 this guard **fired** when the full
  regression suite ran concurrently with development runs (6 + 20 dev trials refused, no model ran for them). Those
  trials were re-run with nothing else running (`run-set.mjs --resume`, recorded in each file's `resumes`). Lesson:
  never overlap regression and inference on this host.
* Models are unloaded after every trial (Ollama 0.40.6 runner memory growth seen in S1R3).
* Throughput and latency per configuration: see ROUTING_BENCHMARKS / G7_FROZEN_RESULTS (per-call Ollama receipts).
