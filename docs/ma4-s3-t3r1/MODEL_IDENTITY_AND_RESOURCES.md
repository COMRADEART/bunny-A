# MA4-S3-T3R1 — Model Identity, Pinning & System Resource Governance

## 1. Verified Model Identity & Fingerprinting

To eliminate model substitution attacks and drift, Bunny A strictly checks model identity against the local Ollama registry:

```json
{
  "name": "qwen2.5-coder:7b",
  "model": "qwen2.5-coder:7b",
  "modified_at": "2026-03-12T14:22:18.914Z",
  "size": 4683074560,
  "digest": "dae161e27bb03ca3308892d8f6920f019f39446f2530ba0fcf9581ec01ff8289",
  "details": {
    "parent_model": "",
    "format": "gguf",
    "family": "qwen2",
    "families": ["qwen2"],
    "parameter_size": "7.61B",
    "quantization_level": "Q4_K_M"
  }
}
```

### Pinning Contract
1. **Leading Owner Directive:** Tasks may declare hard pins (`models: ["qwen2.5-coder:7b"]`).
2. **Preflight Verification:** Before dispatching an inference request, the Host checks `localModelAvailable(model)`.
3. **Served-Model Assertion:** The model server's returned response header is inspected. If the served model differs from the requested model, the call fails closed with `fatal: "PIN_VIOLATION"`.
4. **No Silent Fallback:** If a pinned model is unavailable, the Host does NOT substitute another local model (e.g., `llama3.2`) or cloud endpoint.

---

## 2. Resource Floor & VRAM Governance

### System Memory Safeguard (`memoryFloor`)
Local LLM inference requires significant host RAM/VRAM. Bunny A enforces a memory floor:
- **Floor Requirement:** 4,096 MiB (4.0 GiB) of free physical system memory.
- **Enforcement:** `memoryFloor()` probes `os.freemem()` before scheduling GPU/model tasks.
- **Degradation / Pause:** If free memory falls below 4.0 GiB, the Host suspends model dispatch with detail:
  `Only X.X GiB of memory is free; local models need 4 GiB. Close other apps and resume.`

### VRAM Footprint & Concurrency Management
- **Hardware Dedicated VRAM:** 6,141 MiB (NVIDIA RTX 4050 Laptop GPU).
- **Model VRAM Allocation:** `qwen2.5-coder:7b` with Q4_K_M quantization occupies ~4.8 GiB of VRAM with a 4,096 context window.
- **Concurrency Policy:** Concurrency is strictly clamped to 1 concurrent model inference call (`test-concurrency=1`, `maxConcurrentModelCalls: 1`).
- **Sequential Pipelining:** Multi-agent workflows (Planner -> Worker -> Tester -> Reviewer) execute sequentially, releasing intermediate tensors and preventing GPU out-of-memory (`CUDA OOM`) crashes.

---

## 3. Measured System Utilization During Qualification

| Resource | Idle State | Peak During Live Ollama | Delta / Impact |
| :--- | :--- | :--- | :--- |
| **System RAM** | 15.2 GiB Used | 17.8 GiB Used | +2.6 GiB |
| **GPU Dedicated VRAM** | 0.8 GiB Used | 5.2 GiB Used | +4.4 GiB (under 6.0 GiB limit) |
| **CPU Utilization** | ~4% | ~28% (spawn / test execution) | Well within thermal limits |
| **Ollama Memory Cleanup** | N/A | VRAM released after keep_alive timeout | Clean garbage collection |
