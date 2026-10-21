# Hardware qualification

Base: `f5d3f90`. Environment and commands: `evidence/system.json`, `additional-runtimes.json`, `hardware.json`, `hardware-controlled.json`.

Windows 11 Pro 64-bit, build 10.0.26300; Node v24.18.0; npm 11.16.0; Python 3.12. Intel Core Ultra 9 185H, 16 reported cores and 22 logical processors; 31.61 GiB visible system memory. Initial and during-run available memory are recorded, not inferred from weight file sizes. NVIDIA GeForce RTX 4050 Laptop GPU: 6,141 MiB VRAM by `nvidia-smi`, driver 616.92. WMI reports a truncated approximately 4-GB adapter-memory value; the NVIDIA query is used for VRAM capacity. Intel Arc iGPU and Intel AI Boost NPU are also detected.

## Measured execution

Reproduce the additional short device experiment only on an idle runtime: `node scripts/ma4-s1r/hardware.mjs`. Sequential CPU runs precede default-backend and limited simultaneous requests. No drivers, services, system limits or GPU configuration changed. `num_gpu:0` is a per-request runtime option.

| Controlled coder trial | Output tokens | Wall latency ms | Load ms | Generation tokens/s |
|---|---:|---:|---:|---:|
| Forced CPU | 24 | 8565 | 4884.43 | 8.95 |
| Default backend | 24 | 6717 | 5799.09 | 30.76 |
| concurrent A | 24 | 871 | 8.71 | 30.27 |
| concurrent B | 24 | 1695 | 8.57 | 29.74 |

CPU `/api/ps` reports `size_vram:0`. The default-backend run reports 4226704997 bytes in VRAM with the llama.cpp runner. `ollama ps` reported partial CPU/GPU offload (16%/84%), rather than an all-GPU execution. Concurrent NVIDIA memory/utilization observations and actual throughput corroborate GPU activity; detection alone is not the evidence. Peak observed NVIDIA allocation across the instrumented measurements: 4129 MiB. This does not isolate every byte to the model or prove every layer ran on GPU.

Two simultaneous client requests were allowed only with more than 6 GiB free RAM after loading the small model. Their client intervals overlap; response timings suggest runtime serialization. This is bounded request contention, not proof of two parallel model executions or multi-model concurrency. Minimum free RAM during this short controlled trace: 8.15 GiB. Both traces finish with models unloaded. No uncontrolled swapping or system instability was observed; page-fault/swapping counters were NOT TESTED.

Intel AI Boost is exposed by existing OpenVINO 2026.3.1-22476-759c5a6ab8c-releases/2026/3; OpenVINO device enumeration and a working NPU model pipeline are different claims. **NPU inference: NOT TESTED / unqualified for Bunny/Ollama.** Existing PyTorch 2.5.1+cu121 reports CUDA available, but PyTorch was not used to run these models. No model conversion/download or alternate inference framework was introduced.

Resource metrics are sampled whole-system snapshots. Peak process-attributed Ollama working set and long-running thermal/power behavior remain NOT TESTED. The 27B/30B models, full advertised context, and unrestricted production hardware admission remain SKIPPED or unqualified.
