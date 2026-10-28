# MA4 final closure (MA4-R2)

Date: 2026-10-28. Repository: `COMRADEART/bunny-A`, branch `main`.

This document closes MA4 **engineering integration**. It is not a beta, release or store qualification. Every PASS
below names observed evidence; anything not performed is PARTIAL, BLOCKED or NOT TESTED.

## 1. Decision

| Scope | Decision |
|---|---|
| MA4 engineering integration | **PASS** — `main` contains both post-merge repairs and every required hosted check passed on the merged commit (§3). |
| MA4 product qualification | **PARTIAL** — see the audit in §6. Routing intelligence gains are unproven, the candidate 24 h soak verdict was never recorded, and physical, signing and store gates are still open. |
| Public beta / store | **NO-GO** (unchanged from MA4-S3-T5). |

## 2. Final `main` and PR lineage

Final `main` commit: **`1b9f201abcc78cb2b6faf403cdfd88323a7f1f6e`**. Both repairs are present:
`tests/native-companion.test.ts` has one "Android Companion 9" test, and `src/lib/bunny-host/ma4-s2t2-fixtures.ts:61` has
`maintenanceMs: 10_000`.

| PR | Base | Merge commit | What |
|---|---|---|---|
| #53 | main | `946f5c6` | Native Android companion |
| #52 | main | `70040ee` | Native Windows Host client; merged ~1 min after its own CI went red; `main` CI run 40588739815 **failed** |
| #54 | main | `eeaac56` | better-auth 1.7.14 (GHSA-q84f-53jg-9ppm) |
| #55 | main | `a2086f5` | Repair 1: native-companion test file |
| #56 | `ma4-r1-post-merge-regression-repair` | `4ca4153` | Repair 2: lease heartbeat. It merged into the repair branch, **not** `main`. |
| #57 | main | `1b9f201` | Repair 2 brought into `main` (cherry-pick of `cec10c3`) + regression test T2-X20 |

## 3. Hosted CI

