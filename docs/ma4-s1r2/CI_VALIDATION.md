# MA4-S1R2 CI and release hygiene — R2-G11 / R2-G12 / R2-G13

## CI configuration (`.github/workflows/ci.yml`)

Before this phase the repository had no CI. The workflow runs on `push` to `main`, `ma4-**`, `ma3-**`, on every pull request and on manual dispatch. It needs no provider API keys and never runs live models.

| Job | Runner | Steps |
|---|---|---|
| `checks` | windows-latest | `npm ci` · `npm run typecheck` · `npm run test:ma4` (MA4, routing modes, approvals, reliability, tool loop, workflow gate, offline cloud adapters, sandbox contract tests) · routing policy tests · `npm run test:ui` · shared mobile-web build · desktop build (`JEV_DESKTOP_BUILD=1`) |
| `regression` | windows-latest | full git history (release-pin tests resolve historical commits) · MSYS2 UCRT64 GCC (compiles the reviewed ownership module from source; nothing prebuilt is downloaded) · `npm ci` · `npm run pretest` · the exact `npm test` command with only `scripts/voice-worker.test.mjs` removed (generated from `package.json`, so the list cannot drift) |
| `security` | ubuntu-latest | `npm audit --omit=dev --audit-level=high` · no committed `.env` or key-shaped secrets · external inference disabled by default (registry default and disabled cloud candidates) |

Excluded from CI (hardware, live or installation dependent; reported separately): `scripts/voice-worker.test.mjs`, which needs the operator-staged, hash-pinned whisper runtime (`stage-whisper.mjs` never downloads) and a working Windows speech recognizer. On the first CI run it failed 8 voice tests (7 whisper, 1 V07–V09 streaming) for exactly these reasons; the other 8 failures were shallow-clone release-pin lookups, fixed by full history. It passes locally (see the engineering report). Also excluded: live Ollama benchmarks and G7 (`scripts/ma4-s1r2/*.mjs`), `test:ma4:local`, live WSL2 adversarial sandbox fixtures (they report **SKIPPED (not passed)** without WSL2 user namespaces), installed-release switching, physical devices, NPU.

## Observed CI results (inspected)

| Run (commit) | checks | regression | security |
|---|---|---|---|
| 39657189466 (`a3937da`) | FAIL: S1 transport test expected the old "unsupported stream" contract → fixed in `bb182b1` | FAIL: 16 environment failures (shallow clone, whisper not staged, runner speech) | FAIL: npm audit |
| 39657625178 (`bb182b1`) | **PASS** | FAIL: same 16 | FAIL: npm audit |
| 39658679375 (`a8d74c0`) | **PASS** | FAIL: scripts stage 367/374. The 7 failures are Windows install/release-packaging tests (M-A-1D release builder/launcher/installer state layout, MA2 T1 controller temp-dir `EPERM` after ~437 s). They depend on the installed-release environment and pass locally. Later stages were not reached (`&&`). | FAIL: npm audit (pre-existing, 5 critical / 2 high; semver-compatible fixes) |

Local authoritative regression on this branch: `npm test` 2,204 passed, 0 failed, 1 skipped (`evidence/regression.log`).

Next CI steps (not done here):
1. Run each `npm test` stage as its own CI step, so one environment failure does not hide the rest.
2. Move the install/release-environment tests to a self-hosted Windows runner with the release layout, or make their temp paths runner-safe.
3. Apply the lockfile-only `npm audit fix` in an isolated checkout.

## MA4 → main conflict (I2) — strategy only, not executed

`git merge-tree --write-tree origin/main HEAD` (merge base `e41a4d6`) reports exactly one conflict: `package.json` → `scripts.test`. `http.server.ts`, `bunny-missions/authorization.server.ts`, `bunny-missions/manager.server.ts` and `bunny-missions/types.ts` auto-merge.

| Side | Adds to the `test` file list |
|---|---|
| `origin/main` (MA3 T14) | `src/lib/bunny-host/t14-autonomy-host.test.ts` |
| MA4 line | `src/lib/bunny-host/oauth-pkce.test.ts` (added by MA3 T13 `3e533a9`, which `main` does not contain) and the trailing `&& npm run test:ma4` |

Resolution when MA4 is eventually merged to `main`: take the union, i.e. the MA4 command with `t14-autonomy-host.test.ts` inserted at its `main` position. Then run `npm test` on the merge result, since T14 and MA4 have never been tested together. Neither merge carries any other textual conflict. This phase does not merge, rebase or force-push anything. The order stays: PR #9 → `ma4-s1-model-intelligence` → `main`.
