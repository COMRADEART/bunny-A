# Installed UI observations (in progress)

Candidate: Bunny-A-Windows-S3T0R1-1-TEST, source and tooling commit 97d188e86ba733dcb94525ac08a5a2639012d857.
Install root: %LOCALAPPDATA%\Bunny-S3T0R1-Install. Host port 43217. Dashboard http://127.0.0.1:8084/.
Instance b7fe2e98-0c6b-4785-8761-f183dfa243c7. Shortcut only in the scratch startup folder.

## Onboarding

Host settings `guided_onboarding_v1` after Finish, and still present after a dashboard reload:

- status done, stageId first-safe-workflow, stageIndex 9
- preferredName Ravi
- selectedLocalModel qwen2.5-coder:7b
- backgroundExecutionOptIn true
- nativeNotificationsOptIn false
- pairedDeviceSkipped true, voiceCheckSkipped true
- implicitPermissionsGranted 0, automaticStartupEnabled false, cloudInferenceEnabled false

Reload briefly showed Reconnecting, then Host Live. Onboarding did not return.

## First task

Task 95b798e2-3fdf-42ff-a326-815665e491a7. Route Ollama, local only on.
Approval screen: cloud model deepseek-v4.1-flash:cloud not eligible (leaves the machine). Codex and Claude rejected as cloud. OpenRouter unavailable.
Selected model huihui_ai/qwen2.5-abliterate:7b. Onboarding pin qwen2.5-coder:7b was eligible and was not the routed model.
Approved from the UI. Completed in 00:13. UI: Result ready. Activity: independent verification was not established (no verify spec on a chat task). Session ledger: 1 local, 0 other.

## Monitor

Folder Watch registered at C:\Users\allam\Documents\Bunny-S3T0R1-Watch.
Monitor Status watch, id mon-8d042f4e-9d16-42ee-ab17-1c35acc2f5f3, ACTIVE, notify on, JSON field status, PASS to FAIL, every 1 minute.
First check 09:07 PM was an invalid reading (UTF-8 BOM from the first file write). File rewritten without a BOM as PASS, then later FAIL.
09:19 PM: one notice, "Status changed: now FAIL". Away line: 1 change found in 12 checks.

## Feedback

Preview text: Qualification note — Sample [REDACTED_SECRET] and Bearer [REDACTED_TOKEN].
Stored state/logs/beta-feedback.json: optIn true, remoteUploadDispatched false, details already redacted. Entry id fb-1792890820240-1.

## Notifications copy

Settings → Notifications: "Foreground banners while this window is open. Closing the window stops operating-system delivery. There is no background Windows toast in this build."

## Natural-exit chain

pretest, resource probe, and stages 0–3 exited 0. Agent stage command had no --test-force-exit.
Counts: stage0 387/387, stage1 1656/1656, stage2 58/58, stage3 260 pass / 1 skip / 0 fail.
Skip: MA4 live free-model Host contract (opt-in; never paid).
Stage 0 file list matches CI and omits scripts/voice-worker.test.mjs.
package.json test script: --test-force-exit removed after this chain.
