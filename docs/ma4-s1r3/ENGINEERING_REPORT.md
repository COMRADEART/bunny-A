# BUNNY A — MA4-S1R3 ENGINEERING REPORT

```text
STARTING STATE
  Repository:   https://github.com/COMRADEART/bunny-A
  Base commit:  5d92fea (PR #11 head: lockfile-only dependency fix, stacked on #10 472fd61)
  Branch:       ma4-s1r3-agent-reliability
  Worktree:     ../bun-router-s1r3 (own node_modules, native builds and evidence; main checkout untouched)
  Final commit: see the draft PR head (stacked on #11)
  PR:           draft, base ma4-s1r2-deps-audit (#11)
  CI:           run 39672749567 (at 3724349): security SUCCESS, checks SUCCESS (typecheck, MA4 incl. repair suite, routing,
                UI, both builds); regression: see "Hosted CI" below

AGENT REPAIR
  Root cause:          S1R2 had one repair target (the Worker) and no attribution step. Invalid Tester tests, Tester
                       import violations, zero valid tests and metadata-format errors were all "repaired" by regenerating
                       a correct implementation (v2 t2, p2-bucket t2, s2-chunk t1; S1R2 evidence read per attempt)
  Fault attribution:   attributeAttempt(): deterministic, from static checks per file, the independent acceptance suite
                       and Tester tests run against the frozen reference (oracle); ambiguous without an oracle → diagnosis,
                       no blind repair; typed FailureRecord per cause
  Tester repair:       routed on oracle-proven invalidity (incl. latent invalid tests under the all-pass rule); the Tester
                       sees its own failing line + exception type, never the implementation, reference values or hidden tests
  Worker repair:       only failures proven to be the Worker's; invalid tests are never fed to it; valid tests are never
                       rewritten to fit wrong code
  Retry bounds:        ≤ 2 rounds per trial shared by Planner/Worker/Tester; one round may repair Worker ∥ Tester; clean stop
  Repair success:      run 2: Worker 3/19 rounds resolved, Tester 1/7, Planner 1/1; 4 trials passed only after repair
  Reviewer false approvals: run 2: 3 (all blocked by the deterministic gate); run 1: 0; false rejections 1 each

LOCAL MODELS
  Discovered:          qwen2.5-coder:7b, huihui_ai/qwen2.5-abliterate:7b, huihui_ai/Qwen3.8-abliterated:27b,
                       huihui_ai/qwen3-abliterated:30b; deepseek-v4.1-flash:cloud refused (cloud)
  Tested:              both 7B models (benchmarks, tool probes); coder 7B for G7 (pre-registered pin)
  Best coding model:   none qualified; coder 7B ≈ abliterate 7B (bench programming 3/6 vs 4/6)
  Best planning model: either 7B (planning 6/6) — adequate for plans, not for the workflow as a whole
  Best test-generation model: none qualified (Tester repairs 1/7 resolved)
  Tool-calling model:  huihui_ai/qwen2.5-abliterate:7b demonstrated 6/6 native calls on the S1R3 probe set; coder 7B 0/6
                       (writes calls as JSON text; prose is never parsed as a tool call)
  Resource limits:     27B and 30B BLOCKED_RESOURCE_LIMIT (need ≈ 16 GiB host RAM incl. guard; 10.7 GiB available);
                       Ollama 0.40.6 runner grew to 12.9 GiB private during G7 run 2 → host low-memory stop, resumed
  GPU execution:       CUDA partial offload (RTX 4050 6 GiB), ≈ 30 tok/s on 7B
  NPU execution:       NOT TESTED (no Ollama NPU backend)

G7 VALIDATION (pin qwen2.5-coder:7b on every role; frozen tasks, task hash = S1R2)
  Original v2 trials:  3 (run 2, decisive) — also 3 in run 1
  Original v2 passes:  0 (run 2); 0 (run 1)
  Held-out trials:     20 (run 2) — also 20 in run 1
  Held-out passes:     13 (run 2); 13 (run 1); S1R2 reference 15
  Independent test results: every decision by sandboxed hidden tests + oracle-validated Tester tests; invariants 100%
                       (pins, ordering, gate authority, cancellation) in both runs
  Failed cases:        run 2: v2 ×3 (2 malformed Tester repairs, 1 Worker), s1-anagram t2, i1-roman t2, i2-kv ×2,
                       d1-flatten t2, p2-bucket ×2
  Repair attempts:     run 2: 24 rounds; run 1: 15
  G7 FINAL STATUS:     FAIL (R3-G7 0/3 < 2/3; R3-G8 13/20 < 14/20)

SANDBOX
  Isolation:           WSL2 user/mount/pid/net/ipc/uts/cgroup namespaces, pivot_root, read-only root (unchanged)
  Network boundary:    empty network namespace (unchanged; F4.3/F4.10 pass)
  Filesystem boundary: no host/Windows/home mounts; noexec size-capped tmpfs; workspace discarded (F4.1/F4.5 pass)
  Resource limits:     cgroup memory/pids, RLIMIT CPU/FSIZE/NOFILE/NPROC/CORE, wall clock, output cap (F4.6–F4.9 pass)
  Seccomp qualification: IMPLEMENTED — unprivileged seccomp-BPF deny-list (namespaces incl. clone flags, mount APIs,
                       ptrace, keyrings, bpf, io_uring, perf, module/kexec/clock…); foreign ABI killed; probe requires it
  Adversarial tests:   13/13 live (12 S1R2 + F5 seccomp; F5 fails against the previous launcher)
  Security status:     PASS, scoped to this host (WSL distro remains the trust root; deny-list, not allow-list)

RELEASE
  MA4 tests:           70 passed, 1 skipped (unauthorized cloud-live)
  Regression tests:    npm test 2,216 passed, 0 failed, 1 skipped (450 + 1,638 + 58 + 70)
  UI tests:            406/406
  Typecheck:           pass
  Desktop build:       pass
  Mobile build:        pass (shared mobile-web)
  Windows installed app: NOT TESTED (no approval to touch the installed app; fixture-level release tests pass)
  Physical mobile devices: NOT TESTED
  Hosted CI:           security SUCCESS; checks SUCCESS; regression — see "Hosted CI" below. The 7 Windows failures
                       are root-caused (8.3 short TEMP on runners) and fixed (7/7 reproduced locally, 0 after the fix)
  Dependency vulnerabilities: 0 (npm audit, prod and all); lockfile unchanged from 5d92fea

CLOUD
  Candidate:           Groq — openai/gpt-oss-120b
  Approval status:     PENDING
  External inference calls: ZERO (all runners enforce a localhost-only fetch allowlist; 0 refused requests recorded)

GATES
  Passed:  R3-G1, G2, G3, G4, G5, G6, G9, G10, G12, G13, G14, G15
  Failed:  R3-G7 (v2 0/3), R3-G8 (held-out 13/20)
  Blocked: none as a gate; 27B/30B model trials BLOCKED_RESOURCE_LIMIT
  Partial: R3-G11 (hosted CI) until the hosted regression job is green on the final head

FINAL STATUS: PARTIAL

NEXT RECOMMENDED ACTION: qualify a stronger model on the unchanged G7 benchmark. Either free ≈ 6 GiB of RAM (close
apps or cap the WSL2 VM memory) and run `G7_PIN=huihui_ai/qwen3-abliterated:30b G7_OUT=… node --experimental-strip-types
scripts/ma4-s1r2/g7.mjs`, or explicitly approve the Groq gpt-oss-120b request (docs/ma4-s1r2/CLOUD_APPROVAL_REQUEST.md).
Before that, have Tester repairs return only the replaced test methods (output budget).
```

