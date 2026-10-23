# BUNNY A — MA4-S1R2 ENGINEERING REPORT

```text
Repository:            https://github.com/COMRADEART/bunny-A
Starting commit:       673cfa60886a292d0bf6ed282c87537d90ea3eac (ma4-s1r-live-qualification, PR #9 head)
Implementation branch: ma4-s1r2-hybrid-qualification (worktree ../bun-router-s1r2)
Final commit:          see PR #10 head
PR URL:                https://github.com/COMRADEART/bunny-A/pull/10 (draft, stacked on #9)
CI status:             checks job PASS (typecheck, MA4/routing/UI tests, both builds); regression job FAIL (hosted runner: 7 Windows
                       install/release-environment tests, which pass locally; core/team/MA4 stages not reached); security job
                       FAIL (pre-existing npm audit advisories). Run 39658679375 at a8d74c0.

LOCAL MODELS
  Discovered:          5 tags: qwen2.5-coder:7b, huihui_ai/qwen2.5-abliterate:7b, huihui_ai/Qwen3.8-abliterated:27b,
                       huihui_ai/qwen3-abliterated:30b (local); deepseek-v4.1-flash:cloud (cloud-backed, refused)
  Tested:              the two 7B models (27B/30B blocked by measured memory headroom; not loaded)
  Strongest qualified coding model: none qualifies for autonomous coding. qwen2.5-coder:7b passed 15/20 held-out G7
                       trials but 0/3 on the G7 v2 regression; abliterate 7B is statistically indistinguishable on benchmarks
  Reasoning model:     none qualified (math 0/6 for both)
  Tool-calling support: native loop implemented and broker-authorized; models emitted 0/12 tool calls
  Execution backend:   Ollama 0.40.6, CUDA partial offload (81.5% of 5.15 GB in VRAM) + CPU
  GPU utilization:     up to 65% sampled during benchmarks; 27.7–28.4 median tok/s
  NPU qualification:   Intel AI Boost detected; NOT TESTED (no NPU backend in Ollama; enabling needs approval)

HYBRID ROUTING
  Automatic routing:   functional, reliability-aware (Wilson lower bound per category); task analyzer coarse
  Manual pins:         hard filters; MODEL_PINNED refuses without a model; 23/23 G7 trials pin-exact
  Agent-specific pins: MA3 applySelection per role preserved; workflow pins come only from the orchestrator
  Local-first policy:  among eligible candidates only; AUTO_LOCAL / OFFLINE_ONLY exclude cloud and :cloud tags
  Cloud fallback authorization: workstation-issued, scoped approvals required in addition to config + consent;
                       none issued
  External inference performed: NO

MODEL BENCHMARKS
  Tasks:               18 dev (9 categories) + 9 held-out
  Samples:             3 per task (≈1 effective: temperature 0.2 seeded samples were near-identical)
  Correctness:         coder 27/54, abliterate 28/54 (dev)
  Automatic versus fixed: 21/27 vs 24/27 held-out; discordant 0 vs 3 (one task); sign test p=0.25 → no difference
  Latency:             median 1.0–1.2 s, max 7–12 s per answer
  Failure cases:       math, tool use, strict instruction following, one code-review item, handoff key naming

G7 AGENT QUALIFICATION
  Workflow:            Planner → contract → Worker ∥ Tester → static → sandboxed tests → Reviewer (advisory) → gate
  Tasks passed:        held-out 15/20 trials; v2 regression 0/3
  Tasks failed:        8 trials (v2×3, chunk×1, flatten×2, token bucket×2)
  Repair attempts:     19 (≤2 per trial); 3 passes needed a repair
  Reviewer false approvals: 1 (overridden by the deterministic gate); false rejections: 1
  Deterministic tests: every acceptance decided by sandboxed hidden + reference-validated tests
  Final G7 disposition: FAIL (pre-registered: needs held-out ≥14/20 AND regression ≥2/3)

SANDBOX
  Isolation backend:   WSL2 user/mount/pid/net/ipc/uts/cgroup namespaces + pivot_root + systemd user scope
  Filesystem restrictions: read-only /usr, private tmpfs root/work/tmp (noexec), no /mnt/c, /home, /run, /init
  Network isolation:   empty network namespace (loopback down)
  Resource limits:     cgroup memory (no swap) and pids; RLIMIT CPU/FSIZE/NOFILE/NPROC/CORE; wall-clock kill; output cap
  Cancellation cleanup: pid-namespace kill + scope kill; no orphans observed; workspace removed
  Adversarial tests:   12/12 live
  Final security disposition: PASS (scoped to this host; no seccomp; WSL distro is the trust root)

OLLAMA TOOLS
  Native tool calling: implemented (/api/chat tools) with schema validation, limits, timeouts, cancellation, receipts
  Permission enforcement: existing decide() broker; ask ≠ allow; unknown names never execute
  Unsupported models:  none by Ollama metadata; both runnable models unreliable in practice (0/12)

RELEASE QUALITY
  MA4 tests:           58 passed, 1 skipped (unauthorized cloud-live) locally; CI hosted runner 43 passed + 15 SKIPPED
                       (live WSL2 sandbox/workflow fixtures and cloud-live; skipped is not passed)
  Regression tests:    full `npm test` locally: 2,204 passed, 0 failed, 1 skipped (450 + 1,638 + 58 + 58)
                       first attempt failed 8 voice tests only (whisper runtime not staged in the new worktree; kept in
                       evidence/attempt-regression-1/)
  UI tests:            406/406
  Typecheck:           pass
  Desktop build:       pass
  Mobile build:        pass (shared mobile-web)
  CI:                  checks job PASS (typecheck, MA4/routing/UI tests, both builds); regression job FAIL (hosted runner: 7 Windows
                       install/release-environment tests, which pass locally; core/team/MA4 stages not reached); security job
                       FAIL (pre-existing npm audit advisories). Run 39658679375 at a8d74c0.
  Windows installed-app testing: NOT TESTED in this phase
  Physical mobile testing: NOT TESTED

CLOUD PROVIDERS
  Candidate shortlist: Groq openai/gpt-oss-120b, Groq qwen/qwen3.8-27b, OVHcloud gpt-oss-120b
  Preferred candidate: Groq openai/gpt-oss-120b
  Official free-tier verification: docs checked 2026-10-21 (limits account-specific; see shortlist)
  Approval request:    docs/ma4-s1r2/CLOUD_APPROVAL_REQUEST.md
  Approval status:     PENDING (owner confirmed: stays pending)
  Live external calls: NONE

ACCEPTANCE
  Gates passed:        R2-G1, G2, G3, G4, G5, G6, G8, G9, G10, G11, G13, G14
  Gates partial:       R2-G12 (configured and inspected; not green on hosted runners)
  Gates failed:        R2-G7
  Gates blocked:       none (cloud live qualification deferred by design)
  Outstanding risks:   see below

FINAL STATUS: PARTIAL

NEXT RECOMMENDED ACTION: decide on a stronger model for G7: either free ~12 GiB RAM for a bounded local 30B
(MoE) trial, or approve the Groq gpt-oss-120b request. Then re-run scripts/ma4-s1r2/g7.mjs unchanged with the new pin.
```