| Run | Commit | Result |
|---|---|---|
| [40588739815](https://github.com/COMRADEART/bunny-A/actions/runs/40588739815) | `70040ee` (#52 merge) | failure (stage 3: native-companion test file did not parse) |
| [40597809898](https://github.com/COMRADEART/bunny-A/actions/runs/40597809898) | `a2086f5` (#55 merge) | success |
| [40627088603](https://github.com/COMRADEART/bunny-A/actions/runs/40627088603) | `5618934` (#57 head) | attempt 1: security ✅, regression ✅, checks ❌ (DPAPI timeout, §5); attempt 2 checks ✅ |
| [40630772546](https://github.com/COMRADEART/bunny-A/actions/runs/40630772546) | `1b9f201` (#57 merge, final `main`) | **success, attempt 1**, all three jobs (checks: `test:ma4` 294 + 24 skip, routing 69/69, UI 421/421; regression: 392/392, 1,677 + 2 skip, 63/63, 295 + 23 skip; security pass) |

Native workflows (both path-filtered; they do not run on pushes to `main`):

| Run | Commit | Result | Tree on `1b9f201` |
|---|---|---|---|
| [40588549304](https://github.com/COMRADEART/bunny-A/actions/runs/40588549304) native-windows-preview | `a3967da` | success | `native/windows/**` + workflow byte-identical (`git diff a3967da 1b9f201` empty) |
| [40582198603](https://github.com/COMRADEART/bunny-A/actions/runs/40582198603) native-android-preview | `a78ae88` | success | `android/**`, both Android scripts + workflow byte-identical |

## 4. The two regressions

**R1 — native-companion test file (fixed by #55).** #52 and #53 both added `tests/native-companion.test.ts`. The add/add
conflict resolution in merge `a3967da` left an unclosed duplicate "Android Companion 9" test header, so stage 3 of
`npm test` could not parse the file. #52 was merged about a minute after its PR CI went red. #55 removed the duplicate.

**R2 — T2-W1 lease lapse (fixed by #56, integrated by #57).** The ma4-s2t2 test rig ran `PersistentTaskRuntime` with
`maintenanceMs: 60_000` against the default 30 s lease. `maintain()` is the only lease heartbeat, so any step that took
more than 30 s of real time (a cold Chromium launch on a slow runner) outlived its lease. The worker's next commit threw
`StaleLeaseError` and the task stayed `RUNNING`. Fix: rig heartbeat 10 s; the lease TTL is unchanged. This is test-fixture
only; production keeps its 5 s default heartbeat. #57 also adds **T2-X20**, which holds one step for 40 s of fake time
(fake clock plus mocked `setInterval`, ~60–600 ms real). It passes with 10 s and fails with `RUNNING` with 60 s (negative
control run locally). T2-X15 (lease takeover) still passes.

**Process cause, now closed (§7):** `main` had no branch protection, so a red PR could be merged.

## 5. Test results

Local: Windows 11, Node 24.22.1, head `5618934` (tree identical to `1b9f201`), WSL2 sandbox available.

| Suite | Local | Hosted (run 40627088603) |
|---|---|---|
| Typecheck | pass | pass |
| Stage 1 — core/compatibility (scripts) | 392/392 | 392/392 |
| Stage 2 — MA3 Host, missions, routing, agents, voice | 1,678 pass, 1 skip | 1,677 pass, 2 skip |
| Stage 3 — agent runtime, teams, native companion | 63/63 | 63/63 |
| Stage 4 — `test:ma4` | 317 pass, 1 skip | 295 pass, 23 skip |
| `checks` job `test:ma4` | — | 294 pass, 24 skip (attempt 2) |
| Routing policy tests (in `checks`) | in stage 2 | 69/69 |
| UI tests | 421/421 | 421/421 |
| Voice worker (local gate; excluded from hosted CI) | 76/76 | not run |
| Web build / desktop build | pass / pass | pass / pass |
| Static security (audit, secrets, external inference off) | — | pass |

Directly re-run first: `tests/native-companion.test.ts` + `ma4-s2t2-browser.test.ts` 13/13, 0 skipped; T2-W1 passed
(3.6 s local, 3.4 s hosted); T2-X15 and T2-X20 passed.

**Skips (never counted as passes):**
- Hosted stage 4 and `checks`: 22 sandbox fixtures (F4.1–F4.11, F5 seccomp, R3-G3, A3, B2, R4-G3, R4-G5, E2, E4, E5) —
  no WSL2 user namespaces on hosted runners. All of them **ran and passed locally**.
- Hosted stage 2: `T10-whisper` (runtime not staged) and `T6 X53` disposable live run. Locally X53 passed; T10-whisper
  skipped because the whisper runtime was staged into this worktree only after stage 2 had run.
- Both: `MA4 live free-model Host contract` (opt-in, never paid).
- Voice worker is a local gate only (hash-pinned whisper runtime and a Windows speech recognizer). The first local run
  failed 7/76 only because the fresh worktree lacked the git-ignored runtime; after copying the staged runtime from the
  main checkout it passed 76/76.

**Flake documented, not hidden:** in attempt 1 of the `checks` job, `MA4 real Windows DPAPI encrypt/decrypt round trip`
failed after 20,026 ms. The first `powershell.exe` + `Add-Type System.Security` launch on a cold hosted runner exceeded
`DpapiProtector`'s fixed 20 s `execFile` timeout (`jev-secrets.server.ts`). The same failure occurred in unrelated run
40140682183 (20,721 ms, 2026-10-24). The same test passed in the same run's regression job and locally. Only the failed
job was rerun, once; it took 1,578 ms. The production timeout was not changed in this repair.

## 6. MA4 closure audit

COMPLETE = implemented and verified with evidence. PARTIAL = implemented, not fully qualified. BLOCKED = missing, failing
or dependent on something unavailable.

| Area | State | Evidence and gaps |
|---|---|---|
| Model intelligence and automatic routing | **PARTIAL** | Routing modes, exact-model pins, fail-closed model identity and live chat classification are implemented and tested (routing tests 69/69; stage 2/4; `docs/ma4-s1r4`, `docs/ma4-s3-t1r3`). G7 regression gate FAIL (`docs/ma4-s1r4`: held-out 17/20, v2 0/3). Improvement from skills/memory UNPROVEN (`docs/ma4-s2`: 10/24 vs 14/24; `docs/ma4-s2r1`: 7/32 vs 13/32), so both stay off by default. Warm latency gain 14.0%, short of the 15% target. |
| Local model execution | **COMPLETE** (software) | Real Ollama inference (`docs/ma4-s1r`); served digest recorded (`docs/ma4-s3-t1r3`); Windows native local-only conversation routed to `ollama`/`qwen2.5-coder:7b` (`docs/ma4-s3-t5-native/RELEASE_GATES.md`, R1R2). 30B models load-probed only. The 7B planner still mis-parses some tasks (`docs/ma4-s2-t3r1`). |
| Agent orchestration and task persistence | **COMPLETE** (engineering) / **PARTIAL** (long-run) | Persistent task runtime, teams and recovery: stages 3–4 green. 24 h soak A FAILED S5 memory and S9 (harness race); candidate soak B was IN PROGRESS and passing at 4.28 h, but **its final 24 h verdict was never recorded** (`docs/ma4-s2-t3r1/SOAK_FINAL_VERDICT.md`). |
| Permission controls and approvals | **COMPLETE** (software) | Workstation-only approval, device rights (native-companion 1–3), approval recovery tests; Windows Approval Center approved a real pending `file.apply` with the Host's payload hash through the compiled WPF app (R1R2). |
| Security and prompt-injection defenses | **COMPLETE** (software) | Hosted static security green; WSL2 sandbox escape and seccomp suite passed locally (hosted skips it); 8/8 prompt-injection refusals and 12 security invariants (`docs/ma4-s2-t3r1/SECURITY_REGRESSION.md`); GHSA-q84f-53jg-9ppm fixed (#54); external inference disabled by default (CI-checked). Public beta remains gated on multi-platform kernel isolation (`docs/ma4-s3-t3r2`). |
| Connected services and authentication contracts | **COMPLETE** (contract level) | Connector suites, T2-W1, T2-X10–X20 green in stage 4. Exercised against synthetic workspaces and loopback fixtures; external OAuth providers are disabled for preview, and no real third-party account was qualified. |
| Windows native application and floating notch | **PARTIAL** | Debug build PASS (hosted 40588549304, identical tree); notch flush and centred within 1 px on one 3200×1928 monitor; clean Quit exit. Installation/upgrade/uninstall BLOCKED (no installable candidate); no signed or Release build; multi-monitor and high-DPI NOT TESTED. The notch implementation was not touched by MA4-R2. |
| Android native companion | **PARTIAL** | APK build + `KeystoreErasureTest`, `NativeCookiePolicyTest`, `ServerAddressTest` (hosted 40582198603, identical tree). Physical Keystore deletion, pairing, conversation, supervision and revocation NOT TESTED / BLOCKED (no authorized device). A local rebuild was not possible: `build-android.ps1` pins Java 21.0.11 and this machine has 21.0.12. |
| Agent cancellation and recovery | **COMPLETE** | Cancellation ordering, mid-step cancel with 0 post-cancel receipts, crash/restart recovery (soak A S10: ≤ 2.6 s, 0 lost state), lease takeover T2-X15, lease renewal T2-X20. |
| Regression and integration tests | **COMPLETE** | §5. |
| Voice | **PARTIAL** (software) / **BLOCKED** (physical) | Voice worker 76/76 locally; acoustic gates G4–G7, G9, G12 BLOCKED (`docs/ma4-s3-t2r1`). |

## 7. Branch protection (applied 2026-10-28 with owner authorization)

Before: `main` had no protection and no rulesets. Now `main` requires:

- changes through a pull request (0 required reviews; there is a single maintainer);
- required checks `typecheck, MA4/routing/sandbox-contract tests, UI tests, builds`, `full MA3/MA4 regression (npm test)`
  and `static security checks` (GitHub Actions), with the branch up to date first;
- enforced for administrators; no force-push; no deletion.

The two native workflows are not required: they are path-filtered, so a required check from them would never report on
PRs that do not touch native code and would block those PRs.

## 8. Unresolved issues and known limitations

1. DPAPI test flake: fixed 20 s `execFile` timeout vs cold `powershell.exe` on hosted runners (2 of 15 recent failed runs).
2. Native workflows never run on `main`; native regressions on `main` are only caught by PRs touching native paths.
3. `npm run lint` reports 45 pre-existing errors (124 warnings) in files outside MA4-R2; lint is not a CI gate.
4. Soak B final verdict unrecorded; soak A failed S5 and S9.
5. G7 FAIL and unproven intelligence gains (§6).
6. Many merged or superseded MA4 branches and local worktrees remain; none were deleted.

## 9. Deferred to beta / release qualification (or MA5)

Physical Android qualification (pairing, Keystore, TalkBack); multi-monitor and high-DPI Windows; Windows installer,
upgrade and uninstall; production code signing (EV Authenticode, Android release key); physical voice and acoustic
qualification; Narrator/TalkBack accessibility; a recorded 24 h soak PASS; store listings and submission readiness.

## 10. MA5 handoff — reuse, do not rebuild

| System | Location |
|---|---|
| Persistent task runtime, leases, recovery | `src/lib/bunny-host/ma4/task-runtime.server.ts`, `task-store.server.ts` |
| Model routing and registry (external inference off by default) | `src/lib/bunny-host/routing.server.ts`, `routing-store.server.ts`, `ma4/registry.ts`, `ma4/cloud-candidates.ts` |
| Connected actions and workflows | `src/lib/bunny-host/ma4/connected-actions.server.ts`, `connected-workflow.server.ts` |
| Proactive engine | `src/lib/bunny-host/ma4/proactive.server.ts`, `proactive-store.server.ts` |
| Agent teams and planner | `src/lib/bunny-host/ma4/team-run.server.ts`, `adaptive-planner.ts`, `agent-runtime.server.ts` |
| Execution sandbox | `src/lib/bunny-host/ma4/sandbox.server.ts`, `sandbox-launcher.py` |
| Benchmark and receipt integrity | `src/lib/bunny-host/ma4/live-benchmark.server.ts` |
| Credential protection | `src/lib/bunny-host/jev-secrets.server.ts` (DPAPI) |
| Windows native client and floating notch | `native/windows/BunnyA/` (`NotchWindow.xaml`) |
| Android companion | `android/app/`, `scripts/build-android.ps1` |
| Test rigs | `src/lib/bunny-host/ma4-s2t2-fixtures.ts`, `ma4-s2t3-fixtures.ts` |
| CI stage runner and watchdog | `scripts/ci/test-stage.mjs`, `scripts/ci/watchdog.mjs`, `.github/workflows/ci.yml` |

MA5 starts only on a new owner go. Nothing in MA4-R2 implemented MA5 work.
