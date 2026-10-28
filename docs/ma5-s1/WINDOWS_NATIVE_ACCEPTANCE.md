# MA5-S1 — Windows native acceptance

Harness: `scripts/verify-ma5-s1-windows.mjs`. It starts an isolated Host on port 43189 with its own data directory,
credentials file and `BunnyA.exe` configuration, then drives the real WPF window through UI Automation
(`scripts/ui-automation-helper.ps1`). Every UI observation is checked against the Host snapshot or journal.
The owner's Bunny A data and the installed instance were not used.

Evidence: run `ma5s1-2026-10-28T06-19-18-229Z`, `BunnyA.exe` (Debug build of commit `394f4d1` sources) SHA-256
`3ac82b9adcbe18d132852d7d9ac5f98a72ccb77082041dafbedf5598ff634064`; all 9 stages `ok: true`
(`evidence/windows/summary.json`).

Display: two physical displays, as reported by Windows. DISPLAY1 is the built-in panel (3200×2000, work area
3200×1928, scale 150 %); DISPLAY9 is an external Samsung LS27D36xG (work area 1280×976 at (−1280, −164), scale 100 %).

Text-encoding note: in `w4b-roles.json` the `·` separator appears as `Â·`. This happened when the harness read UI
Automation text through a code-page conversion. The application text is correct (see the decision log in
`w5-approvals.json`). The evidence was left as recorded.

## W1 — Navigation

All ten screens are reachable from the sidebar and with Ctrl+1…Ctrl+0; F5 refreshes. Every interactive control
and list item has an automation name, because the harness finds everything by name. Lists render readable rows
(record `ToString`). PASS for navigation; see ACCESSIBILITY_RESULTS.md for the limits of the accessibility check.

## W2 — Host lifecycle (`w2-host-restart.json`)

| Check | Observed |
|---|---|
| Host stopped while the app runs | Within the poll interval the main window shows "Host not running" and the notch shows "Bunny A · Offline" / "Host not running" |
| Host down | 15 982 ms |
| Reconnect after the Host is back | 604 ms |
| Chat after restart | `completed`, ollama `qwen2.5-coder:7b`, output "12" |
| Duplicate submissions | 1 task for the prompt (no retry after the restart) |

Unknown command outcomes: a command whose connection is lost after sending is reported as "outcome unknown". It is
resolved by `operation.status` while the Host epoch is unchanged, and never by resending. This path is covered by
code review only; the harness did not cut a connection mid-command.

## W3 — Chat (`w3-chat.json`)

| Check | Observed |
|---|---|
| "Local only" + model list | `qwen2.5-coder:7b` selected. The Ollama cloud tag `deepseek-v4.1-flash:cloud` is not offered while Local only is on |
| Host routing | provider `ollama`, model `qwen2.5-coder:7b`, constraints `localOnly`/`offlineOnly` |
| Served model | Ollama digest `sha256:dae161e2…4364` equals the Host `servedModel.digest`; the UI label shows `digest dae161e27b0e90dd185` |
| Output | Host "62" = UI "62" |
| Stop | task `stopped`, UI shows cancelled |
| Submissions per prompt | 1 |

## W4 — Agent execution (`w4-mission.json`, `w4b-roles.json`)

- Delegate from the chat composer creates a Mission (after "Allow Missions" is switched on in Settings; it is off by
  default on the Host). The plan opens in the Approval Center rather than starting directly.
- Plan review: the UI shows the plan reference `06df0679…262d` (equal to the Host's). Approving a different
  reference is refused by the Host: HTTP 400, "The plan changed after it was reviewed…".
- Four-role Mission (Planner → Worker → Tester → Reviewer) ran sequentially to `completed`. At each sampled moment
  the UI step rows matched the Host step states, with the served provider and model per step. The Host routed all
  four steps to `huihui_ai/qwen2.5-abliterate:7b` through its unchanged routing; MA5-S1 does not choose models.
- Step results are shown as "not verified" because the Host reports `verified: null`. The UI invents no
  verification and no percentages; progress is `completed/total` from the Host.

Gaps (G3 PARTIAL):
- The native app cannot author persistent connected tasks (`ptask.plan` / `ptask.create`, `connector.roots`). It
  only supervises, approves, pauses, resumes, cancels and reconciles them.
- Team Missions need a coordinator id that the native UI does not ask for.
- The step view shows active Missions; History lists finished Missions without their steps.

## W5 — Approval Center (`w5-approvals.json`)

| Case | Observed |
|---|---|
| Approve | Host `payloadSha256` = UI digest. The Approve button stays disabled until the Host `action.inspect` context is loaded (scope "Folder ma5s1 (write)", side effects, recovery, approval window, receipts). After approval the file changed (`7343cfef…` → `5f54d628…`); the test receipt exit code was 0; the task reached `COMPLETED` with 6 action receipts and the ledger verified |
| Wrong hash | Host refuses with HTTP 400 "The action changed since you reviewed it; nothing was approved." |
| Deny | Task `FAILED`, file unchanged |
| Stale (task cancelled after review) | The row disappears and Approve is disabled. The only command the Host received was `ptask.cancel`, and `action.approve` never reached it. Task `CANCELLED`, file unchanged |
| Host restart during review | Epoch changed. The pending action survived on the Host. The UI cleared the selection, and Approve could not be used without a new review. After re-review and approval the task `COMPLETED` |
| Clicks without dialogs | No unexpected modal dialog on any step |

Before sending an approval, the client refreshes `/state`. If the item key (category | task | request | digest) is
gone, or the epoch changed, it logs "NOT SENT" and sends nothing.

## Settings, devices, voice wiring

- Thermal auto-stop, resume-on-start and Allow Missions are bound to `thermal.configure`, `ptask.policy` and
  `mission.configure`, reflecting Host values (the harness switched Missions on through the UI toggle).
- Voice Studio wiring (`voice-wiring.json`): open → `IDLE`, mute → `MUTED`, unmute → `IDLE`, close → no session. UI
  state matched the Host each step. Devices are reported by the Host (Intel Smart Sound microphone array; Realtek
  speakers; mic privacy allowed); engines are whisper.cpp v1.9.4 and Windows SAPI 5.4. Listening was never started:
  no capture, no playback. This is not acoustic qualification.
- Pairing shows the code with its expiry; device rows show creation time and revoked state.

## Verdict

Windows native: **PARTIAL**.
- W1, W2, W3 and W5 pass on real renders against a real Host.
- W4 passes for Missions but lacks native authoring of persistent connected tasks.
- Physical voice, screen-reader use, and resolution, DPI-setting and taskbar changes are not tested (see
  GLASS_NOTCH_RESULTS.md and PHYSICAL_TEST_STATUS.md).
