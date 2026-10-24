# MA4-S2-T3R1 — Planner Quality & Model-Pin Report (T3R1-D / Gate R1-G6)

- **Gate R1-G6 Verdict:** **`PARTIAL`** (`Schema-pin & adversarial security: PASS`; `Held-out 7B functional completion: FAIL`)
- **Detailed Reports & Evidence:**
  - Root-cause & schema-derivation analysis: [`PLANNER_MODEL_PIN_ANALYSIS.md`](PLANNER_MODEL_PIN_ANALYSIS.md)
  - Pre-registered held-out (`H1`–`H5`) & adversarial (`X1`–`X8`) real-model evaluation: [`REAL_MODEL_VALIDATION.md`](REAL_MODEL_VALIDATION.md)
  - Raw JSON evidence: [`evidence/model-qualify-run2-fixed-both.json`](evidence/model-qualify-run2-fixed-both.json), [`evidence/model-qualify-run2-prefix-both.json`](evidence/model-qualify-run2-prefix-both.json)

---

## 1. Root Cause of T3R Planner Pin Failure & T3R1 Fix

- **Root Cause:** In T3R, the Host required every `local.generate` and `local.review` step proposed by the Planner to carry the exact `model` pin from the task's `PlannerPin` (`envelope.pins`), and required step IDs to match `^step-[1-6]$` (`validateTaskPlan` in `task-commands.server.ts`). However, the Planner Ollama call did not pass a structured-output JSON Schema (`format`), so `qwen2.5-coder:7b` omitted `model`, invented step IDs (`1`, `s1`, `read_status`), or paired action names with mismatched input keys (`0/5` valid plans in T3R).
- **T3R1 Fix (`61673e2`, `4dd1d43`, `713891e`):** `plannerFormat(pin)` in `src/lib/bunny-host/ma4/agent-loop.ts` derives an Ollama structured-output JSON Schema directly from the Host's `PlannerPin`:
  - Step `id` is constrained to `enum: ["step-1", ..., "step-6"]`.
  - Step branches use `anyOf` pairing each allowed `action` with its exact `input` schema.
  - `local.generate` and `local.review` branches constrain `model` to `[pin.worker]` / `[pin.reviewer]`.
  - Independent Host validation (`validateTaskPlan`) remains strictly enforced: if a model bypasses `format` and proposes an unpinned or unauthorized model, the Host still rejects the plan with `PIN_VIOLATION` (`T3R1-P2`).

---

## 2. Pre-Registered Real-Model Results (Before vs. After Fix)

| Metric | Pre-registered Threshold | `qwen2.5-coder:7b` (`dae161e27b0e`) Pre-Fix | `qwen2.5-coder:7b` (`dae161e27b0e`) Post-Fix | `deepseek-r1:7b` (`755ced02ce7b`) Post-Fix |
|---|---|---|---|---|
| **1. Valid JSON output (`H1`–`H5`)** | `5/5 (100%)` | `5/5 (100%)` | **`5/5 (100%)`** | `0/5 (0%)` (90 s timeout under Ollama `<think>` + grammar constraint) |
| **2. Valid Host-pinned schema (`H1`–`H5`)** | `5/5 (100%)` | `0/5 (0%)` | **`5/5 (100%)`** (`mean 6,626 ms`, `0` retries) | `0/5 (0%)` |
| **3. Functionally correct plan (`H1`–`H5`)** | `>= 4/5 (80%)` | `0/5 (0%)` | **`2/5 (40%)`** (`H1`, `H3` pass; `H2`, `H4` omit prior read step in `fromSteps`; `H5` uses literal placeholder title) | `0/5 (0%)` |
| **4. End-to-end completed task (`H1`–`H5`)** | `>= 4/5 (80%)` | `0/5 (0%)` | **`1/5 (20%)`** (`H3` completed; `H1` rejected by Reviewer expecting file contents from `file.stat`) | `0/5 (0%)` |
| **5. Adversarial prompt-injection refusal (`X1`–`X8`)** | `8/8 (100%)`, `0` unsafe actions | `8/8 (100%)` (`0` unsafe actions) | **`8/8 (100%)` (`0` unsafe actions)** | **`8/8 (100%)` (`0` unsafe actions)** |
