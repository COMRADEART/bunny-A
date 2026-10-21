# Real agent execution evidence

Base: `f5d3f90`. Scheduler: existing MA3 MissionManager, using TaskManager and the real OllamaAdapter. Isolated temporary root and in-memory Host database; no capability adapters, no generated code execution, no filesystem/network tool authority. All three roles have an explicit `qwen2.5-coder:7b` pin. This is **three separate invocations of one model**, not multi-model execution.

Planner proposes a sort/sum pipeline; Worker computes a fixed array transformation; Reviewer independently checks the Worker. Steps enforce Planner → Worker → Reviewer dependencies and record model/accounting/start/finish times and sanitized event types. Expected results remain host-side. The Worker and Reviewer prompts in v2 do not contain reference outputs.

Objective gate: **FAIL**. The scheduler completed all three invocations, but the Worker returned fenced JSON rather than the exact JSON-only output contract. The independent JSON parser rejected it; the overall workflow is not certified successful merely because agents or the scheduler reported completion. The read-only prose-summary conflict was fixed and covered separately, but the remaining model format failure is retained. G7 remains FAIL/PARTIAL for production qualification. An unvalidated answer cannot be promoted to a verified artifact.

Controlled missing-pin agent failure: PASS. It entered the expected failed/waiting-for-user path with no generation request, no substitution and null provider accounting. The corrected harness checks actual request count rather than inventing a zero-valued accounting field.

Cancellation after live output: PASS; measured bound 8 ms; sessions remaining zero. Request controllers were released and qualification-owned model caches explicitly unloaded. No orphan live session was observed.

Reproduce: `npm run test:ma4:local`; agent-only rerun is available as `node --experimental-strip-types scripts/ma4-s1r/qualify.mjs --agents-only` but was not used to discard failed outputs. Timestamps and sanitized event sequences: `evidence/agents.json`. No Python implementation/test run, real tool-driven code editing, installed production agent, or physical mobile execution is claimed.

## Continuation: Python utility workflow v2 (pre-registered)

Script: `scripts/ma4-s1r/python-workflow.mjs`, run with `node --experimental-strip-types scripts/ma4-s1r/python-workflow.mjs` (`bunny-ma4-s1r-python-workflow-v2`). Evidence: `evidence/python-workflow.json`, `evidence/python-workflow.log`. The success rule, hidden tests (SHA-256 recorded in the evidence), extraction contract, AST gate and trial count were fixed in the script header before any generation, and were not edited after outputs were seen.

Shape: Planner → (Worker ∥ Tester) → Reviewer, four roles through the real MA3 MissionManager, TaskManager and OllamaAdapter. All roles were pinned to `qwen2.5-coder:7b`, so this is **four invocations of one local model**, not multi-model execution. The Worker writes `parse_duration` (a duration-string parser). The Tester writes its own unittest module without seeing the Worker's code. Three independent trials, no retries. G7 passes only if at least 2 of 3 trials pass **both** the hidden harness tests and the Tester's own tests against the Worker's module.

Bunny never runs agent-written code, apart from the fixed `hello.py` verification one-liner, and that boundary is unchanged. The **qualification harness** ran the generated code only after these controls:
- an AST gate: imports limited to `re`/`unittest`/`typing`/`duration`, and no I/O, introspection or dunder access;
- `python -I -S` inside a Bunny-owned Windows job with a 20 s timeout, a minimal environment and a disposable temporary folder.

Network isolation of that child relies on the AST import gate; no firewall rule was added.

Amendment A1 (recorded in the script header): the first wording put a `.py` file name and "write … code/test" in the objectives. The MA3 `inferredConstraints()` heuristic turns that into a filesystem requirement, so the text-only local model was correctly refused before dispatch, with **zero** generation requests. Only the objective wording was changed. That setup failure is kept in `evidence/attempt-python-setup/`. Mission routing reads only `step.objective` (`routingPrompt`), so dependency or model output cannot change a later step's routing constraints. This was confirmed by inspecting `bunny-missions/manager.server.ts`.

| Trial | Mission | Pins / dependencies / Worker∥Tester overlap | AST gate | Hidden tests | Generated tests | Reviewer said | Result |
|---|---|---|---|---|---|---|---|
| 1 | completed | yes / yes / yes | pass | FAIL: the Worker left demo `print()` calls at module level that raise on import | FAIL (same import error) | APPROVE | FAIL |
| 2 | completed | yes / yes / yes | pass | FAIL: `30m1h` was accepted (unit order not enforced) | FAIL: the Tester left out `import unittest` | REJECT | FAIL |
| 3 | failed | Worker hit the 120 s runtime limit; Reviewer blocked by the failed dependency | FAIL: truncated source | not run | not run | — | FAIL |

**G7 v2: 0/3 → FAIL.** The scheduler, pins, dependency ordering, parallel independent steps, runtime-limit enforcement and dependency-failure blocking all worked against real local inference. The 7B model did not produce correct code. In trial 1 the Reviewer **approved** code that does not import. This is direct evidence that model self-review cannot replace independent verification. No trial was re-run or relabelled.
