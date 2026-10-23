# MA4-S1R4 — Security and regression (Phase J/K; R4-G9, R4-G10, R4-G13, R4-G14)

All local results come from the isolated worktree `bun-router-s1r4` (own `npm ci`, native builds, the pinned whisper
runtime and the Node runtime notice copied from the S1R3 worktree — both gitignored, never committed).

## Regression (local)

| Suite | Command | Result | Evidence |
|---|---|---|---|
| Stage 1 `scripts/*.test.mjs` | `npm test` | **454/454** | `regression.log` |
| Stage 2 Host/orch/missions/voice | `npm test` | **1,640/1,641** — 1 timing failure under load (below) | `regression.log` |
| Stage 3 agent runtime/team | stage-3 command from `package.json` | **58/58** | `regression-stage3.log` |
| Stage 4 MA4 (`test:ma4`, incl. 7 new S1R4 tests) | `npm run test:ma4` | **77 pass / 1 skipped** (opt-in paid-free live test) | `regression-stage4-ma4.log` |
| UI | `npm run test:ui` | **406/406** | `ui.log` |
| Typecheck | `tsc --noEmit` | **pass** | `typecheck.log` |
| Sandbox adversarial (live WSL2) | `ma4-sandbox.test.ts` | **13/13** | `sandbox-adversarial.log` |
| Desktop / mobile-web build | see ENGINEERING_REPORT | see ENGINEERING_REPORT | `build-*.log` |

**Stage 2 failure, disclosed:** `T12 native fault: blocked protocol writer exits within watchdog bound` (voice worker,
10.3 s, untouched by S1R4) failed once while 7B inference ran concurrently on the same host; it passes **3/3**
in isolation (`t12-watchdog-isolated.log`). Because `npm test` stops at the first failing stage, stages 3 and 4 were
run with their exact `package.json` commands (both green). Nothing was deleted or skipped.

**First regression attempt** (`regression-attempt1-missing-local-artifacts.log`): 8 stage-1 failures, all from two
gitignored local artifacts missing in the fresh worktree (pinned whisper runtime → 7 whisper tests; Node runtime
license notice → release packaging test). After staging both, stage 1 was 454/454.

## Security properties re-validated

| Property | Evidence |
|---|---|
| Seccomp, namespaces, filesystem, no network, quotas, process-tree cleanup | adversarial 13/13 (SANDBOX_VALIDATION) |
| Hard model pins | `pins: a served-model mismatch is a violation…`, `MA4 routing: … hard pins and no silent fallback`, `R4-G4/R4-G9 role assignment: pins … never substituted`; every G7/dev call records served model = pin |
| Cancellation | `MA4 cancellation…`, `cancellation stops the running tool and the loop`, `F4.11`, G7 cancellation invariant |
| Tool permissions | broker denial fails closed with zero executions; tool budget → `resource_exhaustion` (`ma4-s1r4.test.ts`) |
| Privacy-aware routing / local-only | `MA4 privacy/capabilities: sensitive, unapproved … rejected`; coding tasks profiled `local-only` |
| Cloud-provider denial | `B4 approvals are scoped…`, `B4 only the workstation issues approvals…`, `preflight denies … before any external call` |
| Host lifecycle cleanup | stage 2/3 Host tests (CI2 `boot()` close-on-failure) green |

## External inference — DISABLED (R4-G14)

* `ma4/registry.ts` and `ma4/cloud-candidates.ts` are byte-identical to `e93f5ae` (cloud adapters disabled, no models).
* Every S1R4 runner (`g7.mjs`, `run-set.mjs`, `benchmarks.mjs`, `load-probe.mjs`) installs a fetch allowlist for
  `127.0.0.1:11434` only and refuses `:cloud` tags; `externalRequestsRefused` = 0 in every evidence file.
* No prompt, source or artifact was sent to an external inference endpoint. Groq `openai/gpt-oss-120b` remains a
  PENDING proposal (S1R2 `CLOUD_APPROVAL_REQUEST.md`); see ENGINEERING_REPORT for the updated request.
* Exception, MA4-S1R4-G7C only (owner-approved, harness-scoped, not a Bunny A feature): 12 Worker/Tester requests with
  synthetic G7 v2 specs went to Groq `openai/gpt-oss-120b` on 2026-10-23; no hidden tests, references, project files or
  credentials were sent; the approval was revoked and the credential deleted afterwards. `registry.ts` and
  `cloud-candidates.ts` are unchanged, so general operation still has external inference DISABLED. See
  [G7C_CLOUD_QUALIFICATION](G7C_CLOUD_QUALIFICATION.md).

## Dependency audit

`npm audit --omit=dev` and `npm audit`: **0 vulnerabilities** each (`npm-audit-prod.log`, `npm-audit-all.log`); `package-lock.json` unchanged from `e93f5ae`. Zero-advisory baseline preserved.
