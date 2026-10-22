# MA4-S1R4 — Deterministic tool augmentation (Phase E, R4-G6)

## What a small model no longer has to do itself

| Work | Done by | Tool (manifest id) |
|---|---|---|
| Parse the generated module and tests, enforce the import allowlist and import safety | orchestrator | `ma4.static_check` (Python `ast`, sandboxed) |
| Prove the module imports cleanly | orchestrator | `ma4.import_smoke` (sandboxed) |
| Execute tests per test id (Tester tests vs each Worker sample; hidden acceptance; oracle) | orchestrator | `ma4.run_tests` (sandboxed `unittest` per-test runner) |
| Validate every agent artifact against its schema | orchestrator | zod schemas (`PlannerArtifactSchema`, `Fenced*Schema`, `ReviewerArtifactSchema`) |
| Compare artifacts (identical repair, sample identity) | orchestrator | SHA-256 of the artifact text |
| Choose among independent Worker samples | orchestrator | ranking by the Tester's own tests (never hidden tests, never the reference) |

## Boundary (all enforced in `coding-workflow.server.ts`, tested in `ma4-s1r4.test.ts`)

* **Permission broker.** Every tool invocation asks `authorize(manifest, params)` first. The default is the existing
  `decide()` from `bunny-missions/authorization.server.ts`, called as a direct workstation invocation (the qualification
  runners are started by the workstation user). Manifests declare `risk: "EXECUTE"`. A `deny`/`ask` fails closed before
  anything runs: status `sandbox_error`, failure `tool_failure`, a receipt with `decision: "deny"`, zero sandbox calls
  (test *R4-G6 tools: a broker denial fails closed*).
* **Bounded invocations.** `strategy.maxToolCalls` (S1R4: 60 per workflow; S1R3 default 200). Exceeding it ends the
  workflow as `resource_exhaustion` (test *R4-G6 tools: the per-workflow tool budget*). Model calls are bounded by the
  task profile's `maxModelCalls`.
* **Timeouts, cancellation, sanitization.** Unchanged sandbox limits (20 s wall clock, 256 MiB, 8 pids, 256 KiB output);
  the workflow's `AbortSignal` reaches every sandbox run; outputs are sanitized and clipped before they reach a model.
* **Receipts.** `result.toolReceipts[]`: `{ index, tool, invoker: "orchestrator", decision, ok, durationMs, inputSha256 }`
  — a hash of the inputs, never the inputs themselves.
* **No unrestricted shell.** The only executable is `python3 -I -S` inside the WSL2 sandbox (namespaces, pivot_root,
  cgroup, rlimits, seccomp). If the sandbox is unavailable the runners refuse to start (fail closed).

## Model-native vs orchestrator tool capability — reported separately

| Capability | Evidence | Result |
|---|---|---|
| Orchestrator deterministic tools | every S1R4 G7/dev trial's `toolReceipts` | all `invoker: "orchestrator"`; never counted as a model tool call |
| Model-native tool calls, `huihui_ai/qwen2.5-abliterate:7b` | S1R3 `tool-probe.json` (6 probes, temperature 0) | 6/6 valid native calls — demonstrated |
| Model-native tool calls, `qwen2.5-coder:7b` | same | 0/6 (writes calls as JSON text; prose is never parsed as a call) |
| Native tool calls in the coding workflow | design | **none**: the workflow never asks a model to call a tool, and never manufactures a call on a model's behalf |

The S1R4 benchmark tournament re-measures the `tool-call` category for both 7B models (see LOCAL_MODEL_TOURNAMENT).

## Not done

* Mathematics: the coding workflow has no arithmetic step a calculator could take over (expected values in tests are
  derived by the Tester from the contract). The existing `math.*` tools remain available to the native tool loop only.
* No new tool kinds were added to the Host runtime; S1R4 tools exist inside the coding workflow only.
