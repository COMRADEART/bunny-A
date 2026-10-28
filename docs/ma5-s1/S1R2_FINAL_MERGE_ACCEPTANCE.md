# MA5-S1R2: Final merge acceptance

Branch `ma5-s1-native-application-productization`. PR #59 was merged into `main` at `cd13801` (merge `dad2433`) before
S1R2 started, so the S1R2 commits are reviewed in follow-up **PR #60** (same branch, base `main`).
Details: S1R2_CHAT_OUTCOME_RECOVERY.md, S1R2_ANDROID_LIFECYCLE.md, S1R2_FAULT_INJECTION.md. Device evidence:
`evidence/s1r2/android-device/`.

## Gates

| Gate | Requirement | Verdict | Evidence |
|---|---|---|---|
| R2-G1 | Chat leaves "Sending…" after an uncertain outcome | **PASS** | Device A-before (stuck "Sending…", Send enabled) → A-after/C/D/N ("Outcome unknown"); ChatTurnTest C1 |
| R2-G2 | Original operation ID preserved | **PASS** | Chosen before dispatch, stored, used for every check: 21/21 device `operation.status` reads carried the original id; ChatTurnTest C1, C6 |
| R2-G3 | Original Host identity and epoch preserved | **PASS** | Checks send `expect` with the original epoch; device C: restarted Host refused with `HOST_EPOCH_CHANGED` and the message stayed unknown; ChatTurnTest C2 (other epoch / other Host rejected, even `applied`) |
| R2-G4 | No automatic duplicate submission | **PASS** | Device: 8 submits, all deliberate taps, 0 re-sends across restarts, recreation, network loss and gateway/Host restarts. Send disabled while unresolved; new send only after "I UNDERSTAND" |
| R2-G5 | Read-only reconciliation works where supported | **PASS** | Device A-after and N: `applied` + task id (new narrow Host field) → followed to completion. Host test asserts the field; another principal still gets `unknown` |
| R2-G6 | Unknown and failed outcomes remain accurately classified | **PASS** | Device D (`unknown` → "does not prove it never ran"); ChatTurnTest C2/C3 (`failed` → "may have partly applied"; unclassified errors → unknown, never "not sent") |
| R2-G7 | Dialog dismissal retains correct state | **PASS** | Device D/E, C, B: after OK the line shows its real state; the dialog holds no state |
| R2-G8 | Activity lifecycle does not lose safety state | **PASS** (device) / limits below | Tabs, background, rotation, force-stop, update kill, network loss, gateway and Host restart (S1R2_ANDROID_LIFECYCLE.md). Low-memory kill not driven |
| R2-G9 | Real-socket lost-answer regression passes | **PASS** | ChatTurnTest C1 (JVM, real socket reset after the body; one delivery); gateway `native-companion.test.ts` 9/9; device A-after |
| R2-G10 | Android native build and tests pass | **PASS** | `scripts/build-android.ps1`: connection policy 21, Keystore erasure 5, PollPolicy 22, HostExchange 37, ChatTurn 55, manifest launcher; no `android.webkit`; `classes.dex` `00eb4fa6…4702` |
| R2-G11 | Existing Windows functionality remains intact | **PASS** | No Windows source changed. `native/windows/build.ps1` 0 warnings / 0 errors; Windows outcome harness against the modified Host: scripted 114/114, real Host 11/11 (`ma5s1r1-outcome-2026-10-28T20-42-32-698Z`) |
| R2-G12 | Five hosted CI jobs pass on the exact final SHA | **Decided in PR #60** | This file is part of the final commit and cannot cite its runs; the links are in the PR and the final report |
| R2-G13 | Physical claims supported by device evidence | **PASS** | Every device row cites `evidence/s1r2/android-device/` dumps, screenshots and the proxy log. JVM results are not counted as device results |
| R2-G14 | No release or installation over production | **PASS** | Disposable Host only; the owner's Host, state and Windows install untouched. The phone's Bunny A (previously the owner-approved S1R1 build) is now the S1R2 build, unpaired. Nothing released |
| R2-G15 | Ready for independent merge review | **PASS**, subject to R2-G12 | PR #59 was already merged; review happens in PR #60 |

## Local regression (final tree)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (includes `test:ma4`) | 2,534 tests: 2,533 pass, 0 fail, 1 opt-in skip (474 + 1,680 + 62 + 318 `test:ma4`) |
| `npm run test:ui` | 421 / 421 |
| `npm run build` | pass |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| `native/windows/build.ps1` | 0 warnings, 0 errors |
| `scripts/prepare-android-native-tools.ps1` | pass: pinned tools downloaded and hash-verified; the rebuild on them produced the same `classes.dex` `00eb4fa6…4702` the phone ran |
| `scripts/build-android.ps1` | pass (R2-G10) |
| Windows outcome harness | 114/114 scripted, 11/11 real Host |

`verify-ma5-s1-windows.mjs` (full WPF/notch drive) was not re-run: no Windows code changed and the Host change is one
additive response field.

## Remaining limitations

1. **Phone chat cannot show model answers.** The Host blanks task output for paired devices (`publicTask`). The phone
   now says so. Letting a device read the output of tasks it created is an owner decision (privacy boundary).
2. A message whose Host restarted, or whose ledger record expired (10 min) or was never received, stays "Outcome
   unknown" for good. The user resolves it by looking at Tasks (phone or Windows) and choosing "Send a new message
   anyway…". The phone cannot prove whether it ran.
3. After a process restart the phone shows when the open message was sent but not its text (by design: no message
   text is stored).
4. TalkBack, Android low-memory process kill, v3 data retention, re-pair after a gateway address change: NOT TESTED /
   open as before.
5. Rotation was set through `settings put system user_rotation`; auto-rotate on the phone was left **off**
   (`accelerometer_rotation 0`). Its value before the run was not recorded.
6. All S1 and S1R1 limitations stand (RELEASE_GO_NO_GO.md): physical voice, screen readers, display changes,
   cross-machine Windows builds, connected-task authoring on Windows, MA4 G7 quality, unproven skills/memory gains.

## Recommendation

- Engineering integration: **GO**.
- Merge: **GO for independent review**, once the five checks pass on the final SHA.
- Public beta: **NO-GO**.
