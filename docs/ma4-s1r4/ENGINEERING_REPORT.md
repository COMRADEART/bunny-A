# BUNNY A — MA4-S1R4 ENGINEERING REPORT

```text
BUNNY A — MA4-S1R4 INTELLIGENCE REPORT

Repository:   https://github.com/COMRADEART/bunny-A
Starting SHA: e93f5ae (merge of PR #13; tree identical to the #13 head 19bbdec, whose hosted CI run 39724249720 passed)
Final SHA:    see the draft PR head (branch below)
Branch:       ma4-s1r4-intelligence-leap (worktree ../bun-router-s1r4, own node_modules)
PR:           draft, base ma4-s1r3-agent-reliability (PR #13 is merged, so S1R4 stacks on its merge commit)
CI:           see "Hosted CI" below

INTELLIGENCE
  Adaptive decomposition:   deterministic task profile → typed, validated task graph (≤ 4 agents, acyclic, ≤ 12 nodes);
                            effort = 1–3 verified Worker samples by complexity; never more agents. Measured on 20 dev
                            trials: 11/20 in every configuration (= S1R3 baseline); first-attempt passes 10 → 11 (v3c)
  Task contract validation: immutable contract (spec, module, imports) frozen before Worker/Tester; Planner advisory;
                            schemas on every artifact; code artifacts via fenced transport (schema errors 5 → 0 on dev)
  Agent role assignment:    assignRole() from measured role evidence (Wilson lower bound), pins never substituted,
                            high-risk abstention; result: Planner/Worker/Reviewer coder 7B, Tester abliterate 7B
                            (differences not statistically significant)
  Evidence-guided repair:   S1R3 attribution + tool_failure/resource_exhaustion classes, Tester defect subtype,
                            repair hashes, identical-proposal stop; ≤ 2 rounds unchanged; valid tests never removed
  Deterministic tools:      static check, import smoke, per-test execution, schema validation, hash comparison and
                            sample ranking — all behind decide(), bounded (60/workflow), receipted, orchestrator-invoked
  Router improvements:      role-level evidence and abstention on top of the existing eligibility → soft-score router

MODELS
  Models discovered:   qwen2.5-coder:7b, huihui_ai/qwen2.5-abliterate:7b, huihui_ai/qwen3-abliterated:30b (MoE),
                       huihui_ai/Qwen3.8-abliterated:27b; deepseek-v4.1-flash:cloud refused (cloud tag)
  Models tested:       both 7B (frozen suite dev+held-out, 4 dev workflow runs, G7); 30B/27B load-probed only
  Best coding model:   none qualified; coder 7B = abliterate 7B on the workflow (Worker 13/20 each); suite 3/6 vs 4/6
  Best planning model: either 7B (Planner 20/20 each; suite 6/6 each)
  Best testing model:  abliterate 7B by a margin of one trial (Tester 16/20 vs 15/19)
  Best reviewer:       coder 7B (18/20 agree with the gate vs 14/20; abliterate made 6 false approvals, all blocked)
  Native tool calling: abliterate 6/6 on the S1R3 probe; coder 0/6; both 0 on the frozen suite's tool tasks
  CPU/GPU utilization: 7B at 76–82 % GPU / 18–24 % CPU split, ≈ 4.1 GiB VRAM peak, 24–30 tok/s
  NPU qualification:   NOT TESTED (Intel AI Boost present; no Ollama NPU backend)

G7 (frozen tasks, task hash aa5d5c19…4cb8, unchanged rules; one pre-registered decisive run)
  Original baseline:   S1R3 0/3
  New original result: 0/3 (all three fail one hidden case: '' must raise ValueError)
  Original threshold:  ≥ 2/3 — FAIL
  Held-out baseline:   S1R3 13/20 (S1R2 15/20)
  New held-out result: 17/20
  Held-out threshold:  ≥ 14/20 — PASS
  Repairs attempted:   11 rounds (14 targeted repairs)
  Successful repairs:  2 (1 Worker, 1 Tester); 2 Worker proposals identical → stopped
  False reviewer approvals accepted: 0 (2 false approvals, both blocked by the deterministic gate)
  FINAL G7 STATUS:     FAIL (v2 regression threshold not met; invariants 100 %)

PERFORMANCE
  Latency:      G7 call median 18.4 s / P95 57.4 s (S1R3 13.7 / 46.7 s); trial total +6.6 %
  Throughput:   median 23.7 tok/s in G7 (two models sharing 6 GiB VRAM); 28.8–30.7 tok/s single-model suite
  Memory:       7B loaded 5.15 GB (4.2 GB VRAM); 30B/27B exceed host headroom (RAM fell to 2.6 / 2.1 GiB)
  Additional inference calls: G7 118 vs 117 (+1); dev +1 to +12 per 20 trials, +7 to +23 % output tokens
  Resource bottlenecks: host RAM (another local workload swings RAM by up to 12 GB); 6 GiB VRAM forces model swaps

SECURITY
  Sandbox:                 unchanged; 13/13 adversarial live
  Seccomp:                 F5 pass
  Network isolation:       F4.3/F4.10 pass; runners localhost-only, 0 external requests
  Filesystem isolation:    F4.1/F4.5 pass
  Permission enforcement:  every workflow tool via decide(); denial fails closed with 0 executions
  Manual model pins:       23/23 G7 trials served = pin; pin tests green
  Cloud inference:         DISABLED

RELEASE
  MA4 tests:                 77 passed, 1 skipped (opt-in live) — 7 new S1R4 tests
  Full regression:           stage 1 454/454; stage 2 1,640/1,641 (1 voice-timing failure under load, 3/3 in
                             isolation); stage 3 58/58; stage 4 77/0/1
  UI tests:                  406/406
  Typecheck:                 pass
  Builds:                    desktop pass; mobile-web pass
  Dependency audit:          0 vulnerabilities (prod and all); lockfile unchanged
  Hosted CI:                 see below
  Installed Windows release: NOT TESTED
  Physical mobile testing:   NOT TESTED

GATES
  Passed:  R4-G1, G2, G3, G4, G5, G6, G8, G9, G10, G11, G13, G14
  Failed:  R4-G7 (G7 v2 0/3)
  Partial: none
  Blocked: none as a gate (27B/30B trials BLOCKED_RESOURCE_LIMIT; NPU NOT TESTED)
  Pending at writing: R4-G12 (hosted CI), R4-G15 (draft PR) — see below

FINAL STATUS: PARTIAL

NEXT RECOMMENDED ACTION: the owner chooses one of two ways to a stronger Worker, on the unchanged G7:
  (a) free ≈ 6 GiB host RAM (close applications or cap the WSL2 VM) and qualify huihui_ai/qwen3-abliterated:30b
      locally with load-probe.mjs then the S1R4 G7 command; or
  (b) answer docs/ma4-s1r4/CLOUD_APPROVAL_REQUEST.md (Groq gpt-oss-120b, Worker/Tester only, synthetic data, $0).
  Do not start MA4-S2 until one of them has been evaluated.
```

