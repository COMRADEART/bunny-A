# MA4-S3-T1 engineering report

## BUNNY A — MA4-S3-T1 FINAL REPORT

```text
REPOSITORY
  Base SHA: bc1c82df8f765e39b1bbb64191a08f3e09f00d95
  Final SHA: the tip of ma4-s3-t1-adaptive-intelligence that contains this report
  Branch: ma4-s3-t1-adaptive-intelligence
  PR: opened from that branch; not merged
  Hosted CI: not run for this branch yet
INTELLIGENCE
  Complexity classifier: deterministic C0–C3, Host baseline wins
  C0 direct tasks: 1 model call, no team
  C1 single-operation tasks: 0 model calls, one tool, deterministic check
  C2 multi-step tasks: Planner + Worker
  C3 complex tasks: Planner + Worker + Reviewer
  Model calls per task: 1 / 0 / 2 / 3 against a 4-role team
  Verified completion rate: not measured on live tasks
  Planning correctness: structural only
  Unnecessary agent invocations: removed from the C0 and C1 strategy
MODEL ROUTING
  Preference mode: onboarding model is used for local tasks and is not a hard pin
  Auto-local mode: smallest authorized local model, cloud pool refused
  Hard-pin mode: id and digest, mismatch selects nothing
  Served model identity: checked after selection
  Digest enforcement: fail closed when the pin digest is missing or different
  Unauthorized substitutions: 0 in the new tests
HARDWARE
  CPU: Intel Core Ultra 9 185H, 16 cores, 22 threads
  RAM: 33150328 KB visible
  GPU: NVIDIA GeForce RTX 4050 Laptop GPU
  Dedicated VRAM: 6141 MiB (nvidia-smi)
  NPU backend: Intel AI Boost device present, execution unconfirmed
  Ollama version: 0.40.9
  Supported models: local tags listed in the hardware audit; cloud tag not used
  Measured inference throughput: one prompt, cold 7383 ms, warm 356 ms, 39/61 CPU/GPU
PERFORMANCE
  Baseline latency: not measured on the old build
  Candidate latency: 7383 ms cold, 356 ms warm
  Improvement: not claimed
  Memory footprint: 6.8 GB resident for qwen2.5-coder:7b
  Peak VRAM: dedicated 6141 MiB; the model did not fit entirely
  Queue delay: not measured live
  Model loading: included in the cold figure
  Interactive responsiveness: unit-tested priority only
VERIFICATION
  Deterministic checks: file, process, tests, external write
  AI Reviewer usage: cannot replace those checks
  Unsupported verification claims: blocked unless performed_passed
  Replanning: bounded, approvals cleared
  Cancellation: P0 sorts first; in-flight preemption not claimed
  Recovery: uncertain writes are not retried
EVALUATION
  Development set: 55 synthetic, pass
  Frozen holdout: 45 synthetic, pass
  Adversarial set: policy cases, see ADVERSARIAL_VALIDATION.md
  Functional correctness: class labels only
  Verified end-to-end completion: not measured
  Failure analysis: preference and pin failures stop
SECURITY
  Cloud inference: disabled
  Hard pins: enforced when digest is supplied
  Host authority: unchanged
  Prompt injection: retrieved text stays data
  Approval integrity: replans clear approvals
  Cross-project isolation: reservations are not cleared across projects
  Unsafe actions: none added
QUALITY
  Typecheck: pass
  Unit tests: T1 file 7/7 pass; npm run test:ma4 266 pass, 0 fail, 2 skip
  Full regression: NOT TESTED
  Voice regression: NOT TESTED
  Windows installed smoke: NOT TESTED
  Hosted CI: NOT TESTED for this branch
GATES
  PASS: T1-G2 T1-G3 T1-G4 T1-G5 T1-G6 T1-G7 T1-G8 T1-G11 T1-G12 T1-G17 T1-G20
  PARTIAL: T1-G1 T1-G9 T1-G10 T1-G13 T1-G14 T1-G15
  FAIL:
  BLOCKED:
  NOT TESTED: T1-G16 T1-G18 T1-G19
FINAL STATUS:
  PARTIAL
CONTROLLED LOCAL PREVIEW:
  CONDITIONAL GO
PUBLIC BETA:
  NO-GO
NEXT MILESTONE RECOMMENDATION:
  Finish test:ma4, the natural-exit npm test, voice-worker, and hosted CI on the T1 head.
  Do not treat the synthetic class set as product completion.
  Re-measure C0/C1 latency on a pinned model against this same hardware before claiming the 15% target.
  Leave Android on-device inference, Lotus Memory, and background Windows toasts out of this line.
```

The conditional preview is the new routing and class behavior under test. It is not a release candidate. Public beta stays closed because signing, Android hardware, background toasts, diagnostics health, and this branch's CI are unresolved.
