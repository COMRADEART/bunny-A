# MA4-S1R3 local model qualification — R3-G10 (Phase C)

## C1 inventory (Ollama 0.40.6, `/api/tags` + `/api/show`, re-read 2026-10-21; nothing downloaded)

| Tag | Family | Params | Quant | Size | Ollama capabilities | Status |
|---|---|---|---|---|---|---|
| `qwen2.5-coder:7b` | qwen2 | 7.6B | Q4_K_M | 4.36 GiB | completion, tools | runnable, tested |
| `huihui_ai/qwen2.5-abliterate:7b` | qwen2 | 7.6B | Q4_K_M | 4.36 GiB | completion, tools | runnable, tested |
| `huihui_ai/Qwen3.8-abliterated:27b` | qwen35 (dense) | 27.3B | Q4_K_M | 16.52 GiB | completion, vision, tools, thinking | **BLOCKED_RESOURCE_LIMIT** |
| `huihui_ai/qwen3-abliterated:30b` | qwen3moe (128 experts, 8 active) | 30.5B | Q4_K_M | 17.28 GiB | completion, tools, thinking | **BLOCKED_RESOURCE_LIMIT** |
| `deepseek-v4.1-flash:cloud` | — | — | — | cloud-backed (`remote_host` ollama.com) | — | **refused** (cloud; external inference not approved) |

The tags, sizes and quantizations match the S1R2 inventory. None changed.

## C2 hardware-aware gate (measured; no large model was loaded)

Host at measurement time: 31.6 GiB RAM, **10.72 GiB available** (`\Memory\Available MBytes`, free + standby), committed 31.1 GiB of a 58.6 GiB commit limit, RTX 4050 Laptop 6 GiB VRAM (0 MiB in use), Intel AI Boost NPU (no Ollama backend). No user process was terminated, and paging, system limits and drivers were not touched.

Resident-memory estimate at the G7 runner's bounded context (`num_ctx` 8192, f16 KV), from `/api/show` metadata:

| Model | Weights | KV cache @ 8192 | ≈ VRAM usable | Host RAM needed | + runner guard 2.5 GiB | Available | Decision |
|---|---|---|---|---|---|---|---|
| 30B MoE | 17.28 GiB | 2·48·4·128·8192·2 B ≈ 0.75 GiB | ≈ 5 GiB | ≈ 13.5 GiB (incl. ≈ 0.5 GiB compute buffers) | ≈ 16 GiB | 10.7 GiB | **BLOCKED_RESOURCE_LIMIT** |
| 27B dense | 16.52 GiB | ≤ 2·65·4·256·8192·2 B ≈ 2.0 GiB | ≈ 5 GiB | ≈ 14 GiB | ≈ 16.5 GiB | 10.7 GiB | **BLOCKED_RESOURCE_LIMIT** |

Loading either would force the OS to evict or page about 3–6 GiB under an already over-committed system. The mission forbids that ("do not force large memory allocation; maintain enough system memory for stable operation"). This is a resource limit, not an agent-correctness failure. **To unblock:** the owner frees about 6 GiB of RAM (close applications, or shrink the WSL2 VM's memory) and re-runs this gate. Nothing else needs changing: `G7_PIN=<tag>` runs the same frozen benchmark.

GPU: the 7B models run with CUDA partial offload. NPU: detected, **NOT TESTED** (Ollama has no NPU backend; enabling one needs new software and approval).

## C3 benchmarks (reproducibility re-run, R3-G10)

The frozen S1R2 dev suite was re-run unchanged in the isolated worktree: `node --experimental-strip-types scripts/ma4-s1r2/benchmarks.mjs --out docs/ma4-s1r3/evidence/bench-dev-repro.json` (18 tasks × 9 categories × 3 samples, temperature 0.2, `num_ctx` 4096, sandboxed checks, local-only network). The task hash equals S1R2's.

| Category | coder 7B (S1R2 → S1R3) | abliterate 7B (S1R2 → S1R3) |
|---|---|---|
| programming | 3 → 3 /6 | 4 → 4 /6 |
| debugging | 6 → 6 | 6 → 6 |
| planning | 6 → 6 | 6 → 6 |
| JSON/schema | 6 → 6 | 6 → 6 |
| math | 0 → 0 | 0 → 0 |
| tool-call (bench prompts) | 0 → 0 | 0 → 0 |
| instruction-following | 0 → 0 | 0 → 0 |
| code-review | 3 → 3 | 3 → 3 |
| multi-agent | 3 → 3 | 3 → 3 |
| **total** | **27 → 27 /54** | **28 → 28 /54** |

Every category is **identical**, so **R3-G10 PASS** (benchmarks independently reproducible). Latency: coder median 1.06 s, p95 3.2 s, 29.7 tok/s; abliterate median 0.88 s, p95 3.6 s, 30.2 tok/s (CUDA partial offload). G7 agent calls (run 2, 8192 ctx, JSON schema): median 13.7 s, p95 46.7 s. Held-out integrity: nothing was tuned on held-out answers, and the hidden tests and references never reach a model.

Agent-level quality (G7, see G7_REGRESSION_RESULTS.md): coder 7B on every role reached 13/20 held-out in both S1R3 runs and 0/3 on the v2 regression. Test-generation repair: 1 of 7 Tester repairs resolved. Code repair: 3 of 19 Worker repairs resolved. Code review: 3 false approvals and 1 false rejection in 23 trials.

## C4 assignment (evidence-based; pins respected)

| Role | Best measured local model | Evidence | Qualified? |
|---|---|---|---|
| Worker (coding) | `qwen2.5-coder:7b` ≈ abliterate 7B (programming 3/6 vs 4/6; not distinguishable) | bench, G7 | **No.** Fails the G7 bar |
| Planner | either 7B (planning 6/6 both) | bench | sufficient for G7 plans; the plan was repaired 2× in 46 trials |
| Tester | none distinguishable | G7 Tester repair 1/7 | **No** |
| Reviewer | none | 3 false approvals in run 2 | **No.** Advisory only; the gate decides |
| Tool calling | `huihui_ai/qwen2.5-abliterate:7b` | probe 6/6 native calls | demonstrated on the probe set only |
| Math | none | 0/6 both | **No** |

Routing is unchanged: hard pins and per-agent pins are always honoured, and automatic routing uses the S1R2 reliability evidence. No local model is promoted to an unqualified role. When none qualifies, the workflow fails honestly (G7 FAIL), and no success is fabricated. Next step: a stronger model, either the local 30B MoE once about 6 GiB of RAM is freed, or the pending Groq request after explicit approval.
