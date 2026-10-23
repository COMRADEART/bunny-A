# MA4-S2 — Hardware and performance

## Measured host (2026-10-22/23, re-measured, not assumed from S1R4)

| Resource | Value |
|---|---|
| CPU | Intel Core Ultra 9 185H, 22 logical processors |
| RAM | 31.6 GiB total; free during S2 runs 7.6–10.0 GiB (browser, IDE, agents, WSL VM resident) |
| GPU | NVIDIA RTX 4050 Laptop, 6,141 MiB VRAM |
| NPU | Intel AI Boost present; not used (no NPU backend in Ollama 0.40.6) — NOT TESTED |
| Runtime | Ollama 0.40.6, local only; sandbox WSL2 (`wsl2-userns-pivot_root-cgroupv2`, kernel 6.18.33.2) |

Live sample during the held-out run (00:45 local): free RAM 10.0 GiB; GPU 4,015 / 6,141 MiB used;
`qwen2.5-coder:7b` loaded at 5.04 GiB total of which 3.82 GiB in VRAM (`/api/ps`); `huihui_ai/qwen2.5-abliterate:7b`
loaded at 5.41 GB total. Two 7B models cannot be resident on the GPU together.

No 27B/30B model was loaded in S2 (S1R4 measured them as BLOCKED_RESOURCE_LIMIT; not repeated). No process was
terminated, no system memory, page-file, driver or WSL setting was changed.

## What S2 changes

| Mechanism | Where | Behaviour |
|---|---|---|
| Memory-aware schedule | `planSchedule(pins, {vramGiB, modelGiB})` | two different models run concurrently only if both fit in VRAM; here 4.2 + 4.2 GiB > 6 GiB → **grouped**: all Worker samples, then the Tester |
| Call gate | `gateCalls(call, {maxConcurrent, timeoutMs})` | bounds concurrent model calls; records peak concurrency and model switches |
| Active-agent bound | `MAX_ACTIVE_MODEL_ROLES = 4` | memory and the Researcher are Host roles; they never add a model role |
| Free-memory floor | evaluation harness | no model call starts below 4 GiB free (waits, then refuses after 15 min); models unloaded after every trial |
| Context bound | `CONTEXT_OPTIMIZATION.md` | advisory block ≤ 1,200 characters, ≤ 3 skills, ≤ 3 experience lines; `num_ctx` 8,192 |
| Serialization | regression suite and inference never overlap | the full suite, UI tests and builds ran only after the held-out run ended |

## Measurements (held-out run, 24 trials per arm, same tasks and pins)

| | A (S1R4 parallel Worker ∥ Tester) | B (S2 grouped) | C (S2 grouped + guidance) |
|---|---|---|---|
| Peak concurrent model calls | 2 | 1 | 1 |
| Model loads / switches | 88 / 68 | 76 / 52 | 76 / 52 |
| Load time median / P95 / max | 7.6 s / 40.4 s / 120.2 s | 7.5 s / 8.6 s / 10.2 s | 7.5 s / 8.7 s / 9.1 s |
| Total load time | 23.6 min | 9.2 min | 9.2 min |
| Call latency median / P95 | 17.7 s / 76.4 s | 14.2 s / 31.2 s | 14.1 s / 34.3 s |
| Trial time total | 52.5 min | 45.6 min | 45.1 min |
| Output throughput (output tokens / call time excl. load) | 22.3 tok/s | 22.6 tok/s | 22.2 tok/s |
| Prompt tokens | 133,031 | 118,313 | 149,519 |
| Minimum free RAM (run-wide) / memory waits | 8.32 GiB / 0 | | |

Reading:

* The grouped schedule removes GPU contention: load times stop spiking (P95 40 s → 9 s), total load time drops
  61 %, call-latency P95 drops 59 %, trial time drops 13 %, with **no loss of correctness** (B 14/24 = A 14/24).
  Decode throughput is unchanged (≈ 22 tok/s), so the gain is from avoided swapping, not faster inference.
* Arm C's +26 % prompt tokens over B is the advisory guidance block; on this run it bought no correctness
  (see INTELLIGENCE_EVALUATION §2.4).
* Qualification-phase latency outlier: C's call P95 was 147.7 s vs B's 24.3 s. Cause: four long Tester generations
  (abliterate model, up to 167 s) in C vs one in B — generation length, not loading or memory pressure. The held-out
  run did not reproduce it (C P95 34.3 s).

Other phases (all grouped, peak concurrency 1, 0 memory waits): discovery 48 loads, P95 44.9 s, min free 7.58 GiB;
validation 18 loads, P95 59.9 s, min free 8.11 GiB; qualification 24 + 24 loads, min free 8.75 GiB.

## Limits

* One host, one model family, one run per phase; no repeated-measures variance estimate.
* Load time depends on what else the user is running; the figures are for this workstation in normal use.
* NPU and 27B/30B models remain untested/blocked as in S1R4.