## Gate table

| Gate | Status | Evidence |
|---|---|---|
| R4-G1 repository and CI baseline | PASS | [ARCHITECTURE_AUDIT](ARCHITECTURE_AUDIT.md) |
| R4-G2 adaptive decomposition implemented and measured | PASS — no measured correctness gain on dev; simpler S1R3 path kept as default | [TASK_INTELLIGENCE_DESIGN](TASK_INTELLIGENCE_DESIGN.md) |
| R4-G3 tournament reproducible | PASS — dev suite identical to S1R3 per category | [LOCAL_MODEL_TOURNAMENT](LOCAL_MODEL_TOURNAMENT.md) |
| R4-G4 role assignments from measured evidence | PASS — measured, not statistically significant | [AGENT_ROLE_QUALIFICATION](AGENT_ROLE_QUALIFICATION.md) |
| R4-G5 repair preserves test integrity | PASS | [REPAIR_ENGINE_EVIDENCE](REPAIR_ENGINE_EVIDENCE.md) |
| R4-G6 tools behind permissions | PASS | [TOOL_AUGMENTATION_REPORT](TOOL_AUGMENTATION_REPORT.md) |
| **R4-G7 G7 v2 ≥ 2/3** | **FAIL (0/3)** | [G7_FROZEN_RESULTS](G7_FROZEN_RESULTS.md) |
| R4-G8 held-out ≥ 14/20 | **PASS (17/20)** | same |
| R4-G9 pins and privacy | PASS | [SECURITY_REGRESSION](SECURITY_REGRESSION.md) |
| R4-G10 sandbox adversarial | PASS (13/13) | [SANDBOX_VALIDATION](SANDBOX_VALIDATION.md) |
| R4-G11 performance/resources documented | PASS | [HARDWARE_RESOURCE_REPORT](HARDWARE_RESOURCE_REPORT.md), [ROUTING_BENCHMARKS](ROUTING_BENCHMARKS.md) |
| R4-G12 hosted CI green | see below | |
| R4-G13 builds and UI | PASS | `evidence/build-*.log`, `evidence/ui.log` |
| R4-G14 external inference disabled | PASS | [SECURITY_REGRESSION](SECURITY_REGRESSION.md) |
| R4-G15 draft PR and evidence | see below | |

## Phase notes

* **Phase G (Lotus memory): inspected, not integrated.** Lotus is implemented (`bunny-host/lotus*.ts`) for Personal
  Agent and Project scopes with trust layers; model capability records already have a bounded home
  (`ma4_reliability`). Integrating would store task outcomes in user-facing memory with no measured benefit, so S1R4
  does not, and claims no persistent-intelligence improvement.
* **Phase I (performance):** measured, not optimized for speed. Changes that reduce waste: identical repairs stop
  (G7 repair rounds 24 → 11), extra Worker samples run after Worker ∥ Tester so no request queues behind more than one
  other (a 4-min Tester timeout seen in v3 did not recur), models unloaded per trial, bounded context (contract +
  clipped previous artifact + attributed failures only). Costs: two-model routing raises call latency (+34 % median).
* **Process lessons (disclosed):** running the regression suite concurrently with inference starved RAM; the free-memory
  guard refused 26 dev trials, which were re-run alone (`--resume`, recorded). Another Claude session on this host
  runs a CPU probe that swings RAM by up to 12 GB; runners now wait (bounded, logged) instead of failing.
* **Not done:** the single-sample (k = 1) ablation and an "S1R4 + coder on every role" G7 run (both declared, time);
  hosted adversarial sandbox (no WSL2 on runners).

## Commits

See `git log e93f5ae..HEAD`: task graph · workflow strategy v3 · role assignment · tests · harness · v3b · runner
resume · v3c + memory wait · pre-registration · evidence and reports.
