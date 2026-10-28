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

## Verdicts

| Area | Verdict |
|---|---|
| Windows native | **PARTIAL**: core workflows verified end to end on real renders; persistent connected tasks cannot be authored natively; runtime display changes, physical voice and screen-reader use untested |
| Android native | **PARTIAL**: launcher migration verified in the built APK; physical device acceptance **BLOCKED** |
| Security | No regression found; see SECURITY_REGRESSION.md and FULL_REGRESSION_AND_CI.md |
| Gates | See ACCEPTANCE_MATRIX.md |

## Open limitations

1. Android has not run on hardware (no device): upgrade path, pairing, polling, Stop, TalkBack.
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
