# MA4-S1R3 Windows CI remediation — R3-G11

## The seven hosted-runner failures (run 39663570776, PR #10; same set on PR #11)

| # | Test (file) | CI error |
|---|---|---|
| 1 | M-A-1D: a release is built from the exact pinned commit… (`scripts/bunny-release.test.mjs`) | `ENOENT … C:\Users\RUNNER~1\AppData\Local\Temp\bunny-release-pkg-…\out\Bunny-A-Windows-v26-MA2-R1\src\lib\bunny-host\persistence.server.ts` → "Release manifest failed." |
| 2 | M-A-1D: the logon launcher starts the release runtime… (same file) | "Installed Bunny state layout does not match install.json." |
| 3 | M-A-1D/M-A-2: install pins startup outside Git… (same file) | expected `/inside a Git checkout/`, got "Migrate Bunny state to the real <InstallRoot>\state directory…" |
| 4–7 | MA2 T1 Windows controller: complete cutover / after-copy / after-config / after-host (`scripts/bunny-state-migration.test.mjs`) | `EPERM … C:\Users\RUNNER~1\AppData\Local\Temp\bunny-state-test-…` after ~437 s |

## Root cause (one cause for all seven)

Hosted Windows runners set `TEMP` to an **8.3 short path**, `C:\Users\RUNNER~1\AppData\Local\Temp`. The tests create fixtures under `os.tmpdir()` and pass those short paths to the PowerShell scripts under test. Those scripts compare paths as strings, or derive relative paths from them:

* `package-bunny-desktop.ps1` takes `$source=(Resolve-Path …).Path`, which keeps `RUNNER~1`, and then computes `$_.FullName.Substring($source.Length)` on `Get-ChildItem` results, which are long-form. The offset is wrong, so source files land at mangled paths and `persistence.server.ts` is missing from the package (#1).
* The launcher and installer compare `stateRoot`, `dataDirectory` and `<InstallRoot>\state` across short and long spellings, so the checks disagree (#2, #3).
* The migration controller tests fail the same canonical-path checks. Their cleanup then hits `EPERM` on the still-held fixture tree (#4–#7).

Locally the user temp path has no short component, which is why "they pass locally".

## Reproduction (local, deterministic)

The fixture is a long-named directory with its 8.3 alias `C:\Users\<user>\AppData\Local\Temp\BUNNYS~1`.

| Run | Command | Result | Log |
|---|---|---|---|
| before fix | `TEMP=…\BUNNYS~1 node --test scripts/bunny-release.test.mjs scripts/bunny-state-migration.test.mjs` | **20 pass / 7 fail**, the same 7 tests | `evidence/ci-short-temp-before.log` |
| before fix, test #1 alone | same, with the licence staged | exact CI error: `ENOENT …\BUNNYS~1\…\persistence.server.ts` | `evidence/ci-release-build-before.log` |
| after fix | same | **27 pass / 0 fail** (26 + #1 re-run once the licence was staged) | `evidence/ci-short-temp-after.log`, `evidence/ci-release-build-after.log` |

(Test #1 also needs the Node runtime `LICENSE`. On CI, `setup-node` places it next to `node.exe`. Locally it is an ignored staged file, `releases/installed/JEV-Windows-v1/runtime/LICENSE`.)

## Classification

| # | Classification |
|---|---|
| 1–7 | **Test defect** (fixtures built on a non-canonical temp root), exposed by a **runner environment** difference (8.3 `TEMP`). Not a product regression: these paths were never exercised with short names. |

**Latent tooling limitation (documented, not changed in S1R3):** the packager, installer and launcher assume canonical long paths. A user who passes an 8.3 path to `-Repository`, `-InstallRoot` or `-DataDirectory` would hit the same mismatch. A one-line hardening exists: use `(Get-Item -LiteralPath …).FullName`, which returns the long form (verified locally), instead of `Resolve-Path`. It belongs to the MA2 release-tooling owner, because changing the packager alters release tooling that installed releases are pinned against.

## Fix (commit `b07d6aa`)

Both test files resolve their temp root once with `realpathSync.native(tmpdir())`, which expands 8.3 names. No test was removed, skipped or weakened, and no assertion changed. No other CI change was needed.

## CI coverage (R3-G11)

`.github/workflows/ci.yml` is unchanged in S1R3. It already runs typecheck, `test:ma4` (now including `ma4-repair.test.ts`), the routing-policy tests, UI tests, the mobile-web and desktop builds, `npm audit --omit=dev --audit-level=high`, the secret/env scan and the external-inference-disabled checks. No job needs LLM credentials. Hardware-dependent voice tests stay a local gate (unchanged from S1R2). Live WSL2 sandbox fixtures report `SKIPPED (not passed)` on hosted runners. Hosted results for this branch are recorded in RELEASE_QUALIFICATION.md. Local success is not counted as hosted success.
