# MA5-S1R1: Final acceptance

PR #59 (reused), branch `ma5-s1-native-application-productization`, base `b93109a`, previous head `e094a26`.
Details: S1R1_INSTALLER_OWNERSHIP.md, S1R1_COMMAND_OUTCOME_INTEGRITY.md, S1R1_NETWORK_FAULT_TESTS.md.
Raw outputs: `evidence/s1r1/`.

## Gates

| Gate | Requirement | Verdict | Evidence |
|---|---|---|---|
| R1-G1 | Existing PR #59 reused | **PASS** | Corrections pushed to the same branch and PR; no replacement PR |
| R1-G2 | Installer rejects unowned destinations | **PASS** | Installer tests 3-6: unrelated folder, no marker, corrupt marker, wrong schema, e094a26 marker, another folder's marker, unlisted user file. All refused with hashes unchanged. e094a26 replaced the unrelated folder |
| R1-G3 | Upgrade rollback preserves the prior installation | **PASS** | Installer test 10: injected failures after the backup and after the swap restore the previous install byte for byte |
| R1-G4 | No unowned directory can be removed | **PASS** | Uninstall refused for every unowned case and through junctions (tests 3-6, 9, 12); junction target unchanged |
| R1-G5 | Unknown Host operations remain explicitly uncertain | **PASS** | W1, W5-W11, R2: every non-conclusive answer ends in the outcome-unknown message, with no "did not run" wording |
| R1-G6 | Failed Host operations do not imply zero effects | **PASS** | W4 (direct `FAILED`, `HOST_UNAVAILABLE`, lost `failed`), A8: "may have partly taken effect" |
| R1-G7 | Host identity and epoch respected during reconciliation | **PASS** | W8 (new epoch) and W9 (different Host): the ledger is not asked; another epoch's or operation's record is rejected (W10) |
| R1-G8 | No automatic replay after connection loss | **PASS** | Every Windows scenario and A2-A4, A9-A11 count receipts: at most one per command. R1: the real Host's task list went 0 → 1 → 1 |
| R1-G9 | Android ambiguous network failures correctly classified | **PASS** (JVM transport + one device) | A1-A11, 37 checks. On a Galaxy SM-S948U (S1R1_ANDROID_DEVICE_ACCEPTANCE.md), an applied command whose answer was lost first showed "Not done" (gateway defect D14). After the gateway fix it shows "Outcome unknown", with exactly one delivery (D15) |
| R1-G10 | Deterministic fault-injection tests pass | **PASS** | Windows: scripted 114/114 and real Host 10/10. Android: 35/35. Installer: 6/6 |
| R1-G11 | Windows and Android native regressions pass | **PASS** | See the native rows below: Windows acceptance 8/8 stage flags with no failures; real candidate lifecycle; reproducible candidate; APK build with all JVM suites |
| R1-G12 | Full MA4 regression remains green | See FULL_REGRESSION_AND_CI.md | Local `npm test` (which includes `test:ma4`) on the S1R1 tree |
| R1-G13 | All required hosted CI checks pass on the final SHA | **Decided in PR #59** | This file is part of the final commit and cannot cite that commit's runs. The run links are in the PR description and the final report |
| R1-G14 | Real hardware limitations accurately reported | **PASS** | One Android device exercised, with its gaps listed: v3 data retention not established; TalkBack, rotation and process death not tested. Physical voice, screen reader and runtime display changes remain NOT TESTED |
| R1-G15 | No unsupported PASS claims | **PASS** | Each PASS cites a run above. JVM results are not counted as device results |
| R1-G16 | Corrected PR ready for independent merge review | **PASS**, subject to R1-G13 | — |

## Native regression on the S1R1 tree (local, Windows 11)

| Check | Result |
|---|---|
| `native/windows/build.ps1` (SDK 8.0.408, no feeds) | 0 warnings, 0 errors |
| `native/windows/package-dev-candidate.ps1` | 4/4 files identical across two Release builds. `BunnyA.exe` `94aa2257…a894`, `BunnyA.dll` `3db420b3…064c`, zip `36cf9d3d…c077` |
| `scripts/verify-ma5-s1-windows.mjs` (run `ma5s1-2026-10-28T15-15-45-913Z`, Debug binary `0fc0b287…75b4`) | All stage flags true, `failures: none`. The run covers: chat via local `qwen2.5-coder:7b`, Mission, roles, voice wiring, approvals (exact hash, wrong hash refused, deny, stale disabled, restart re-review), Host restart, notch on two monitors, lifecycle |
| `scripts/verify-ma5-s1-candidate.mjs` (S1R1 installer, real candidate) | pass |
| `scripts/build-android.ps1` (Java 21.0.12), after the gateway fix | pass: connection policy 21, Keystore erasure 5, cookie policy, PollPolicy 22, HostExchange 37, ManifestLauncherTest; no `android.webkit`; signatures v2 + v3. `classes.dex` `10bc29f1…e14f`; APK `12482cbc…2b04` (worktree test key) |
| Android device (Galaxy SM-S948U, Android 17) | Upgrade over v3, launcher, secure pairing, Stop, polling and revoke PASS; lost-answer fault fixed and re-verified (D14 → D15) |
| Gateway `src/lib/orch/native-companion.test.ts` | 9 / 9, including the new lost-answer case (fails on the old gateway) |

The Windows outcome harness was re-run after its real-Host scenario switched to `mission.create` on a provider-less
Host: scripted 114/114 and real Host 11/11 (run `ma5s1r1-outcome-2026-10-28T16-12-28-713Z`). See
FULL_REGRESSION_AND_CI.md for why.

The Windows binaries changed from S1 (`HostClient.cs`, `MainWindow.xaml.cs`), so S1's hashes no longer apply.
`classes.dex` changed for the same reason (Android client).

## Remaining limitations

1. Android: one device (Galaxy SM-S948U, Android 17) was exercised against a disposable Host
   (S1R1_ANDROID_DEVICE_ACCEPTANCE.md). Open items:
   - whether v3's app data survived the upgrade;
   - no way to re-pair after a Host address change without clearing app data;
   - phone chat depends on Host routing choosing a local model;
   - TalkBack, rotation and process death are NOT TESTED.
2. An install made by the e094a26 installer has no ownership identity, so the S1R1 installer refuses to upgrade or
   remove it. It must be removed by hand. S1 installs were disposable.
3. A Host `refused` record is shown as confirmed refused. The Host only records `refused` for refusals it raises, and
   the client does not independently prove that no partial work preceded one.
4. A reset after the request headers but before the body (W1) cannot be told apart from a lost answer, so it is
   reported as unknown, never as not sent. This is deliberately conservative.
5. All S1 limitations stand (RELEASE_GO_NO_GO.md).

## Recommendation

- Engineering integration: **GO**.
- Merge: **GO for independent review**, conditional on the required checks passing on the final SHA.
- Public beta: **NO-GO**.
