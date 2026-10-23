# MA4-S1R3-CI2 — hosted CI recovery evidence

Base: PR #12 head `101261a`. Branch `ma4-s1r3-ci2`. Every result below is a hosted GitHub Actions run on
`windows-latest` (image `windows-2025-vs2026`, Node 24.21, 4 vCPUs), unless it is marked local. Local results are never
counted as hosted results.

## Validation order and results

| # | Step | Run | Commit | Result |
|---|---|---|---|---|
| 1 | Failing test alone (hosted reproduction, unchanged test) | 39700393706 | `b86c9c9` | `not ok` (`EPERM` from `rmSync`), then process hang, **watchdog TIMEOUT 300 s**, 0 survivors after forced stop |
| 1 | Failing test alone, after the fix | 39702020237, 39704318771 | `b1fa317`, `a66c207` | **3/3 pass**, exit 0, 0 orphans |
| 2 | Character-appearance group and the six sibling Host files (local) | — | `a66c207` | 30/30 pass |
| 3 | Full stage 2, original code | 39700393706 | `b86c9c9` | `not ok 52` (same test), then **watchdog TIMEOUT 1800 s**, test-file process holding `127.0.0.1:43910` |
| 3 | Full stage 2, hang fixed | 39704318771 | `a66c207` | completed in 20 min: 1,600 pass / **37 fail** (failures it had been hiding; see CI_STAGE2_DIAGNOSIS.md) |
| 3 | Full stage 2, over-wide 8.3 fix | 39712293880 | `8927701` | 1,576 pass / **63 fail**: staging alias check (fix reverted and narrowed in `df64d2b`) |
| 3 | Full stage 2, gating job | 39718832823 | `df64d2b` | **1,639 pass / 0 fail / 2 skipped**, 13 min, 0 orphans |
| 4 | Full hosted regression (`npm test`, 4 stages) | 39718832823 | `df64d2b` | stage 1 ✔, stage 2 ✔, stage 3 **1 fail** (T11-SURF fixture), stage 4 not reached |
| 4 | Full hosted regression | 39721263206 | `b49bb7c` | **success**: stage 1 378/378 (2 min); stage 2 1,639 pass / 0 fail / 2 skipped (20 min; skips: whisper runtime not staged, X53 NOT TESTED); stage 3 58/58 (5 min); stage 4 50 pass / 0 fail / 21 skipped (WSL2 sandbox fixtures `SKIPPED (not passed)`, opt-in live test); 0 orphans in every stage |
| 5 | MA4 and routing tests (checks job) | 39721263206 | `b49bb7c` | **success** |
| 6 | UI, typecheck, mobile-web and desktop builds (checks job) | 39721263206 | `b49bb7c` | **success** |
| 7 | Security: `npm audit --omit=dev --audit-level=high`, secret/env scan, inference-disabled checks | 39721263206 | `b49bb7c` | **success** (audit ran: 0 high+ production advisories) |

Run 39712293880's security job failed **before auditing**: `npm warn audit network timeout … npm error audit endpoint
returned an error`. The same endpoint failed from the workstation at the same time, which makes it a registry-side
outage. Later runs audited normally. Locally, `npm audit --omit=dev` and `npm audit` both report **0 vulnerabilities**.
The lockfile is unchanged from `101261a`.

## Watchdog and diagnostics, as exercised

* Every hosted stage ran under `scripts/ci/watchdog.mjs`. In three runs a stage overran its budget and became a named
  timeout with the process tree and listeners recorded, instead of running to the job limit: 39700393706 (both lanes)
  and 39712290395 (a stage 2 lane slowed by 63 failing tests).
* Orphan reports: 0 in every run except one, where an unverified Calculator was left running (`win32calc.exe`, class F).
  The watchdog stopped it and the cause was fixed.
* `ci.yml` regression job: each `npm test` stage is now its own step under the watchdog (budgets 15 / 40 / 15 / 10 min),
  with the TAP reporter, `--test-timeout=300000` and an always-uploaded `regression-diagnostics` artifact. A check fails
  the job if `npm test` stops having 4 stages.

## Not qualified here (unchanged limits)

* **X53** (live Calculator UIA): `SKIPPED (NOT TESTED)` on hosted runners, which have no Microsoft Calculator package. It
  passes locally (21.7 s). It stays a local gate.
* **Hardware voice tests** (`scripts/voice-worker.test.mjs`): excluded from hosted CI, as before. They stay a local gate.
* **Physical Android/iOS, installed release (H1), WSL2 adversarial sandbox:** unchanged, **NOT TESTED** on hosted CI.
* **G7:** unchanged. FAIL (v2 0/3, held-out 13/20). No benchmark, prompt, threshold or historical result was touched.
  No external inference was used.