## Gate table

| Gate | Status | Evidence |
|---|---|---|
| R2-G1 | PASS | [ARCHITECTURE_AUDIT](ARCHITECTURE_AUDIT.md) |
| R2-G2 | PASS, scoped to the 2 runnable models | [LOCAL_MODEL_BENCHMARKS](LOCAL_MODEL_BENCHMARKS.md), `evidence/bench-dev.json` |
| R2-G3 | PASS | [HYBRID_ROUTING_DESIGN](HYBRID_ROUTING_DESIGN.md), `ma4-hybrid.test.ts`, G7 pin invariant |
| R2-G4 | PASS | [CLOUD_PROVIDER_SHORTLIST](CLOUD_PROVIDER_SHORTLIST.md), `ma4-cloud.test.ts` |
| R2-G5 | PASS | [SANDBOX_SECURITY_REPORT](SANDBOX_SECURITY_REPORT.md) |
| R2-G6 | PASS | same, 12/12 |
| R2-G7 | **FAIL** | [G7_QUALIFICATION_RESULTS](G7_QUALIFICATION_RESULTS.md) |
| R2-G8 | PASS | live false approval overridden; `ma4-workflow.test.ts` |
| R2-G9 | PASS | [OLLAMA_TOOL_CALLING_REPORT](OLLAMA_TOOL_CALLING_REPORT.md) |
| R2-G10 | PASS | approvals/privacy (`ma4-hybrid`), quota/429/402 (`ma4-cloud`, `ma4.test`), cancellation (sandbox F4.11, tools, workflow, G7 live) |
| R2-G11 | PASS | local `npm test` 2,204/0/1; UI 406/406; typecheck; mobile-web and desktop builds (`evidence/regression.log`, `build-*.log`) |
| R2-G12 | PARTIAL | [CI_VALIDATION](CI_VALIDATION.md); run 39658679375: checks pass, regression and security fail for documented environment/baseline reasons |
| R2-G13 | PASS | branch pushed, PR #10 stacked on #9, main checkout untouched |
| R2-G14 | PASS | [CLOUD_APPROVAL_REQUEST](CLOUD_APPROVAL_REQUEST.md), nothing activated |

