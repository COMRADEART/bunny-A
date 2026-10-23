# MA4-S2R1 — Engineering report

```text
BUNNY A — MA4-S2R1 ENGINEERING REPORT

REPOSITORY
  Base SHA:          b5271b1 (PR #17 head; #17 merged by the owner as 8867df4, identical tree)
  Final SHA:         code frozen at 006075f; later commits (1f51040, 6a7de67 and this report) change docs/ only
  Branch:            ma4-s2r1-memory-relevance
  PR:                #18 (draft) → ma4-s1r3-agent-reliability; MERGEABLE; not merged
  Hosted CI:         SUCCESS — run 39953466765 at 006075f (static security; typecheck/MA4/UI/builds; full
                     MA3/MA4 regression), also 39949051878 at 707ebea. Docs-only heads are re-run by CI on push

MEMORY RELEVANCE (held-out set, all 9 corpus skills offered to each of 16 tasks)
  Candidate skills:          144 candidate decisions (16 × 9)
  Eligible skills:           8 (all on the 6 applicable tasks; the median tasks have two near-duplicate skills)
  Rejected skills:           136, each with a recorded reason (missing metadata, operation, input, precondition,
                             category, tools, permissions, hash, scope, expiry, content screen)
  No-skill decisions:        10 of 16 tasks (all 4 near-miss, all 6 none)
  False-positive selections: 0 (deterministic: 0/10 tasks; model run: 0/20 trials in B and in C)
  Cross-project isolation:   retrieval scope-filtered; cross-project only with explicit authorizedScopes (tested)
  Token overhead:            B 3.45 %, C 5.63 % of prompt tokens (gate ≤ 5 %: B pass, C FAIL); ≤ 1 skill,
                             ≤ 320-character excerpt, ≤ 600-character block

SKILL QUALITY
  Approved skills:           0
  Active skills:             0
  Sandbox-validated skills:  4 attested (benchmark_qualified in the evaluation corpus), 5 rejected/unattested
  Rollback:                  verified in an isolated execution (S2R1-D2): next run and an already-built guidance
                             object both drop the rolled-back skill
  Permission enforcement:    skills needing ungranted tools/permissions rejected (S2R1-H); owner-only approval kept

EVALUATION
  New task count:            8 dev + 16 held-out (6 applicable, 4 near-miss, 6 none); S2 held-out not reused
  Trial count:               96 held-out (3 arms × 16 × 2), 16 dev; 0 invalid, 0 re-runs
  Arm A passes:              13/32 (Wilson 25.5–57.7 %)
  Arm B passes:              11/32 (20.4–51.7 %)
  Arm C passes:              7/32 (11.0–38.8 %)
  First-attempt correctness: A 8, B 8, C 5 of 32
  Final correctness:         A 41 %, B 34 %, C 22 %
  Paired statistical result: C vs A 1 win / 7 losses, −6, one-sided sign test p = 0.996 (task level p = 0.98);
                             C vs B −4 (p = 0.96); B vs A −2 (p = 0.89). Pre-registered C ≥ A + 4, p ≤ 0.10: NOT MET
  Latency:                   call median/P95 A 12.6/29.4 s, B 13.0/25.6 s, C 13.4/26.5 s; retrieval 3.7–11.2 ms
  Prompt-token overhead:     prompt tokens A 160k, B 161k, C 179k; injected B 5.6k (3.45 %), C 10.1k (5.63 %)
  Intelligence improvement proven: NO — UNPROVEN; skill and memory injection stay disabled

VOICE CI
  Original failing test:     T12 native fixture: continuous input and actual synthesis/null playback operate
                             concurrently inside F04 Job (run 39921539119, worker event timeout)
  Root cause:                capture.start attaches the turn's 250-frame queue, then loads the SAPI dictation
                             recognizer before the reader starts; a slow hosted load (> 5 s) overflows the queue, the
                             first Read throws BUFFER_LIMIT, reported as INTERNAL
  Fix:                       an unread queue keeps its newest 5 s (drops oldest) until the first Read; afterwards the
                             bound is unchanged; typed faults keep their code; richer timeout diagnostics; a
                             fixture-only recognizer-delay seam + regression test + selftest. No sleeps, skips or
                             --test-force-exit
  Targeted hosted result:    fix reverted (39948226063): fails with BUFFER_LIMIT; fixed (39948222512): duplex file
                             17/17 × 3, voice/*.test.ts 439/439
  Complete hosted regression: 39948222512 Stage 2 1,643 tests / 1,641 pass / 0 fail / 2 skip; ci run 39953466765 at
                             006075f all jobs SUCCESS
  Process cleanup:           "close leaves zero active Job processes" passes locally and hosted

SECURITY
  Sandbox:                   WSL2 userns/pivot_root/cgroup v2; adversarial F4.1–F4.11 pass live (hosted: SKIPPED,
                             no WSL2 user namespaces)
  Seccomp:                   F5 pass live
  Memory scope isolation:    project-scoped; cross-project, expired, model-trust, steering and forged-approval records
                             never retrieved (tests); held-out memory read-only
  Prompt injection resistance: content screen on every retrieval (steering, transfer, pin change, claimed authority);
                             hash binding; per-call re-check; advisory block placed after the contract
  Hard model pins:           held in all 96 held-out and 16 dev trials; S2 pin tests pass
  External inference:        DISABLED (0 external requests)

RELEASE
  MA4/S2 tests:              test:ma4 117 pass / 1 skip (opt-in live free-model contract, as on base) / 0 fail;
                             ma4-s2.test.ts 25/25, ma4-s2r1.test.ts 15/15
  Full regression:           npm test stages 454/454, 1,642/1,643, 58/58 (+ test:ma4 above). One pre-existing flaky
                             temp-folder cleanup (gpg helper, EPERM) disclosed; first attempt's 8 failures were missing
                             git-ignored local assets in the fresh worktree; all logs kept
  UI:                        406/406
  Typecheck:                 pass
  Desktop build:             pass (JEV_DESKTOP_BUILD=1)
  Mobile build:              mobile-web build pass (automated web build only)
  Security audit:            npm audit 0 vulnerabilities (prod and all); package-lock.json unchanged
  Hosted CI:                 SUCCESS (run 39953466765, code-identical to the final head)
  Installed Windows release: NOT TESTED
  Physical mobile:           NOT TESTED

ACCEPTANCE
  Passed:   R1-G1, G2, G3, G4, G5, G7, G8, G9, G11, G12, G13, G14, G15
  Failed:   R1-G10 (memory-assisted quality criterion not met)
  Partial:  R1-G6 (bounded and measured; arm C exceeded the 5 % overhead target)
  Blocked:  none

FINAL STATUS:
PARTIAL — retrieval is now selective and safe (0 false positives, no-skill by default), voice CI fixed and hosted CI
green; intelligence improvement UNPROVEN (arm C 7/32 vs baseline 13/32)

NEXT RECOMMENDED ACTION:
Keep skill and memory injection OFF (the default). Adopt the voice fix and the relevance gate as safety infrastructure
after owner review. Do not tune retrieval further against this team: three runs (S2, S2R1 dev, S2R1 held-out) show
injected content lowering pass rates while selection is correct. A future attempt should change the content, not the
selection — Host-verified, contract-agnostic procedures (or none), and experience records that state an actionable
cause — under a new pre-registration with new held-out tasks.
```

