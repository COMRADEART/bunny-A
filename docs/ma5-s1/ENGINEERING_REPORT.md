# MA5-S1 — Engineering report

Branch `ma5-s1-native-application-productization`, based on protected main `b93109a` (see BASELINE.md for why this is not
the brief's `1b9f201`). PR: https://github.com/COMRADEART/bunny-A/pull/59 (not merged).

## What changed

Windows (`native/windows/BunnyA`, existing WPF app):
- Host client: typed failures; `expect{hostId,epoch}` on every command; no retries; uncertain outcomes resolved by
  `operation.status` within the same epoch; `/events` reader with silence detection and backoff.
- Snapshot handling: stale-response guard, per-section fault isolation, events-driven refresh, bounded polling.
- Approval Center: selection by stable key; Host `action.inspect` context required before Approve; local
  re-validation before sending; plan-reference-bound Mission approval; receipts shown.
- Chat: local-only filtering mirrors the Host rule; auto-start only for launches the Host would allow a device;
  served digest shown; Stop by item kind.
- Agents, voice, devices, settings now read the Host's real fields (BASELINE.md deficiencies 4–8) and write through
  the Host's existing commands.
- Missions: Delegate from chat, plan review, step view with served models, Stop/Pause/Resume/Reconcile by kind and
  state, confirmations for destructive actions.
- Notch: per-monitor DPI placement in physical pixels; drag-to-snap on any monitor; persisted edge and position;
  live agent states; vertical approval and stop; keyboard focusable; focus returned; reduced-motion aware.
- Accessibility: automation names, readable list items, Toggle-safe checkboxes, keyboard shortcuts.
- Packaging: reproducible Release dev candidate with per-file hashes; per-user install/update/uninstall script that
  refuses the owner's folders.

Android (`android/`, existing Java app, same package id):
- `NativeCompanionActivity` is the launcher via a `.MainActivity` activity-alias; the WebView activity and its
  notification bridge were removed; `INTERNET` is the only permission.
- Lifecycle-bound polling (`PollPolicy`), separate command executor, typed failures with terminal pages for
  auth/identity, `expect` on commands, Mission/ptask supervision with confirmed Stop, keyboard insets, draft
  preservation, `FLAG_SECURE` pairing.
- Build: Java 21.0.x policy (CI pinned 21.0.11), JVM tests for the launcher and polling, dex WebView check.

Tests and CI: Windows E2E and candidate harnesses (`scripts/verify-ma5-s1-*.mjs`); updated provenance and voice
source audits for the removed WebView files; Windows CI now builds and verifies the reproducible candidate.

Documentation corrections (current-state READMEs only; no milestone record under `docs/` was edited):
`android/README.md` previously stated the APK was signed with v1, v2 and v3 schemes, but the build reports v1=false.
It now says v2 and v3. `android/README.md`, `android/NATIVE_PREVIEW.md` and `native/windows/README.md` were updated
for the removed WebView and the new Windows behaviour.

Unchanged by design: Host, gateway, routing, models and pins, memory injection, Planner/Worker selection, voice
permission boundaries, approvals, signing verification.

## S1R1 corrections (same PR, after independent review of `e094a26`)

Three defects found in review were fixed, each with real fault tests and a before/after reproduction. Two more
were found while testing.

| Defect | Fix | Evidence |
|---|---|---|
| The installer replaced any existing destination; only uninstall looked at the marker | Proof of ownership (marker schema + product + exact install root + no unlisted entries) before update **and** uninstall; junctions and links refused; archive entries confined to staging; candidate tree = manifest; optional `-ExpectedSha256`; rollback restores the previous install | S1R1_INSTALLER_OWNERSHIP.md: 6/6 tests; e094a26 replaced an unrelated folder |
| Windows treated the ledger's `unknown` as "did not run", `failed` as "refused … nothing changed", and `refused` as "did not run" | Truthful classification; Host identity and epoch both required before asking the ledger; `HostFailure.Failed` for partial effects; cancellation after sending is outcome unknown | S1R1_COMMAND_OUTCOME_INTEGRITY.md: 114 scripted + 10 real-Host checks |
| Android said "Nothing was sent" for failures while sending, and "Not done" after sending | `HostExchange`: only a `connect()` failure is "not sent"; everything after is `OUTCOME_UNKNOWN` with the original operation id; `FAILED` means "may have partly applied" | S1R1_NETWORK_FAULT_TESTS.md: 35 checks |
| *(found in testing)* A direct `FAILED` / `HOST_UNAVAILABLE` answer was shown as "Host refused" on Windows and as "Not done" on Android | Classified as partly applied on both clients | W4, A8 |
| *(found in testing)* Android's send had no streaming mode, so the HTTP stack could replay the POST. On the JVM the command arrived twice | `setFixedLengthStreamingMode` | A3 (exactly one receipt); before-repro shows two |
| *(found on a physical phone)* The native gateway turned a lost Host answer into `503 HOST_UNREACHABLE`, so the phone said "Not done" for an applied command | Gateway returns `504 OUTCOME_UNKNOWN` once the command was delivered; Android maps it to outcome unknown | S1R1_ANDROID_DEVICE_ACCEPTANCE.md D14 → D15; new real-socket gateway test |

Files: `install-dev-candidate.ps1`, `HostClient.cs`, `MainWindow.xaml.cs`, `HostExchange.java` (new),
`NativeCompanionClient.java`, `NativeCompanionActivity.java`. Tests added: `scripts/ma5-s1r1-installer.test.mjs`,
`native/windows/BunnyA.OutcomeTests/`, `scripts/verify-ma5-s1r1-outcome.mjs`, `android/tests/HostExchangeTest.java`.
CI wiring: `scripts/build-android.ps1`, `.github/workflows/native-windows-preview.yml`.

The gateway file `src/lib/orch/native-companion.server.ts` (added for the native companion in #53) changed in S1R1,
only in how it reports a lost Host answer. No Host, routing, approval-policy or device-authority code changed. UI layout is unchanged; only
outcome texts and dialog titles changed. Final acceptance: S1R1_FINAL_ACCEPTANCE.md.

## Verdicts

| Area | Verdict |
|---|---|
| Windows native | **PARTIAL**: core workflows verified end to end on real renders; persistent connected tasks cannot be authored natively; runtime display changes, physical voice and screen-reader use untested |
| Android native | **PARTIAL**: launcher migration verified in the built APK. S1R1: one physical device (upgrade over v3, pairing, Stop, polling, revoke, lost-answer fault) — see S1R1_ANDROID_DEVICE_ACCEPTANCE.md; TalkBack and v3 data retention open |
| Security | No regression found; see SECURITY_REGRESSION.md and FULL_REGRESSION_AND_CI.md |
| Gates | See ACCEPTANCE_MATRIX.md |

## Open limitations

1. Android ran on one device in S1R1 (S1R1_ANDROID_DEVICE_ACCEPTANCE.md). Open: TalkBack, v3 data retention, re-pair after a Host address change.
2. Windows: no native authoring of persistent connected tasks (`ptask.plan/create`, `connector.roots`); team
   Missions need a coordinator id; History omits steps.
3. Notch: resolution, scale and taskbar changes and monitor unplug were not driven.
4. Voice: wiring only; no acoustic test.
5. Windows build differs between this workstation and CI (each is self-consistent).
6. Android polls; there is no event stream through the HTTPS gateway.
7. MA4's G7 model-quality failure and the unproven skills/memory gains remain open; this milestone does not
   address them.

## Merge recommendation

**GO for owner review and merge**, conditional on the three required CI checks passing on the final PR head
(FULL_REGRESSION_AND_CI.md). Merging publishes nothing and installs nothing. Public beta remains **NO-GO**
(RELEASE_GO_NO_GO.md).
