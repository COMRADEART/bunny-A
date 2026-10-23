# BUNNY A — MA4-S2 ENGINEERING REPORT

```text
BUNNY A — MA4-S2 ENGINEERING REPORT

REPOSITORY
  Base commit:            e5006c5 (merge of PR #14 into ma4-s1r3-agent-reliability; hosted CI run 39866800595 green;
                          contains no G7C cloud harness — PRs #15/#16 are not a dependency)
  Implementation branch:  ma4-s2-adaptive-agent-intelligence (worktree ../bun-router-s2, own node_modules)
  Final commit:           ecdf84e (last code+evidence commit, hosted CI green); later commits are docs only
  PR:                     #17 (draft, not merged) https://github.com/COMRADEART/bunny-A/pull/17, base ma4-s1r3-agent-reliability
  Hosted CI:              run 39918572857 (pull_request, ecdf84e): all three jobs SUCCESS; push run 39918538258 SUCCESS

AGENT INTELLIGENCE
  Collaboration protocol: typed, versioned handoff (bunny-a.ma4-s2.handoff.v1), strict schema; hub-and-spoke through a
                          Host Coordinator; requirements hash checked on every message; pins, permissions, provider
                          authorization and acceptance cannot travel in a message; steering content downgraded to
                          untrusted data. 971 live handoffs, 0 refused, 0 tampering
  Adaptive delegation:    composeTeam (smallest covering team, ≤ 4 model roles; Coordinator/Researcher are Host roles)
                          + assignTeam (hard pins never substituted, Wilson-lower-bound evidence, local-first)
  Dynamic task graphs:    S1R4 validated task graph unchanged; S2 TeamRuns ledger: validated DAG (≤ 128 steps),
                          dependency-aware ready(), bounded concurrency, partial failure, controlled retry
  Agent concurrency:      memory-aware planSchedule: two 7B models (4.2 + 4.2 GiB) do not fit 6 GiB → grouped;
                          gateCalls bounds in-flight calls. Peak concurrency 1 (B/C) vs 2 (A); model loads 76 vs 88;
                          total load time 9.2 vs 23.6 min; call P95 31 s vs 76 s; same correctness (B 14/24 = A 14/24)
  Recovery and cancellation: start persisted before work; recover() retries reversible steps within budget; irreversible
                          in-flight steps become UNCERTAIN, never replayed; owner-only approve/decide; pause/resume/cancel
                          (deterministic tests). The held-out run used the ledger: 72/72 done, 0 resumes

LOTUS MEMORY
  Integration:            ExperienceMemory is an adapter over the existing LotusStore (no second memory system):
                          experience = inner-petal Host-trust records; skill pointers = central-bud records
  Storage:                local SQLite only; memory OFF by default (policy key ma4_s2_memory_v1); evaluation used an
                          isolated DB under %LOCALAPPDATA%\Bunny-A\ma4-s2-eval
  Retrieval:              scope filter → verified, unexpired, host/user trust, allowed sensitivity, content-hash match →
                          Lotus rank; precision@3 = 1.0 on the fixed corpus (deterministic test)
  Privacy:                Host facts only (status, kind, tags, categories) — no prompts, files, outputs, sources or
                          conversations; retention/expiry, prune, forgetScope; no transmission to external models
  Provenance:             every record carries source, trust, content hash, expiry; every guidance block is recorded
                          per role/phase by hash and source ids (skill:<id>, memory:<id>), never the text
  Context efficiency:     bounded (≤ 1,200 chars, ≤ 3 skills, ≤ 3 experience lines) but NOT efficient: +26 % prompt
                          tokens in arm C, mostly irrelevant procedures (one shared coarse tag sufficed for retrieval)

SKILL LEARNING
  Candidate skills:       9 extracted (train split only, public inputs only) → all 9 passed the security screen →
                          6 candidates (3 dropped: duplicate name ×2, candidate cap ×1)
  Skills validated:       4 SANDBOX_VALIDATED (slugify, parse-date-procedure, calculate-median, compute-median);
                          2 rejected in sandbox validation (merge-intervals-procedure, parse-csv-line)
  Skills promoted:        4 BENCHMARK_QUALIFIED on the qualify split (B 2/8 vs C 4/8, p = 0.25). 0 APPROVED, 0 ACTIVE
                          (owner-only; the harness never approves). The held-out run then showed no benefit
  Skills rejected:        5 (2 sandbox, 3 duplicate/cap)
  Rollback verified:      deterministic test only (quarantine → previous approved version returns); not exercised live
                          because no skill was ever approved
  Permission enforcement: skills limited to existing deterministic tools; any new tool/permission needs a named owner
                          approval; screening rejects steering, secrets, named models, acceptance tampering, new tools,
                          leaked test text (deterministic tests)

BENCHMARKS
  Baseline tasks passed:            A (frozen S1R4) 14/24 [0.39, 0.76]
  S2 collaboration tasks passed:    B 14/24 [0.39, 0.76]
  S2 memory-assisted tasks passed:  C 10/24 [0.24, 0.61]
  First-attempt accuracy:           A 11/24, B 11/24, C 7/24
  Final accuracy:                   A 58 %, B 58 %, C 42 %
  Latency:                          call median/P95 A 17.7/76.4 s, B 14.2/31.2 s, C 14.1/34.3 s;
                                    trial time total A 52.5, B 45.6, C 45.1 min
  Token/inference usage:            calls A 154, B 151, C 155; prompt tokens A 133k, B 118k, C 150k;
                                    output A 52k, B 45k, C 44k; ≈ 22 tok/s decode in all arms
  Statistical limitations:          12 held-out tasks × 2 trials per arm; C vs A 1 win / 5 losses (one-sided p = 0.98,
                                    two-sided ≈ 0.22); C vs B 2/6 (p = 0.96); B vs A 4/4 (p = 0.64). Pre-registered
                                    primary criterion (C ≥ A + 3 and p ≤ 0.10) NOT MET. All role-level comparisons
                                    unresolved (overlapping Wilson intervals). One run, one host, one model family

SECURITY
  Sandbox:                WSL2 userns/pivot_root/cgroup v2; adversarial F4.1–F4.11 + F5 seccomp 13/13 live
  Memory isolation:       project-scoped retrieval; model/untrusted/steering/expired/tampered/cross-project/personal
                          records never retrieved (tests); held-out run read-only
  Skill injection resistance: screening + advisory-only rendering after the contract; extraction sees public material only
  Tool permissions:       unchanged broker; skills cannot add tools or permissions
  Model pins:             held in every one of 110 live trials; hard-pin tests pass
  Cloud inference:        DISABLED — no S2 approval exists; revoked G7C-2 Groq key not reused; harness fetch allowlist
                          127.0.0.1:11434; 0 external requests

RELEASE
  MA4/S2 tests:           test:ma4 102 pass / 1 skip (opt-in live free-model contract, as on base) / 0 fail;
                          ma4-s2.test.ts 25/25
  Full regression:        npm test 2,255 pass / 1 skip / 0 fail (454 + 1,641 + 58 + 103). A first run had 1 flaky
                          failure in a pre-existing MA2 cleanup step (null process path, likely PID reuse); it passed
                          23/23 alone and in the full re-run; both logs kept
  UI tests:               406/406
  Typecheck:              pass
  Desktop build:          pass (JEV_DESKTOP_BUILD=1)
  Mobile build:           mobile-web build pass (automated web build only)
  Dependency audit:       0 vulnerabilities (prod and all); package-lock.json unchanged from base
  Hosted CI:              SUCCESS — run 39918572857 at ecdf84e (security; typecheck/MA4/UI/builds; full regression). WSL2 adversarial sandbox not available on hosted runners (reported SKIPPED there; 13/13 locally)
  Windows installed release: NOT TESTED
  Physical mobile qualification: NOT TESTED

GATES
  Passed:   S2-G1, G2, G3, G4, G5, G6, G7, G8, G9, G10, G11, G12, G13, G14, G15 (all 15)
  Failed:   none of the functional/safety gates; the pre-registered QUALITY criterion is NOT MET
  Partial:  none
  Blocked:  none

FINAL STATUS:
PARTIAL — functionally complete, intelligence improvement UNPROVEN (arm C 10/24 vs baseline 14/24; criterion not met)

NEXT RECOMMENDED ACTION:
Keep skills and S2 memory OFF in the product (they are off by default). Adopt only the measured win — the grouped,
memory-aware schedule (same correctness, −61 % load time, −59 % call P95) — after owner review. Any further skill-
learning attempt needs a new pre-registration and NEW held-out tasks (this set is spent): relevance-gated retrieval
(abstain unless ≥ 2 specific tags or an applicability predicate matches), content-level dedup, an extractor that
forbids task-specific algorithms, and a larger qualification split with a minimum effect size.
```

