# MA4-S1R2 local model benchmarks — R2-G2

## Method (pre-registered, `scripts/ma4-s1r2/bench-tasks.mjs`, `benchmarks.mjs`)

* Suite `bunny-ma4-s1r2-bench-v1`; task-set SHA-256 recorded in each evidence file. 18 **dev** tasks (2 per category) produce reliability evidence; 9 **held-out** tasks (1 per category) are used only for the auto-vs-fixed comparison.
* Categories: programming, debugging, planning, json-schema, math, tool-call, instruction-following, code-review, multi-agent.
* Independent checks only: Python answers run against hidden unittest suites **inside the OS-enforced sandbox**; JSON answers are parsed and checked field-by-field (exact keys); planning answers are checked for a valid topological order; tool-call answers must call the right tools via the native tool loop (broker-authorized) **and** give the right final value; review answers must name the planted defect.
* Options fixed: `temperature 0.2`, `seed = 1000 + sample`, `num_ctx 4096`, `num_predict 900`; 3 samples per task; no retries; every sample kept. Network allowlist: local Ollama only (0 external requests attempted). Memory guard: stop below 2.5 GiB free.
* Models: the two installed local models that fit the measured headroom. 27B/30B: NOT TESTED (memory, see [HARDWARE_QUALIFICATION.md](HARDWARE_QUALIFICATION.md)). `deepseek-v4.1-flash:cloud` refused (cloud-backed).

## Dev split results (`evidence/bench-dev.json`, `bench-dev.log`)

| Category (6 samples each) | qwen2.5-coder:7b | qwen2.5-abliterate:7b |
|---|---|---|
| programming | 3/6 | 4/6 |
| debugging | 6/6 | 6/6 |
| planning | 6/6 | 6/6 |
| json-schema | 6/6 | 6/6 |
| math | 0/6 | 0/6 |
| tool-call | 0/6 | 0/6 |
| instruction-following | 0/6 | 0/6 |
| code-review | 3/6 | 3/6 |
| multi-agent | 3/6 | 3/6 |
| **total** | **27/54** | **28/54** |

Per task (3 samples): both models pass `prog-rle`, `debug-bsearch`, `debug-default`, both planning tasks, both JSON tasks, `review-weekend`, `comm-review`. Both fail `math-pens` (31/11 vs 29), `math-multiples` (9850/1332 vs 9368), both tool tasks (no tool call emitted), both instruction tasks, `review-lastn` (both blamed `average`), `comm-handoff` (wrong `to` key). `prog-ipv4`: coder 0/3 (its regex accepts leading zeros such as `01`), abliterate 1/3 (the hidden suite's single test method failed; the exact failing input is not recorded).

| Model | Median latency | Max latency | Median tokens/s | Loaded footprint | VRAM share | Min free RAM during run | Max GPU util |
|---|---|---|---|---|---|---|---|
| qwen2.5-coder:7b (`dae161e27b0e`) | 1.19 s | 7.0 s | 27.7 | 5.15 GB | 81.5% | 5.97 GiB | 65% |
| qwen2.5-abliterate:7b (`103482475c9b`) | 0.99 s | 12.1 s | 28.4 | 5.15 GB | 81.5% | 5.99 GiB | 65% |

Backend: CUDA partial offload (RTX 4050) + CPU. Served-model receipts matched the pin on every sample.

### Caveats

* **Effective sample size is ~18 tasks per model, not 54**: at temperature 0.2 the three seeded samples per task were almost always identical. Per-category evidence (2 tasks) is thin; the Wilson lower bound used by the router penalizes that appropriately.
* `instr-lines`: coder wrote "lanterns" where the frozen check requires the word "lantern" (strict, pre-registered, left unchanged); abliterate put all three lines on one line.
* The tool naming (`math.add`) was checked as a possible harness cause: a direct probe with `math_add`, with/without the system message, also produced no tool call.
* Text generation success is not task success: every model produced fluent output on every task; 26–27 of 54 were wrong.

## Automatic routing vs fixed coding model (held-out split) — `evidence/heldout-auto-vs-fixed.json`

Auto arm: the real Host `routingPipeline` (`AUTO_LOCAL`, both local models allowlisted) with the dev evidence imported into the reliability store. Fixed arm: `qwen2.5-coder:7b`. Same tasks, seeds, options, checks and execution function (`runTask`). 9 tasks × 3 samples = 27 pairs.

| Task | auto (abliterate) | fixed (coder) |
|---|---|---|
| ho-intervals, ho-wordcount, ho-plan, ho-json, ho-instr, ho-review, ho-comm | 3/3 each | 3/3 each |
| ho-math (divisors of 360) | 0/3 | 3/3 |
| ho-tool | 0/3 | 0/3 (no tool calls) |
| **total** | **21/27** | **24/27** |

Paired: both 21, auto-only 0, fixed-only 3, neither 3. Exact sign test on discordant pairs p = 0.25 → **no statistically supported difference**; all discordant pairs come from one task, so the effective comparison is a single item. **No routing superiority is claimed**, in either direction.

The router sent all 9 tasks to the abliterate model. On coding-class prompts it had slightly better measured programming evidence (4/6 vs 3/6, reliability −4.0 vs −6.2). On every other prompt the scores tied exactly and the deterministic tie-break picked it by model id. The analyzer put the held-out debugging and planning prompts in `coding`, and math, tool and instruction prompts in `general`, which has no reliability mapping. Reliability evidence therefore influenced only the coding and structured-output decisions. Fixing that needs a better task analyzer validated on new data; it was not tuned on these held-out prompts.