## Gate table

| Gate | Status | Evidence |
|---|---|---|
| R3-G1 repository and branch verified | PASS | [REPOSITORY_AUDIT](REPOSITORY_AUDIT.md) |
| R3-G2 fault-aware repair implemented and tested | PASS | [AGENT_REPAIR_DESIGN](AGENT_REPAIR_DESIGN.md); `ma4-repair.test.ts` 10 + `ma4-workflow.test.ts` 6 (live sandbox) |
| R3-G3 Tester failures route to the Tester | PASS | unit/live tests; G7 run 2: 7 Tester rounds, 0 Worker rounds spent on Tester faults |
| R3-G4 Worker failures route to the Worker | PASS | unit/live tests; a valid failing test is never rewritten |
| R3-G5 Reviewer cannot override failed tests | PASS | 3 live false approvals blocked (run 2) |
| R3-G6 sandbox security enforced | PASS | [SANDBOX_SECURITY_REVIEW](SANDBOX_SECURITY_REVIEW.md), 13/13 + seccomp |
| R3-G7 original G7 v2 ≥ 2/3 | **FAIL** (0/3) | [G7_REGRESSION_RESULTS](G7_REGRESSION_RESULTS.md) |
| R3-G8 held-out ≥ 14/20 | **FAIL** (13/20) | same |
| R3-G9 manual pins 100% | PASS | 46/46 G7 trials pin-exact; routing tests |
| R3-G10 benchmarks reproducible | PASS | [MODEL_QUALIFICATION](MODEL_QUALIFICATION.md): identical per category |
| R3-G11 hosted CI mandatory jobs pass | PARTIAL | [WINDOWS_CI_REMEDIATION](WINDOWS_CI_REMEDIATION.md), [RELEASE_QUALIFICATION](RELEASE_QUALIFICATION.md) |
| R3-G12 dependency audit clear | PASS | [DEPENDENCY_SECURITY](DEPENDENCY_SECURITY.md) |
| R3-G13 desktop and mobile builds pass | PASS | `evidence/build-*.log`, CI checks job |
| R3-G14 PR published without modifying the existing checkout | PASS | draft PR; main checkout untouched |
| R3-G15 external inference disabled | PASS | registry/candidates unchanged; CI check; allowlists |

## New versus carried-forward evidence

New in S1R3: everything under `docs/ma4-s1r3/evidence/` (two G7 runs, tool probes, benchmark re-run, CI reproductions, sandbox runs, regression, UI, builds, audits, decode-time pattern probe). Carried forward unchanged: the S1R2 frozen task set, benchmark suite, hardware inventory method, cloud shortlist and approval request. Historical evidence (`docs/ma4-s1r2/evidence/`, `test-results/ma3/`) was not modified.

## Commits (logical units)

`b07d6aa` CI temp canonicalization · `611c37f` fault-aware repair · `31f9919` G7 pre-registration + output path · `56553a1` MA3 evidence isolation · `dfaba3e` demonstrated tool-call capability · `eb84796` run-2 rule · `3724349` latent invalid tests / rejected structured replies · `9548eac` seccomp · `5d223d5` runner resume + unload · docs/evidence commit.

## Hosted CI

Recorded at PR creation. See the PR description for the final job conclusions.
