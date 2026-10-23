# MA4-S1R2 hardware qualification

Measured 2026-10-21 on the workstation (read-only queries; no driver, runtime, power or service change).

| Resource | Measured |
|---|---|
| CPU | Intel Core Ultra 9 185H, 16 cores / 22 threads |
| RAM | 31.6 GiB total; **8.6 GiB free** with normal desktop load (Chrome, Claude, Defender, WSL VM 0.9 GiB); commit limit 58.6 GiB |
| GPU | NVIDIA GeForce RTX 4050 Laptop, 6,141 MiB VRAM, driver 616.92 |
| NPU | Intel AI Boost present (`Status OK` in PnP) |
| Runtime | Ollama 0.40.6 (`llama-server` backend), CUDA partial offload |
| Sandbox VM | WSL2 Ubuntu 24.04, kernel 6.18.33.2 (≈0.9 GiB resident while in use) |

## Local model inventory (`/api/tags`, `/api/show`, re-inspected)

| Tag | Digest (prefix) | Size | Params / quant | Arch | Context | Capabilities | Local? |
|---|---|---|---|---|---|---|---|
| `qwen2.5-coder:7b` | `dae161e27b0e` | 4.68 GB | 7.6B Q4_K_M | qwen2 | 32,768 | completion, tools, insert | yes |
| `huihui_ai/qwen2.5-abliterate:7b` | `103482475c9b` | 4.68 GB | 7.6B Q4_K_M | qwen2 | 32,768 | completion, tools | yes |
| `huihui_ai/Qwen3.8-abliterated:27b` | `bdc5e13cd164` | 17.74 GB | 27.3B Q4_K_M | qwen35 (dense) | 262,144 | completion, vision, tools, thinking | yes |
| `huihui_ai/qwen3-abliterated:30b` | `45838c4ad568` | 18.56 GB | 30.5B Q4_K_M | qwen3moe, 128 experts / 8 active | 40,960 | tools, thinking, completion | yes |
| `deepseek-v4.1-flash:cloud` | `e04da138d31e` | 0 B | 763B FP8 | — | — | — | **NO — `remote_host https://ollama.com`**; refused by every harness and by `execute()` for local-only work |

## Placement and throughput (benchmark receipts)

Both 7B models loaded at num_ctx 4096 with **81.5% of the 5.15 GB footprint in VRAM** (`/api/ps size_vram`), i.e. partial CUDA offload. Observed generation 29–42 tokens/s (`eval_count / eval_duration`), consistent with S1R's 30.76 tokens/s partial-offload measurement. GPU utilization sampled per request is recorded in `evidence/bench-dev.json`.

## 27B / 30B: BLOCKED by measured headroom (not loaded)

A Q4_K_M 27B/30B needs ≈17.7–18.6 GB of weights plus KV cache. Measured headroom is ≈8.6 GiB free RAM + <6 GiB VRAM ≈ 14.6 GiB, below the weight size alone. Loading would force paging, which the brief forbids, so no load was attempted. The 30B is a mixture-of-experts model (≈3B active parameters), so it could run at usable speed with partial offload **if** about 20 GiB of RAM were free.

**Owner decision needed:** free about 12 GiB of RAM (close large applications) for a bounded, monitored 30B trial, or approve a cloud model. Nothing was downloaded, and no runtime setting was changed.

## NPU

Intel AI Boost is detected, but Ollama 0.40.6 has no NPU backend here, and no OpenVINO inference path is wired into Bunny. NPU inference: **NOT TESTED**. Enabling it would need new runtime components, which require approval.

## Not established

Thermal endurance, long-run throughput stability, all-GPU placement, and concurrent multi-model residency.
