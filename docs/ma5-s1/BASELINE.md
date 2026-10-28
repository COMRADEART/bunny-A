# MA5-S1 — Baseline

Recorded 2026-10-28 before any MA5-S1 change.

## Protected main

| Fact | Value |
|---|---|
| Repository | https://github.com/COMRADEART/bunny-A (both local remotes `bunny-a` and `origin` point at the same main) |
| SHA named in the brief | `1b9f201abcc78cb2b6faf403cdfd88323a7f1f6e` |
| Actual latest protected main | `b93109ace1d018d5d87654c0214a301a3db489a8` |
| Difference | PR #58 (MA4 final closure docs) merged at 2026-10-28T05:01:06Z; it adds only `docs/milestones/MA4-FINAL-CLOSURE.md` (163 lines) |
| Main CI on `b93109a` | `ci` run 40635541644 — success (was in progress when MA5-S1 began, completed green) |
| Main CI on `1b9f201` | `ci` run 40630772546 — success |
| Branch protection | PR required; three required `ci.yml` checks; `enforce_admins` true |

The branch `ma5-s1-native-application-productization` was created from `b93109a`, as Phase 0 directs ("the actual
latest protected main"). It lives in an isolated worktree; build outputs go to the ignored `test-results/` and
`releases/` folders. Acceptance runs used temporary Host data, configuration and install folders, never the owner's.

## Native applications at baseline

| | Windows | Android |
|---|---|---|
| Source | `native/windows/BunnyA` (WPF, `net8.0-windows`, SDK pinned 8.0.408 by `global.json`, no NuGet feeds) | `android/app/src/main` (Views, Java 8 bytecode, AAPT2/D8/apksig, no Gradle) |
| Version | assembly unversioned | `versionCode 3`, `versionName 2.1`, package `com.routeragent.jev`, min 26 / target 35 |
| Launch | `BunnyA.exe`, single-instance mutex, close hides to notch | launcher = `MainActivity` (WebView); `NativeCompanionActivity` registered, not exported |
| Host API | `/state`, `/command` with `expect{hostId,epoch}` and a fresh `operationId` per call | HTTPS gateway `api/bunny-native-v1-state`, `api/bunny-pair`; Keystore AES-GCM session |
| Build tooling | `native/windows/build.ps1` (Debug) | `scripts/prepare-android-native-tools.ps1`, `scripts/build-android.ps1` (exact Java `21.0.11`) |
| CI | `native-windows-preview.yml` (path-filtered) | `native-android-preview.yml` (path-filtered) |

Baseline build on this workstation: Windows Debug build passed. Android build refused: local Java is `21.0.12` and the
lock required exactly `21.0.11`.

## Deficiencies found in the audit (each fixed in MA5-S1 unless noted)

Windows:
1. Approval Center: every 3 s refresh replaced the list and auto-selected row 0, so the selection (and the detail pane)
   could jump to a different request between review and click.
2. Mission plans were approved without the reviewed plan reference (`mission.approve` without `plan`).
3. Persistent-task actions showed invented scope/effect text instead of the Host's `action.inspect` facts.
4. Personal-agent chips showed `WORKING` for the slot configuration flag `active` (true by default): all four agents
   always appeared to be working.
5. Voice controls read `voice.listening` / `voice.speaking`, fields the Host does not send; the transcript box
   printed canned text ("Processing audio transcription with whisper.cpp…").
6. "Test AI Connection" ran the hosted TypeSafe test and always announced "Local Ollama model connection verified".
7. Settings checkboxes (thermal auto-stop, resume on start) had no handlers; resume-on-start showed checked while the
   Host default is off.
8. Device rows read `paired_at` / `revoked_at`; the Host sends `createdAt` / `revoked`.
9. Cancel and the notch Stop guessed between `stop`, `mission.stop` and `ptask.cancel`, swallowing errors.
10. `project.create` was sent with `confirmed=true` without asking the owner.
11. Most lists had no item text (rows rendered as C# record dumps) and no accessible names.
12. A malformed field anywhere in `/state` aborted the whole refresh; the chat polled `/state` every 250 ms.
13. Notch: placed on the primary monitor only, position not persisted, agent icons static, vertical layout without
    approval/stop, controls not keyboard reachable, no reduced-motion handling.

Android:
1. Chat waited in a loop on the single worker thread for up to 60 s, so Stop was queued behind it.
2. No lifecycle: no polling outside explicit refreshes, nothing stopped in `onStop`.
3. All failures led to one generic "offline" page; Host refusal text was discarded.
4. Commands carried no Host identity or epoch.
5. Keyboard insets were ignored once edge-to-edge drawing was enabled (API 30+).
