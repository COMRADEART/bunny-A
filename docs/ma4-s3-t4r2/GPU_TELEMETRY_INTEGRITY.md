# GPU Telemetry Integrity & Fail-Closed Resource Scheduling

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R2  
**Document:** Hardware Resource Telemetry Architecture  
**Classification:** P0 Verification Integrity  

---

## 1. The Hardware Telemetry Problem

In predecessor milestone `MA4-S3-T4R1`, `sampleGpuTelemetry()` in `live-benchmark.server.ts` contained a fallback mechanism:
```typescript
// Pre-T4R2 fallback
catch {
  return {
    available: true,
    totalVramBytes: 6141 * 1024 * 1024,
    usedVramBytes: 1024 * 1024 * 1024,
    freeVramBytes: (6141 - 1024) * 1024 * 1024,
    gpuUtilizationPercent: 0,
    gpuName: "NVIDIA GeForce RTX 4050 Laptop GPU",
  };
}
```
This fallback created two severe issues:
1. **False Hardware Observation:** On machines without an NVIDIA GPU, or in CI environments where `nvidia-smi` is not installed, the benchmark reported a physical RTX 4050 GPU with 6,141 MiB of VRAM.
2. **Resource Scheduling Hazard:** If the resource scheduler relied on this fallback, it could calculate that sufficient VRAM was free to admit parallel models, leading to Out-Of-Memory (OOM) crashes on real systems.

Additionally, sampling VRAM only at task inception and task conclusion was described as "peak VRAM," concealing intra-task spikes.

---

## 2. Fail-Closed Telemetry Architecture

Milestone `MA4-S3-T4R2` enforces strict physical observation or explicit unavailability in `sampleGpuTelemetry()`:

```typescript
export interface GpuTelemetrySnapshot {
  available: boolean;
  reason?: string;
  name: string | null;
  gpuName: string | null;
  totalVramBytes: number | null;
  usedVramBytes: number | null;
  freeVramBytes: number | null;
  gpuUtilizationPercent: number | null;
  sampleTimestamp: string;
  samplingMode: "pre_post_snapshots" | "continuous";
  continuousPeakVramUsedBytes: number | null;
}
```

### Telemetry Sampling Contract
1. **Strict Physical Query:** `sampleGpuTelemetry()` executes:
   ```text
   nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader,nounits
   ```
2. **Fail-Closed Unavailable State:** If `nvidia-smi` fails, throws an error, or returns unparseable CSV, the function returns:
   ```json
   {
     "available": false,
     "reason": "nvidia_smi_failed",
     "name": null,
     "gpuName": null,
     "totalVramBytes": null,
     "usedVramBytes": null,
     "freeVramBytes": null,
     "gpuUtilizationPercent": null,
     "samplingMode": "pre_post_snapshots",
     "continuousPeakVramUsedBytes": null
   }
   ```
3. **Truthful Snapshot Disclosure:** Because samples are captured only at task start and completion, intra-task continuous peaks cannot be asserted. The snapshot contract explicitly discloses `samplingMode: "pre_post_snapshots"` and sets `continuousPeakVramUsedBytes: null`.

---

## 3. Impact on Safe Adaptive Scheduling

The Bunny A adaptive scheduler (`adaptive-planner.ts` and `resource-scheduler.ts`) enforces strict safety invariants when telemetry is unavailable:

```
                            ┌─────────────────────────────┐
                            │ Telemetry Sample Evaluated  │
                            └──────────────┬──────────────┘
                                           │
                         Is telemetry available & verified?
                                           │
                   ┌───────────────────────┴───────────────────────┐
                   │ YES                                           │ NO
                   ▼                                               ▼
     ┌───────────────────────────┐                   ┌───────────────────────────┐
     │ Check measured free VRAM: │                   │ Conservative Fallback:    │
     │ Free >= 5.5 GiB?          │                   │ Telemetry unavailable.    │
     └─────────────┬─────────────┘                   │ Forbid parallel models.   │
                   │                                 │ Enforce single-model      │
          ┌────────┴────────┐                        │ sequential execution.     │
          │ YES             │ NO                     └───────────────────────────┘
          ▼                 ▼
   ┌─────────────┐   ┌─────────────┐
   │ Permit dual │   │ Queue model │
   │ model burst │   │ sequentially│
   └─────────────┘   └─────────────┘
```

When `available === false`:
- Parallel execution of dual large models (e.g. two 7B parameter models requiring >9 GiB VRAM) is **strictly prohibited**.
- The system defaults to single-agent, sequential execution with cooperative model unloads.
- GitHub-hosted CI runners lacking dedicated GPUs execute without synthetic crashes while verifying that the scheduler respects the unavailable state.

---

## 4. Test Verification Evidence

Hardware telemetry integrity is verified in `src/lib/bunny-host/ma4/benchmark-integrity.test.ts`:
- **Unavailable Telemetry:** Telemetry fixture with `available: false` returns `available: false` and `null` for all byte values.
- **Null Total VRAM Invariant:** When `available: false`, total VRAM is strictly `null` (never defaults to 6141 MiB).
- **Snapshot Disclosure:** `samplingMode` is verified as `"pre_post_snapshots"` and `continuousPeakVramUsedBytes` as `null`.
- **Positive Real/Fixture Telemetry:** When valid metrics are supplied, exact bytes and device names are preserved without modification.

**Gate Result:** **T4R2-G6 PASS, T4R2-G7 PASS.**
