# BUNNY A — MA4-S1R QUALIFICATION REPORT

Base commit: `f5d3f9027228504e45fba9f204638778bd6b649e`.
Qualification branch: `ma4-s1r-live-qualification`, in an isolated worktree.
Implementation/evidence commit and PR: recorded after final local verification.
CI status: not yet published; no repository workflow is tracked in the S1 baseline.

**FINAL STATUS: PARTIAL.** Real local inference is demonstrated, but this phase does not qualify production completeness. No MA4-S2 work or external inference activation was performed.

## Verified results

* Two installed 7B models ran on Ollama 0.40.6: `qwen2.5-coder:7b` and `huihui_ai/qwen2.5-abliterate:7b`. Four local weights and one cloud proxy tag were discovered. Large local weights were skipped for resource safety; the cloud tag was blocked.
* Basic generation, Host automatic routing, exact model pins, invalid-pin refusal, ordered streaming, independently checked structured JSON, bounded cancellation/timeout, and synthetic sensitive local execution passed their recorded functional trials. Native coder tool-call output failed; product Ollama tools remain UNSUPPORTED.
* Thirty-six qualified scored generations across nine synthetic categories. Direct coder 5/9, direct general model 7/9; paired automatic 4/9 versus fixed coder 6/9. Four answer-contaminated planning samples were excluded and replaced by a frozen v3 prompt; the original evidence remains. No reference answer was changed. There is no established routing superiority. Small samples, default stochastic generation, mixed experimental sessions and fixed task order limit conclusions.
* Controlled CPU generation: 8.95 tokens/s; default partial NVIDIA offload: 30.76 tokens/s. CPU/GPU placement is supported by runtime VRAM receipts plus NVIDIA telemetry. Intel AI Boost is detected/exposed by OpenVINO, but NPU inference is NOT TESTED. These short trials do not establish thermal endurance or all-GPU execution.
* Planner/Worker/Reviewer ran as three dependent invocations of one pinned model through MA3. The scheduler completed, but Worker output failed the exact JSON-only objective check. This remains a FAIL for the successful-workflow gate; it is not reclassified as verified success. Controlled missing-pin failure and cancellation/resource release passed.
* Continuation (G7 v2, pre-registered Python utility workflow): Planner → (Worker ∥ Tester) → Reviewer through the real MA3 MissionManager, three trials, with harness-only execution of generated code behind an AST gate in a Bunny-owned job. Pins, dependencies, parallel independent steps, runtime limits and dependency blocking all worked. **0/3 trials produced code that passed the hidden tests and the Tester's own tests.** In one trial the Reviewer approved code that fails on import. G7 remains **FAIL**. See [agent evidence](AGENT_EXECUTION_EVIDENCE.md).
* Real built Windows UI routing exposed a crash on an Ollama-only Host. A focused fix filters nonexistent provider nodes. The repaired UI displayed the pinned coder, completed local tasks, showed streaming, and stopped a request after five output events. A runtime deadline was originally shown as a generic stopped task. The continuation fixes this: `taskStatus()` now shows **Stopped · runtime limit reached** when the Host watchdog stopped the task (reproduced by a test that fails before the fix and passes after; `presentation.test.ts` 26/26). It has not been re-checked in the built UI.

## Changes and evidence

Minimal source fixes require completed exact-model receipts, reject invalid structured JSON, read current architecture-qualified context metadata, preserve exact-format instructions for read-only agents, and handle partial provider snapshots in the routing graph. Regression coverage accompanies these fixes. Existing write permissions, summary requirements for writers, authority checks, model rank weights, MA3 visual design and installed release activation are retained.

The focused backend check is 23/23; MA4 is 22 passed, zero failed, one unauthorized cloud-live test skipped. The final UI suite is 406/406. Final typecheck and desktop/default shared mobile-web builds pass. The final full established command passed **2,168 tests, zero failed, one skipped** (450 + 1,638 + 58 + 22 passes), including the MA4 suite. Existing non-MA4 regression coverage is 2,146 passes (2,145 at S1 plus the new runtime-limit presentation test). Runtime 21.05 minutes. Exact command, stage counts and sanitized output are in `evidence/recheck.json` and `regression-after-prerequisite.log`.