## Gate table

| Gate | Status | Evidence |
|---|---|---|
| R1-G1 repository and original evidence verified | PASS | [REPOSITORY_AUDIT](REPOSITORY_AUDIT.md); S2 evidence untouched |
| R1-G2 broad-tag-only selection eliminated | PASS | [RELEVANCE_GATE_EVIDENCE](RELEVANCE_GATE_EVIDENCE.md) §1, [RETRIEVAL_ROOT_CAUSE](RETRIEVAL_ROOT_CAUSE.md) |
| R1-G3 hard applicability and trust filtering | PASS | [SKILL_APPLICABILITY_DESIGN](SKILL_APPLICABILITY_DESIGN.md), [NEGATIVE_RETRIEVAL_TESTS](NEGATIVE_RETRIEVAL_TESTS.md) |
| R1-G4 irrelevant and malicious injection blocked | PASS | same; [SECURITY_VALIDATION](SECURITY_VALIDATION.md) §1; held-out FP 0/20 |
| R1-G5 no-skill fallback | PASS | RELEVANCE_GATE_EVIDENCE §4; 10/16 held-out tasks, prompts identical to arm A |
| R1-G6 retrieval context bounded and measured | **PARTIAL** — bounds enforced; C 5.63 % > 5 % target (B 3.45 %) | [CONTEXT_EFFICIENCY](CONTEXT_EFFICIENCY.md) |
| R1-G7 skill lifecycle and approval controls preserved | PASS | [SKILL_ROLLBACK_VALIDATION](SKILL_ROLLBACK_VALIDATION.md) |
| R1-G8 grouped scheduler retains correctness and resource benefits | PASS — schedule unchanged by retrieval (S2R1-E: same calls, order, pins, concurrency 1; peak concurrency 1 in all 96 trials); the resource benefit itself was measured in S2 and not re-measured | `ma4-s2r1.test.ts`, INTELLIGENCE_EVALUATION §5 |
| R1-G9 new held-out tasks and criteria pre-registered | PASS | [NEW_BENCHMARK_PREREGISTRATION](NEW_BENCHMARK_PREREGISTRATION.md), `707ebea` before any model run |
| R1-G10 memory-assisted quality criterion met | **FAIL** | [INTELLIGENCE_EVALUATION](INTELLIGENCE_EVALUATION.md) §2 |
| R1-G11 safety, pins and sandbox controls pass | PASS | SECURITY_VALIDATION §3 |
| R1-G12 hosted voice-test failure diagnosed and resolved | PASS | [VOICE_CI_ROOT_CAUSE](VOICE_CI_ROOT_CAUSE.md) |
| R1-G13 full hosted CI passes on final code | PASS | run 39953466765 at `006075f`; later commits docs-only |
| R1-G14 UI and builds pass | PASS | `evidence/ui.log`, `build-*.log`, `typecheck.log` |
| R1-G15 draft PR and evidence published | PASS | draft PR #18; `docs/ma4-s2r1/` (13 documents + evidence) |

## Notes

* Functional qualification and the intelligence result are reported separately; the functional gates passing does not
  imply any quality improvement.
* Benchmark receipts (`evidence/dev.json`, `evidence/heldout.json`) record per trial: model pins and served models,
  evaluator (independent acceptance tests run in the sandbox), task-set version and hash, retrieved skill/memory ids and
  each guidance block's hash and size, prompt/output tokens, call latencies and model loads. Generated sources are
  kept (≤ 1.3 kB each); no prompts, credentials or personal data are stored.
* Process: inference and the regression never overlapped. Rebuilt tracked binaries (`native/voice/*`) and the
  regenerated `routeTree.gen.ts` were restored, not committed.
* Temporary hosted-diagnosis branches (`ci-diag/s2r1-voice-fixed`, `ci-diag/s2r1-voice-prefix`) were deleted after use;
  their run ids are kept above.