## Gate table

| Gate | Status | Evidence |
|---|---|---|
| S2-G1 current integration baseline verified | PASS | [ARCHITECTURE_AUDIT](ARCHITECTURE_AUDIT.md); base `e5006c5`, CI run 39866800595 |
| S2-G2 typed agent collaboration protocol validated | PASS | [AGENT_COLLABORATION_PROTOCOL](AGENT_COLLABORATION_PROTOCOL.md); 971 live handoffs, 0 refused |
| S2-G3 adaptive task delegation | PASS | [TASK_PLANNING_DESIGN](TASK_PLANNING_DESIGN.md) |
| S2-G4 Lotus integration preserves privacy and provenance | PASS | [LOTUS_MEMORY_INTEGRATION](LOTUS_MEMORY_INTEGRATION.md) |
| S2-G5 skill registry: validation, approval, rollback | PASS — rollback verified by deterministic test only | [SKILL_REGISTRY](SKILL_REGISTRY.md), [SKILL_PROMOTION_POLICY](SKILL_PROMOTION_POLICY.md) |
| S2-G6 untrusted skills gain no privileges | PASS | [SECURITY_VALIDATION](SECURITY_VALIDATION.md) |
| S2-G7 repair uses evidence without altering acceptance tests | PASS — G7 budget unchanged | [EXPERIENCE_REPAIR_ENGINE](EXPERIENCE_REPAIR_ENGINE.md) |
| S2-G8 memory-assisted planning evaluated against baseline | PASS (evaluated) — **result negative: C 10/24 vs A 14/24** | [INTELLIGENCE_EVALUATION](INTELLIGENCE_EVALUATION.md) §2 |
| S2-G9 new held-out evaluation reproducible | PASS — frozen task hash, pins, script, ledger; model sampling is stochastic, so outcomes vary between runs | same §1, `scripts/ma4-s2/` |
| S2-G10 correctness and resource results disclosed | PASS | [HARDWARE_PERFORMANCE](HARDWARE_PERFORMANCE.md), [MODEL_ROUTING_EVIDENCE](MODEL_ROUTING_EVIDENCE.md) |
| S2-G11 hard-pin, privacy and sandbox gates pass | PASS — sandbox 13/13 live | [SECURITY_VALIDATION](SECURITY_VALIDATION.md) |
| S2-G12 cloud inference disabled | PASS — 0 external requests | same |
| S2-G13 regression, UI, typecheck, builds | PASS — one pre-existing flaky cleanup disclosed | `evidence/regression-full.log`, `ui.log`, `typecheck.log`, `build-*.log` |
| S2-G14 hosted CI | PASS | run 39918572857 at `ecdf84e`, all jobs SUCCESS |
| S2-G15 draft PR and evidence published | PASS | draft PR #17, `docs/ma4-s2/` (13 documents + evidence) |
| **Pre-registered quality criterion** | **NOT MET** | INTELLIGENCE_EVALUATION §2.3 |

## Notes

* Nothing learned during S2 is active in the product: memory policy default OFF, 0 skills APPROVED/ACTIVE, no routing
  default changed, no foundation-model weights touched, no training on private data.
* The Groq/GPT-OSS adapter (PRs #15/#16) is not part of this branch or of production routing.
* G7 historical results are untouched; the frozen G7 workflow and repair budget are unchanged (S2 behaviour is opt-in).
* Process: inference and the regression suite never overlapped; the regression, UI tests and builds ran only after
  the held-out run finished. Rebuilt tracked binaries (`native/voice/*`) and a regenerated `routeTree.gen.ts`
  (line endings only) were restored, not committed.
