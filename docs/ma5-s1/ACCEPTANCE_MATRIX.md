# MA5-S1 — Acceptance matrix

Each verdict cites observed evidence. A description of a feature is never counted as evidence.

| Gate | Requirement | Verdict | Evidence / reason |
|---|---|---|---|
| S1-G1 | Correct protected-main baseline and isolated branch | **PASS** | Based on the actual latest main `b93109a`, with green main CI run 40635541644. The difference from the brief's `1b9f201` is documented. Work happened in an isolated worktree (BASELINE.md) |
| S1-G2 | Existing Host architecture preserved | **PASS** | No Host, gateway, routing, model, memory or voice-permission source changed. The only `src/` change is the test file `voice-t2-eval.test.ts`. Contract use is mapped in HOST_CONTRACT_COMPATIBILITY.md |
| S1-G3 | Windows core workflows stay inside the native application | **PARTIAL** | Chat, Missions, approvals, settings, voice wiring, devices and pairing ran in-app with no browser (WINDOWS_NATIVE_ACCEPTANCE.md). Missing: native authoring of persistent connected tasks (`ptask.plan/create`, `connector.roots`) and team-Mission coordinator selection |
| S1-G4 | Windows local model execution verified | **PASS** | `qwen2.5-coder:7b` via Ollama; the Host served digest equals the Ollama digest `dae161e2…`, and the UI shows it. Output matched the Host. Cloud tag hidden under Local only (`w3-chat.json`) |
| S1-G5 | Windows approval authority and receipts verified | **PASS** | Exact hash; inspect context required; file change and test receipt; 6 receipts with the ledger verified. Wrong hash, deny, stale item and restart all fail closed, and `action.approve` never reached the Host for the stale item (`w5-approvals.json`) |
| S1-G6 | Native agent states match actual Host execution | **PASS** | Four-role Mission: UI step rows matched the Host step states at every sample. Agent chips use Host presentation state (`w4b-roles.json`, `w4-mission.json`) |
| S1-G7 | Four-edge notch geometry and UI behavior verified | **PARTIAL** | Four edges with gap 0 and centring ≤1 px; drags across two physical monitors with different DPI; collapse; persistence; focus (`notch.json`, `lifecycle.json`). Not driven: resolution, scale or taskbar change at runtime, monitor unplug, animations-off |
| S1-G8 | Native Android activity becomes the default supported launcher | **PARTIAL** | The built APK has exactly one launcher: the `.MainActivity` alias targeting `NativeCompanionActivity`. WebView removed; dex check; package id unchanged; versionCode 4. Launch on a device: BLOCKED |
| S1-G9 | Native Android pairing and session boundaries preserved | **PARTIAL** | Session store, cookie policy and Keystore erasure unchanged, and their JVM tests pass in the build. `expect` and identity pinning added; `FLAG_SECURE`. Not exercised on a device |
| S1-G10 | Native Android chat and task supervision integrated | **PARTIAL** | Implemented (source review): chat tracked from snapshots; Missions and ptasks with confirmed Stop; approvals shown as a count only. Not run on a device |
| S1-G11 | Android lifecycle and request cleanup verified | **PARTIAL** | `PollPolicyTest` (22 checks) covers intervals, backoff, Retry-After and the stale guard. Activity lifecycle not run on a device |
| S1-G12 | Reproducible Windows development candidate | **PARTIAL** | Two clean Release builds are byte-identical locally and in CI, and CI enforces this. Local and CI binaries differ, so independent reproduction is not established (INSTALLER_AND_APK_RESULTS.md). Install, update and uninstall lifecycle passed |
| S1-G13 | Reproducible Android development APK | **PARTIAL** | `classes.dex` is byte-identical between local Java 21.0.12 and CI Java 21.0.11. APK bytes differ because each environment signs with its own test key; other APK entries were not compared |
| S1-G14 | Actual Windows application E2E evidence | **PASS** | 9/9 stages on real WPF renders against a real Host, run `ma5s1-2026-10-28T06-19-18-229Z` (`evidence/windows/`) |
| S1-G15 | Android physical acceptance, or explicitly BLOCKED | **BLOCKED** | No device or emulator available (PHYSICAL_TEST_STATUS.md) |
| S1-G16 | Physical voice acceptance, or explicitly BLOCKED | **BLOCKED** | Wiring verified only; no acoustic test, and no synthetic audio counted |
| S1-G17 | All affected security regressions pass | **PASS** | Local `npm test`: 2 527 tests, 2 526 pass, 0 fail, 1 opt-in skip, including the Host authority, approval, device and voice suites. Approval fail-closed cases were observed end to end. 0 high npm advisories (FULL_REGRESSION_AND_CI.md, SECURITY_REGRESSION.md) |
| S1-G18 | Required hosted CI jobs pass on final commit | **Decided in PR #59** | This file belongs to the final commit and cannot cite that commit's runs. The exact final-head run IDs and conclusions are in the PR description and the final report |
| S1-G19 | No unsupported or fabricated PASS claims | **PASS** | Every PASS above cites recorded evidence. Untested items are marked NOT TESTED or BLOCKED. Screenshots: none produced; evidence is UIA and Host JSON |
| S1-G20 | Final engineering and release decisions separated | **PASS** | ENGINEERING_REPORT.md (merge) vs RELEASE_GO_NO_GO.md (release NO-GO) |

## S1R1 corrections

The S1R1 gates (R1-G1 to R1-G16), with evidence, are in S1R1_FINAL_ACCEPTANCE.md. They do not change any S1 verdict above, with these clarifications:

- S1-G5 and S1-G14 were re-run on the S1R1 binary (`ma5s1-2026-10-28T15-15-45-913Z`): all stage flags true, no failures.
- S1-G12: the install lifecycle was re-run with the ownership-checking installer, and passed.
- S1-G17: the security rows added for S1R1 are in SECURITY_REGRESSION.md.
- S1-G15 (Android physical acceptance) moves from BLOCKED to **PARTIAL**. A Galaxy SM-S948U (Android 17) was attached during S1R1: upgrade over v3, native launcher, secure pairing, Stop, background polling and revoke were observed (S1R1_ANDROID_DEVICE_ACCEPTANCE.md). Still missing: TalkBack, v3 data retention, re-pair after an address change.
- S1-G8 to S1-G11 now also have device observations (same document). Their verdicts stay PARTIAL.

## S1R2 corrections

The S1R2 gates (R2-G1 to R2-G15) are in S1R2_FINAL_MERGE_ACCEPTANCE.md. S1-G15 stays **PARTIAL**: rotation, process
end, backgrounding, network loss, gateway and Host restart are now observed on the device; TalkBack, v3 data retention
and re-pair after an address change are still missing.
