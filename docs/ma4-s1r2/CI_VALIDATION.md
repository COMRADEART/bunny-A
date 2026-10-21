# MA4-S1R2 CI and release hygiene — R2-G11 / R2-G12 / R2-G13

## CI configuration (`.github/workflows/ci.yml`)

Before this phase the repository had no CI. The workflow runs on `push` to `main`, `ma4-**`, `ma3-**`, on every pull request and on manual dispatch. It needs no provider API keys and never runs live models.

| Job | Runner | Steps |
|---|---|---|
| `checks` | windows-latest | `npm ci` · `npm run typecheck` · `npm run test:ma4` (MA4, routing modes, approvals, reliability, tool loop, workflow gate, offline cloud adapters, sandbox contract tests) · routing policy tests · `npm run test:ui` · shared mobile-web build · desktop build (`JEV_DESKTOP_BUILD=1`) |
| `regression` | windows-latest | MSYS2 UCRT64 GCC (compiles the reviewed ownership module from source; nothing prebuilt is downloaded) · `npm ci` · `npm test` (full MA3/MA4 regression incl. `pretest`) |
| `security` | ubuntu-latest | `npm audit --omit=dev --audit-level=high` · no committed `.env` or key-shaped secrets · external inference disabled by default (registry default and disabled cloud candidates) |

Excluded from CI (hardware, live or installation dependent; reported separately): live Ollama benchmarks and G7 (`scripts/ma4-s1r2/*.mjs`), `test:ma4:local`, live WSL2 adversarial sandbox fixtures (they report **SKIPPED (not passed)** without WSL2 user namespaces), installed-release switching, physical devices, NPU.

CI run results are recorded in the [engineering report](ENGINEERING_REPORT.md) after the branch is published.

## MA4 → main conflict (I2) — strategy only, not executed

`git merge-tree --write-tree origin/main HEAD` (merge base `e41a4d6`) reports exactly one conflict: `package.json` → `scripts.test`. `http.server.ts`, `bunny-missions/authorization.server.ts`, `bunny-missions/manager.server.ts` and `bunny-missions/types.ts` auto-merge.

| Side | Adds to the `test` file list |
|---|---|
| `origin/main` (MA3 T14) | `src/lib/bunny-host/t14-autonomy-host.test.ts` |
| MA4 line | `src/lib/bunny-host/oauth-pkce.test.ts` (added by MA3 T13 `3e533a9`, which `main` does not contain) and the trailing `&& npm run test:ma4` |

Resolution when MA4 is eventually merged to `main`: take the union, i.e. the MA4 command with `t14-autonomy-host.test.ts` inserted at its `main` position. Then run `npm test` on the merge result, since T14 and MA4 have never been tested together. Neither merge carries any other textual conflict. This phase does not merge, rebase or force-push anything. The order stays: PR #9 → `ma4-s1-model-intelligence` → `main`.