## Outstanding risks

* Model quality: local 7B models cannot reliably code, use tools, or do arithmetic; the routing layer cannot fix that.
* The task analyzer is coarse, so reliability evidence affects only coding and structured-output routing.
* The sandbox trusts the WSL distribution. It has no seccomp filter and no cgroup CPU quota, and works only on Windows hosts with WSL2.
* Approvals have a store API but no Host UI route yet. That is intentional while external inference stays disabled.
* The MA4 line still needs the documented `package.json` union before it can merge into `main`. T14 + MA4 have never been tested together.
* **Dependency vulnerabilities (pre-existing, unchanged by this phase):** `npm audit --omit=dev` reports 7 production advisories, 5 critical (TanStack Start server/plugin packages) and 2 high (`vite` 8.3.0–8.3.2, `source-map-js`). Every fix is semver-compatible, so only the lockfile changes. The CI `security` job fails on this, deliberately. The fix was not applied here, because this worktree shares `node_modules` with the owner's main checkout. Recommended: run `npm audit fix` in an isolated checkout, then the full regression, as a separate change.
* Running `npm test` rewrites 32 tracked MA3 evidence files under `test-results/ma3/`. That is why the main checkout shows those modifications. This phase restored them in its worktree and never committed them. The test suite should write those files to a temporary location instead (separate fix).
* Voice tests (`scripts/voice-worker.test.mjs`) depend on the operator-staged whisper runtime and the Windows speech stack. They pass locally but are excluded from hosted CI.

## Evidence index (SHA-256 of working copies at report time)

| File | SHA-256 |
|---|---|
| `src/lib/bunny-host/ma4/sandbox-launcher.py` | `8839fce532b8f91210d0a79e4a0789b9c06c44cc5bd7e4ac616342e63027c989` |
| `src/lib/bunny-host/ma4/sandbox.server.ts` | `3422c29285265f8cc4fd445826750cfdb073c838992005f039c7491b923cd078` |
| `scripts/ma4-s1r2/bench-tasks.mjs` | `857d81dee09592e4f1aed7fd427d5ee4a979d5bbc7f4cfc6a045222a4ed85077` |
| `scripts/ma4-s1r2/g7-tasks.mjs` | `949d01934e93be644e9ca7735d839a81c3b6fc8fc68721904a032a48dc2f3210` |
| Node runtime LICENSE (local, ignored, not committed) | `148eacf7863ef4329224a29398623077200a27194aa075569faf4a0a85566ca5` |

Evidence JSON/logs are in `docs/ma4-s1r2/evidence/`. They are small, contain no credentials, and have local paths scrubbed. No model weights or private data are committed.
