# MA4-S3-T4R1 Real Hardware Resource Telemetry

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R1  
**Hardware Platform:** NVIDIA GeForce RTX 4050 Laptop GPU  
**Total Dedicated VRAM:** 6,141 MiB (6,439,305,216 bytes)  
**Host System RAM:** 32.0 GiB Physical  

---

## 1. Measured Physical Telemetry Summary

All observations were sampled in real time via live `nvidia-smi` subprocess calls during active model loading and host workflow execution across all 120 task runs:

| Resource Metric | Measured Value | Unit | Observation Method |
| :--- | :---: | :---: | :--- |
| **GPU Dedicated VRAM Total** | 6,141 | MiB | `nvidia-smi --query-gpu=memory.total` |
| **Peak Dedicated VRAM Used** | 4,103 | MiB | Measured during `qwen2.5-coder:7b` active inference |
| **Average Dedicated VRAM Used**| 4,103 | MiB | Mean across 120 host execution cycles |
| **Minimum Dedicated VRAM Free**| 2,038 | MiB | Headroom preserved at all times |
| **Average Free System RAM** | 11.8 | GiB | `os.freemem()` physical memory telemetry |
| **Cold Model Load Time** | 11.9 | s | Initial Ollama process model residency time |
| **Warm Model Load Time** | 11.7 | s | Subsequent warm inference residency verification |
| **NPU State** | Detected (Unsupported) | Text | Intel(R) AI Boost detected; Ollama unsupported |

---

## 2. Dual-7B Concurrency Constraint & Scheduling Law

A critical engineering qualification in MA4-S3-T4R1 is evaluating whether two 7B-parameter models can run concurrently:

1. `qwen2.5-coder:7b` requires **4,103 MiB** dedicated VRAM for weights, context window, and KV cache.
2. Concurrent loading of two 7B models would require:
   $$\text{Required VRAM} \approx 4,103 \times 2 = 8,206 \text{ MiB}$$
3. The physical workstation has **6,141 MiB** dedicated VRAM:
   $$8,206 \text{ MiB} > 6,141 \text{ MiB} \implies \text{OOM / CUDA Thrashing}$$
4. **Policy Enforcement:** Concurrent dual-7B model loading is **physically prohibited** on this hardware class. Bunny A's conservative serialized scheduling policy must remain strictly enforced.
