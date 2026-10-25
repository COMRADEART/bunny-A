# Windows installed qualification

The candidate was built from the git archive of `97d188e86ba733dcb94525ac08a5a2639012d857` and installed in an isolated root. The real `%LOCALAPPDATA%\Bunny-A` tree and the real Startup shortcut were not modified. The real Startup shortcut still targets `Bunny-A-Windows-MA3-T13-UPDATE-TEST`.

## Package

| Field | Value |
| --- | --- |
| Release | `Bunny-A-Windows-S3T0R1-1-TEST` |
| Source and tooling commit | `97d188e86ba733dcb94525ac08a5a2639012d857` |
| Zip | `releases/Bunny-A-Windows-S3T0R1-1-TEST.zip` |
| Zip size | 183109673 |
| Zip SHA-256 | `d53679f5d4458db6c6cb52071ea7b1aa8d0ddca8bba07ff1c4835e6a4f284961` |
| Manifest SHA-256 | `42ebbfd08abb6c817e32a008fd5977cdd24c9ffb5a38bb22356f8f6fef8bdbe3` |
| Install root | `%LOCALAPPDATA%\Bunny-S3T0R1-Install` |
| Workspace | `%LOCALAPPDATA%\Bunny-S3T0R1-Workspace` |
| Shortcut | `%LOCALAPPDATA%\Bunny-S3T0R1-Install\startup-scratch\Bunny-A.lnk` |
| Host port | 43217 |
| Dashboard | `http://127.0.0.1:8084/` |
| First host instance | `b7fe2e98-0c6b-4785-8761-f183dfa243c7` (pid 11988, then replaced) |
| Gateway pid while the host was replaced | 7864, still the same gateway |

## Onboarding

Host setting `guided_onboarding_v1` after Finish, and again after the Host process was replaced:

- status `done`, stage index 9, stage `first-safe-workflow`
- preferred name Ravi, language `en-US`
- selected local model `qwen2.5-coder:7b`
- background execution opt-in true
- native notifications opt-in false
- phone pairing skipped, voice check skipped
- implicit permissions granted 0
- automatic startup false
- cloud inference false

The ten stage ids are `welcome`, `local-architecture`, `preferences`, `local-model-readiness`, `model-selection`, `permissions-boundary`, `background-execution-opt-in`, `phone-pairing-optional`, `voice-check-optional`, `first-safe-workflow`. A dashboard reload did not put the onboarding region back. Classification: **PASS** for completion and restart persistence. The stored model is not what the task router selected; see errata in `ENGINEERING_REPORT.md`.

## Ollama and model selection

Host `/state` reported Ollama `ready` with five tags. `deepseek-v4.1-flash:cloud` is listed in `remoteModels`. The approval screen marked that tag not eligible: privacy keeps data on this workstation. Codex and Claude were ready on the machine and rejected while local-only was on, because they run in the cloud. OpenRouter, OpenCode, Cline, and Cursor stayed unavailable.

Approved tasks ran `huihui_ai/qwen2.5-abliterate:7b`. The onboarding selection `qwen2.5-coder:7b` stayed eligible and was not the routed model.

## First approved task

- id `95b798e2-3fdf-42ff-a326-815665e491a7`
- title `Reply with exactly the word READY and nothing else.`
- state `completed`, `stopReason` null, error null
- UI duration 00:13, Ollama, result ready
- Activity: independent verification was not established
- Session ledger on that run: 1 local, 0 other

Classification of completion: **PASS**. Classification of independent verification: **PARTIAL**. A chat task has no verify spec, and the product says verification is separate.

## Goal, monitor, approvals

Goal `Record the watch status once` was reviewed and approved in the UI. Review text: one success criterion, progress counts only when a linked task completes with verified step receipts, allowed actions `file.read`, `local.generate`, `local.review`, budget 20, ends 2026-12-23. After approval the row was `Goal · Active`, `0 of 1 criteria met`.

Monitor `Status watch` (`mon-8d042f4e-9d16-42ee-ab17-1c35acc2f5f3`) was approved against folder `C:\Users\allam\Documents\Bunny-S3T0R1-Watch`, JSON field `status`, transition PASS to FAIL, every 1 minute. Detail is in `NOTIFICATION_DELIVERY.md`.

Approval Center while the second task was waiting: nav badge `Approvals 1`, heading `Use Ollama?`, button `Approve & Run`. After that task completed, the center read `Nothing needs you` / `No approvals waiting.`

## Devices

Devices page: `Live · Windows Host owner`. Remote access is not configured. `Create workstation pairing code` was disabled. Secure address unavailable. No paired device was present, so a revoked row could not be shown. Revocation on a device: **NOT TESTED**.

## Feedback

See journey D. Stored file hash before delete: `edef373d1bbbe022c56c8e1215387359ea69482cf3e40e5e88502a939b6d1ed7` (372 bytes). After per-entry Delete: 0 entries, hash `77351f4da6c66ba76ba754abad6e773a2fe4b4fadb8757c10b58d9cc0fe23640` (73 bytes). The same hash survived the Host replacement before Delete. Export from the UI produced the same 372-byte payload, with the secret-shaped text already redacted and `remoteUploadDispatched` false.

`diagnostics.health` rendered `Host health is unavailable.` The feedback list still loaded. Health panel: **PARTIAL**.

## Notifications

Settings copy, observed twice: "Foreground banners while this window is open. Closing the window stops operating-system delivery. There is no background Windows toast in this build." Enable saved `Permission: granted. Host notifications on.` No operating-system toast was displayed by that click. Background toast: **unsupported**.

## Restart, rollback, uninstall

SIGTERM to host pid 11988, confirmed by command line to be `Bunny-Host.mjs` under `Bunny-S3T0R1-Install`, while task `56104627-ff56-4afd-a819-870ba695a5ce` was `running` and `stopReason` was null. Health on port 43217 then timed out. `Start-Bunny-Release.ps1 -NoIsland` exited 0. New host pid 5964, app `Bunny-A`. Gateway pid stayed 7864. Onboarding and the feedback file were unchanged. The interrupted task became `failed` with the restart-walk error. The two completed tasks stayed `completed` with null `stopReason`.

The dashboard, immediately after the process replacement, showed `Reconnecting`, `Workstation unreachable`, and `Offline. Mission progress stays on the Host until this window reconnects.` Refresh then showed `Host` `Live` and the failed row `View error details Failed 00:33`.

Rollback command from `rollback\20261024-205143-fe382eb6\ROLLBACK.md`, pointed at the scratch startup directory:

`Legacy rollback was refused: no pinned prior install configuration exists.`

The rollback folder contained `ROLLBACK.md` and `rollback.json` only. `install.json` and the scratch shortcut were still present after the refusal. First-install rollback: **PARTIAL** (the product refused a prior-release switch because no prior install was pinned; it did not rewrite startup).

Clean uninstall removed only:

- `%LOCALAPPDATA%\Bunny-S3T0R1-Install` (including the scratch shortcut)
- `%LOCALAPPDATA%\Bunny-S3T0R1-Workspace`
- `C:\Users\allam\Documents\Bunny-S3T0R1-Watch`

Ports 43217 and 8084 were down before the delete. `%LOCALAPPDATA%\Bunny-A` still exists. The real Startup shortcut still targets the MA3 T13 release. Uninstall of this candidate: **PASS**.
