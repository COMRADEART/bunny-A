# MA4-S2 — Security validation

All existing MA4 boundaries are kept; S2 adds checks for the new surfaces (handoffs, memory, skills, run control).
Every row is a deterministic test in the suites run by `npm test` / `npm run test:ma4` (results in
`evidence/regression-full.log`, `evidence/ma4.log`), plus what the live evaluation observed.

| Required check | Test(s) | Live evaluation (110 trials across all phases) |
|---|---|---|
| Local-only restrictions | `ma4.test.ts` "MA4 privacy/capabilities…", "MA4 routing…"; `ma4-hybrid.test.ts` "B3 routing modes only add restrictions…" | harness fetch allowlist = `127.0.0.1:11434`; 0 external requests |
| Provider-specific approval | `ma4-hybrid.test.ts` "B4 approvals are scoped…", "B4 only the workstation issues approvals…"; `ma4.test.ts` "MA4 actual Host API: workstation-only…" | no approval exists for S2; none was used |
| Hard model pins | `ma4.test.ts` "MA4 routing… hard pins…", "MA4 model selection…", "MA4 exact-model constraints never escape…"; `ma4-s2.test.ts` "S2-G3/G11 assignment: pins are never substituted…"; `ma4-tools.test.ts` "served-model mismatch… fail closed" | `pinsHeld` invariant true in every trial; skill extraction enforces the served-model pin |
| Agent messages cannot change pins, permissions, provider authorization or acceptance | `ma4-s2.test.ts` "S2-G2/G6 protocol: pins, permissions and acceptance cannot travel in a message; tampering is refused…", "S2-G2 workflow: a tampered requirement hash stops the run before any model call" | 971 handoffs across all phases, 0 refused, 0 tampering |
| Sandboxed generated-code execution | `ma4-sandbox.test.ts` request validation, fail-closed, F4.1–F4.11 | every generated program ran in `wsl2-userns-pivot_root-cgroupv2` |
| Seccomp and namespace isolation | `ma4-sandbox.test.ts` "F5 seccomp (S1R3)…" | — |
| No-network sandbox policy | `ma4-sandbox.test.ts` "F4.3/F4.10 no external network, no DNS and no host services" | — |
| Memory poisoning | `ma4-s2.test.ts` "S2-G4 incorrect-memory resistance: model, untrusted, steering, expired, tampered, cross-project and personal records never reach retrieval"; "S2 prompt injection: steering content in a handoff is held as untrusted data…" | only Host-written experience and skill pointers existed |
| Cross-project memory leakage | same test (cross-project case); `ExperienceMemory.retrieve` filters by scope before ranking | evaluation scope `project:ma4-s2-eval`; isolated DB under `%LOCALAPPDATA%\Bunny-A\ma4-s2-eval` |
| Malicious skill injection | `ma4-s2.test.ts` "S2-G6 screening rejects steering, credentials, named models, acceptance tampering, new tools and leaked test text"; "S2 leakage: the extraction prompt carries only public material…" | all 9 extractions passed the security screen (3 later dropped as duplicate name or over the candidate cap); none requested a new tool |
| Unauthorized skill promotion | `ma4-s2.test.ts` "S2-G5 lifecycle: stages cannot be skipped; evidence is required; only the owner approves, activates or removes" | 0 skills APPROVED or ACTIVE; the harness never calls approve |
| Tool-call permission bypass | `ma4-s2.test.ts` "S2-G6 privilege: a skill that needs a new tool cannot be approved without naming that permission"; `ma4-tools.test.ts` unknown tools / permission denials / "ask is not treated as allow" | skills limited to `ma4.static_check`, `ma4.import_smoke`, `ma4.run_tests` |
| Cancellation and process cleanup | `ma4.test.ts` "MA4 cancellation…"; `ma4-s2.test.ts` "S2 concurrency gate… cancellation and timeout propagate", "S2-T7 restart safety… irreversible work in flight is never replayed"; `ma4-sandbox.test.ts` F4.9, F4.11 | models unloaded after every trial |
| Credential protection | `ma4.test.ts` "MA4 transport contract… secret redaction", "MA4 real Windows DPAPI…", "MA4 actual Host API… snapshots contain no secrets"; S2 screening rejects credential-like text in skills and memory (`looksSecret`) | no credential was loaded; the revoked Groq key was not reused |
| Reviewer cannot pass a failure | `ma4-s2.test.ts` "S2-G7 experience-guided repair… acceptance tests are never altered; Reviewer cannot pass a failure" | `gateIsAuthority` true in every trial; 13 Reviewer false approvals in held-out (A 3, B 4, C 6) were all overridden by the deterministic gate |
| Dependency audit | `npm audit --omit=dev` and `npm audit` | 0 vulnerabilities (both); `package-lock.json` unchanged from base `e5006c5` |

## Results

Local run on this branch after all inference had ended (nothing else running):

| Suite | Result | Log |
|---|---|---|
| `npm test` stage 1 (scripts) | 454/454 | `evidence/regression-full.log` |
| `npm test` stage 2 (MA3/Host/missions) | 1,641/1,641 | same |
| `npm test` stage 3 (agent runtime/teams) | 58/58 | same |
| `npm run test:ma4` (MA4 + S2) | 102 pass, 1 skip (opt-in live free-model contract, skipped as on the base), 0 fail | same, `evidence/ma4.log` |
| of which `ma4-s2.test.ts` | 25/25 | same |
| of which `ma4-sandbox.test.ts` (live WSL2, adversarial F4.1–F4.11, F5 seccomp) | 13/13, none skipped | same |
| `npm run test:ui` | 406/406 | `evidence/ui.log` |

A first full run had one failure (454 tests, 1 fail): the cleanup step of the MA2 test "MA2 T1 Windows controller:
after-host" (`scripts/bunny-state-migration.test.mjs`, unchanged by S2) queried a process whose executable path
was null — consistent with a reused PID — and threw in its `finally`. The file passed 23/23 alone and the whole
suite passed on the next full run. Both logs are kept (`regression-attempt1-flaky-cleanup.log`,
`regression-rerun-state-migration.log`). The flake is pre-existing harness code and is disclosed, not fixed here.

## Not covered

* No external penetration test or fuzzing campaign; the checks are the fixtures above.
* No installed Windows release was tested; physical phones were not tested.
