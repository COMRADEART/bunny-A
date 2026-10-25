# MA4-S3-T0R1 engineering report

Acceptance closure for the T0R foundation before MA4-S3-T1. No new model, agent, or Lotus Memory work was added.

## What this milestone qualified

The installed Windows candidate is the git archive of merge commit `97d188e86ba733dcb94525ac08a5a2639012d857` (PR #36). Zip SHA-256 `d53679f5d4458db6c6cb52071ea7b1aa8d0ddca8bba07ff1c4835e6a4f284961`. It was installed under `%LOCALAPPDATA%\Bunny-S3T0R1-Install` with the shortcut only in that tree's scratch startup folder, then removed. The existing `%LOCALAPPDATA%\Bunny-A` install and its Startup shortcut were left in place.

A fresh local chain, without `--test-force-exit`, exited 0: 387, 1656, 58, and 260 tests passed, with one opt-in skip (`MA4 live free-model Host contract`). `scripts/voice-worker.test.mjs` was not run. Both `npm run build` and `JEV_DESKTOP_BUILD=1 npm run build` exited 0 on the closure tree.

The closure diff does two things the installed archive does not:

1. `T4-ANDROID-1` expects the manifest permissions to be exactly `INTERNET` and `POST_NOTIFICATIONS`, and expects `leastPrivilegeInternetOnly` to be false.
2. `npm test` no longer passes `--test-force-exit` on the agent stage. The natural-exit chain is the evidence that stage exits without the flag. The edited script was not launched again as a single `npm test`.

## Installed behavior that held

- Onboarding completed and survived a Host process replacement, with cloud inference off and zero implicit permissions.
- Local-only approval rejected the cloud Ollama tag and the cloud CLI providers. The approved local model name was the model that ran.
- One chat task completed. The product reported that independent verification was not established.
- An approved file monitor emitted one in-app notice for PASS to FAIL and did not emit a second notice while the value stayed FAIL.
- Feedback was redacted before it was stored, survived the Host replacement, exported without an upload flag, and deleted from the UI.
- SIGTERM during a running Ollama task left `stopReason` null. The next Host marked the row failed with `Host process restarted` and did not resume the old session. Completed tasks stayed completed.

## Errata

These replace older engineering claims that this qualification contradicted.

1. **Internet-only Android manifest.** `leastPrivilegeInternetOnly: true` is false. The manifest declares `POST_NOTIFICATIONS`. Merge CI run https://github.com/COMRADEART/bunny-A/actions/runs/40142924080 fails `T4-ANDROID-1` on that assertion (expected true, actual false). The closure test states the two-permission allowlist. The installed `97d188e` package still carries the old test.
2. **`--test-force-exit` is not required for the agent stage.** A full stage chain exited 0 without it. The flag is removed from `package.json` on this branch. The proof is that chain, not a second run of the edited `npm test` line. `voice-worker.test.mjs` remains outside the CI-shaped stage 0 list.
3. **Full `npm test` on `97d188e` is not green.** Hosted full regression failed. Local green results are the closure tree, whose provenance test differs from that commit.
4. **Onboarding model selection is not the task pin.** `selectedLocalModel` `qwen2.5-coder:7b` persisted. The router ran `huihui_ai/qwen2.5-abliterate:7b`, which was eligible. Calling the onboarding choice a hard pin overstates it.
5. **Background Windows toasts are unsupported.** The installed Settings page says closing the window stops operating-system delivery and that this build has no background Windows toast. A granted `Notification` permission is not a window-closed delivery path.
6. **Android hardware was not tested.** No ADB binary and no authorized phone. Emulator output was not collected and is not evidence.
7. **First-install rollback does not restore a prior release.** The rollback folder had no `install.json`. The installer refused with `Legacy rollback was refused: no pinned prior install configuration exists.` and left the scratch shortcut in place. Uninstall of the isolated roots is what removed the candidate.
8. **Diagnostics health in the installed UI returned unavailable** while feedback list, export, and delete worked. A green feedback path does not mean the health command rendered.
9. **Independent verification is not implied by task completion.** The completed chat task's activity said verification was not established.

## Release posture

Public beta is **NO-GO**.

Signing is `UNSIGNED` or `TEST_SIGNED`, and `productionReleaseGate` is `BLOCKED`. Android hardware, device revocation, and a real window-closed Windows toast are not evidenced. Merge-commit CI is red on `T4-ANDROID-1`. The closure branch fixes that assertion and still needs its own hosted run.

MA4-S3-T1 was not started.
