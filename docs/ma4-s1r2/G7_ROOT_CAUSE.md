# G7 root-cause analysis (S1R v1 and v2 evidence, unaltered)

Sources: `docs/ma4-s1r/AGENT_EXECUTION_EVIDENCE.md`, `docs/ma4-s1r/evidence/agents.json`, `evidence/python-workflow.json` (`g7: FAIL`, 0/3, 11 generation requests), `evidence/agent-format-reproduction.log`.

| Run | Symptom (from evidence) | Origin class | Model vs infrastructure |
|---|---|---|---|
| v1 Planner→Worker→Reviewer | Worker returned fenced JSON; independent parser rejected the exact JSON-only contract | JSON / schema error; the structured contract was requested in prose, not enforced by the runtime | model output format; infra lacked enforced structured output for agent steps |
| v1 (fixed earlier in S1R) | read-only step's mandatory prose summary conflicted with JSON-only | orchestration prompt defect | infrastructure (fixed in S1R) |
| v2 trial 1 | hidden tests and Tester tests both ImportError: demo `print()` calls at module level raised on import (`5400 45 7205 …` printed first) | invalid generated code (import-time side effects); **Reviewer APPROVED** | model quality + poor review judgment; no deterministic import-safety check |
| v2 trial 2 | `30m1h` accepted (unit order not enforced) → hidden `test_invalid` failed; Tester omitted `import unittest` | incorrect logic + invalid generated tests | model quality; no repair loop to act on the failing case |
| v2 trial 3 | Worker hit the 120 s step limit, output truncated; Reviewer correctly blocked by the failed dependency | timeout / resource (partial-offload 7B at ~30 tok/s producing long prose+code) | resource bound; scheduler behaved correctly |

Not observed: context loss between agents, dependency-ordering defects, pin substitution, scheduler deadlocks, or sandbox/permission failures. Pins, dependency order, Worker∥Tester overlap, runtime limits and dependency blocking were all verified working in S1R.

## Conclusions driving the S1R2 workflow

1. **Enforce structure at decode time and validate it**: every role returns a JSON artifact constrained by Ollama `format` (JSON Schema from zod) and re-validated strictly; malformed → fail closed. (v1)
2. **Deterministic static validation before tests**: parse/compile, import allowlist, import-safety rule (only imports, definitions, constants, `__main__` guard at top level), declared files/dependencies, import smoke test — all inside the sandbox. (v2 t1)
3. **Bounded repair with objective feedback**: up to two Worker repairs given the contract, failing validated test cases, sanitized errors and the previous code. (v2 t2)
4. **Reviewer is advisory**: acceptance is the deterministic gate only; reviewer approvals of failing code are counted as false approvals. (v2 t1)
5. **Tester tests are validated against a frozen host-side reference** for held-out tasks, so an invalid generated test cannot fail (or pass) correct code; the unchanged v2 rule (all Tester tests must pass) is kept for the regression. (v2 t2)
6. **Per-call budget 240 s with JSON artifacts instead of free prose**, `num_ctx` 8192, `num_predict` 2048. (v2 t3)
7. **OS-enforced sandbox** replaces the AST-gate + job harness for every execution of generated code.

None of these can make a weak model correct; they make failures explicit, attributable and repairable.
