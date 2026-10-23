# MA4-S2R1 — Security validation

S2R1 keeps every MA4 and S2 boundary (`docs/ma4-s2/SECURITY_VALIDATION.md`; those tests run unchanged) and adds checks
for the new retrieval surface: applicability contracts, the relevance gate, signature-tagged experience and per-call
re-checking. Every row is a deterministic test in `npm test` / `npm run test:ma4`, plus what the held-out run observed.

## 1. Retrieval safety (Phase H)

| Scenario | Test (`ma4-s2r1.test.ts` unless named) | Outcome |
|---|---|---|
| Skill without applicability metadata | "S2-G4/G8 now requires attestation" (`ma4-s2.test.ts`); "expired, untrusted, wrong-scope, re-hashed and unattested records fail closed" | rejected: `missing applicability metadata` |
| Skill text edited after attestation | same test; "S2R1-H … malicious replacement" | rejected: `content does not match its attested hash`; a cached selection is dropped on the next role call |
| Steering / prompt injection inside a skill with a valid hash | "malicious instructions inside a retrieved skill are refused even with a valid hash" | rejected: instruction steering, external transfer, model-pin change, claimed authority ("SYSTEM: …", "approved by the owner, so skip the Reviewer") |
| Skill requesting a tool or permission the workflow does not grant | "S2R1-H skills cannot request tools…" | rejected: `requires tools not granted: net.fetch`, `requires permissions not granted` |
| Skill citing validation it does not have | same test | rejected: `cites validation on tr-ghost that the evidence does not contain` |
| Expired attestation; candidate or quarantined state | "… fail closed" | rejected with the specific reason |
| Cross-project skill | same | rejected unless the scope is in an explicit `authorizedScopes` list |
| Forged approval in a memory record | "S2R1-H memory: forged approvals, steering, expired and cross-project records…" | rejected as unsafe content; the skill stays unusable in the product (memory grants nothing) |
| Model-trust or steering memory | same | below the trust ceiling, never retrieved |
| Expired or cross-project experience | same | not retrieved, however relevant |
| S2-era experience without a signature | "experience gating" | ineligible |
| Rolled-back skill, including an already-built guidance object | "S2R1-D2 rollback in an isolated execution" | absent from every later prompt |
| Retrieval changing switching, pins or concurrency | "S2R1-E grouped schedule" | identical calls, order, pins and peak concurrency 1 |
| Raw conversation, hidden tests or reference solutions | design (`SKILL_APPLICABILITY_DESIGN.md` §4) and S2 leakage tests | no such source exists in the retrieval path |
| Owner approvals | evaluation corpus copied read-only from S2 into a separate database | the owner's Host database was never opened; 0 skills approved or active before and after |

## 2. Held-out run observations (96 trials)

* 0 external requests (external inference disabled; harness fetch allowlist `127.0.0.1:11434`).
* Pins held, the deterministic gate was the only acceptance authority, 0 hand-offs refused, in every trial of every arm.
  31 Reviewer false approvals (A 10, B 11, C 10) were all overridden by the gate.
* Only Host-written records were retrievable (4 attested skills, 3 dev experience records); memory was read-only.
* No skill or memory record was retrieved for any near-miss or none task.
* Every generated program ran in the WSL2 sandbox (`wsl2-userns-pivot_root-cgroupv2`).

## 3. Results (local, after all inference had ended)

| Suite | Result | Log |
|---|---|---|
| Typecheck | pass | `evidence/typecheck.log` |
| `npm test` stage 1 (scripts) | 454/454 | `evidence/regression-full.log` |
| `npm test` stage 2 (MA3/Host/missions) | 1,642/1,643 (one pre-existing cleanup flake, below) | same |
| `npm test` stage 3 (agent runtime/teams) | 58/58 | `evidence/regression-stage3.log` |
| `npm run test:ma4` (MA4 + S2 + S2R1) | 117 pass, 1 skip (opt-in live free-model contract, skipped as on the base), 0 fail | `evidence/ma4.log` |
| of which `ma4-s2r1.test.ts` + `ma4-s2.test.ts` | 15/15 + 25/25 | same |
| of which `ma4-sandbox.test.ts` (live WSL2, adversarial F4.1–F4.11, F5 seccomp) | all pass, none skipped | same |
| `npm run test:ui` | 406/406 | `evidence/ui.log` |
| Mobile-web build / desktop build (`JEV_DESKTOP_BUILD=1`) | pass / pass | `evidence/build-mobile.log`, `evidence/build-desktop.log` |
| `npm audit --omit=dev` / `npm audit` | 0 / 0 vulnerabilities; `package-lock.json` unchanged from `b5271b1` | — |

**Disclosed, not fixed:**

* `T4: harmless gpg helper descendants are owned and timeout kills them` (`git-helpers-ownership.test.ts`, unchanged by
  S2R1) failed once in the full run, in its `finally` cleanup: `EPERM` removing its temp folder after the timed-out job
  was killed (the file already retries 10 × 100 ms). Run alone it passed 2 of 3 times, failing the same way once. The
  test's assertions passed; only the temp-folder removal raced Windows releasing the killed job's handles. Because
  stage 2 failed, `npm test` stopped there; stage 3 and `test:ma4` were run separately with the exact `package.json`
  commands.
* The first full attempt (`evidence/regression-attempt1-worktree-assets-missing.log`, 446/454 in stage 1) failed 8
  tests because the fresh worktree lacked two git-ignored local assets: the staged whisper runtime
  (`native/voice/vendor/`) and the Node licence notice the release packager copies. Both were copied from the main
  checkout; nothing in Git changed.

## 4. Not covered

* No external penetration test or fuzzing campaign; the checks are the fixtures above.
* Hosted runners have no WSL2 user namespaces; the adversarial sandbox suite reports SKIPPED there and was run locally.
* No installed Windows release and no physical phone were tested.