The initial full command stopped after 449/450 script tests because this isolated worktree lacked the existing Node runtime license fallback. The unchanged license was copied locally from the original repository's ignored release assets (SHA-256 `148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5`); it was not downloaded or committed and the license gate was not weakened. Existing voice runtime/header assets and dependencies were reused locally. The initial typecheck also found a new test-fixture string/schema type mismatch; the fixture now uses the declared object-schema contract. Initial failures are retained separately from final results.

The subsequent full run passed 450/450 script checks and 1,636/1,637 core checks, exposing an inherited S1 fixture contradiction: R18 expected hosted advice for a local-only task. Isolated reproduction confirms it. The fixture now explicitly asserts local-only metadata advice is blocked with zero transmissions, and tests provenance separately using the authorized mock metadata-sharing path constrained to local execution models. Production privacy was not relaxed. The corrected intelligence file passes 50/50. The earlier failed full run remains in `evidence/attempt-r18/`; the final complete rerun passes as reported above.

The next run passed 450/450 script and 1,637/1,637 core checks, then exposed obsolete MA3 team fixtures with no model catalogue despite requesting schema-bound inference. A one-second isolated reproduction confirms S1 refuses the fake planner before dispatch. The fixture now declares its explicitly simulated model/capability/context facts and retains unknown/offline behavior; production fail-closed routing is unchanged. The identified obsolete team stage was stopped after repeated bounded waits to avoid wasting further fixture timeouts. Partial command output is retained in `evidence/attempt-team/`. The corrected team stage and entire established command are rerun; controlled termination is not a test pass.

Production desktop smoke rendered visible content at 1280×800 and 390×844, with zero page/console errors, no overflow, and no auth/brand warnings; both screenshots were visually inspected. The pre-existing development server timed out during a read-only smoke attempt. It was left running; no development-parity pass is claimed. Physical Android/iOS, installed production-release switching, Notch/microphone hardware and native Android packaging were NOT TESTED in this phase.

## Acceptance gates

| Gate | Status | Scope / limitation |
|---|---|---|
| G1 | PASS | S1 commit, historical evidence and original changes verified |
| G2 | PASS | Two real local models executed |
| G3 | PASS | Exact pins, mismatch rejection and unavailable-pin refusal |
| G4 | PASS | Real ordered streaming, measured abort and UI Stop |
| G5 | PASS, scoped | Versioned reproducible method/results; no superiority or broad capability claim |
| G6 | PASS, scoped | Measured CPU/partial GPU, safe two-request contention; NPU NOT TESTED |
| G7 | FAIL | v1: exact JSON-only contract violated. v2 (pre-registered Python workflow, 3 trials): 0/3 objectively correct; orchestration verified, model output not |
| G8 | PASS, scoped | Local-only synthetic execution and deterministic security/permission tests; not a formal audit |
| G9 | PASS | Full established command: 2,168 passed, zero failed, one unauthorized cloud-live test skipped |
| G10 | PARTIAL | Built Windows browser/Host integration and mobile rendering verified; timeout label fixed by unit test only (not re-checked in the built UI); installed release and native devices untested; dev parity blocked |
| G11 | PASS readiness only | Procedure prepared from official documentation; external activation **PENDING USER APPROVAL** |
| G12 | PENDING | Reports prepared; commit/push/PR/CI status follows verification |

Reports: [architecture audit](ARCHITECTURE_AUDIT.md), [inventory](LOCAL_MODEL_INVENTORY.md), [live inference](LIVE_INFERENCE_RESULTS.md), [routing benchmarks](ROUTING_BENCHMARKS.md), [hardware](HARDWARE_QUALIFICATION.md), [agent execution](AGENT_EXECUTION_EVIDENCE.md), [security](SECURITY_VALIDATION.md), [external readiness](EXTERNAL_PROVIDER_READINESS.md).

## Required next action

Remain within MA4-S1R. The 7B local coder does not reliably produce correct code, so a passing G7 needs either a stronger local model (the 27B/30B weights need more free RAM than was available) or user approval of an external model. Other remaining work: carry structured-output contracts through normal mission steps, improve production resource admission, then run broader held-out evaluations and installed Windows acceptance. No routing quality claim is justified by the current 4/9 versus 6/9 comparison. External qualification requires fresh explicit user approval of provider/model/downstream/data/quota scope; preparation does not activate it.
