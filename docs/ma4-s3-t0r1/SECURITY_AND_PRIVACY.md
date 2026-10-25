# Security and privacy

Candidate under test: installed archive of `97d188e86ba733dcb94525ac08a5a2639012d857`.
Closure diff (not in that archive): Android allowlist assertion and removal of `--test-force-exit`.

## Default-deny permissions

**PASS** on the installed UI.

Onboarding stored `implicitPermissionsGranted: 0`. The approval screen said cloud provider switching is off, local only, and hard requirements met for local only. Codex and Claude were rejected as cloud providers. `deepseek-v4.1-flash:cloud` was not eligible. The goal review listed allowed actions `file.read`, `local.generate`, and `local.review`, and said nothing happens until approval.

## Hard model pins

**PARTIAL.**

Served model names on the three UI tasks matched the model shown on the approval screen (`huihui_ai/qwen2.5-abliterate:7b`). The cloud tag was not substituted in.

The onboarding field `selectedLocalModel` (`qwen2.5-coder:7b`) is stored and is not applied as the task route. The router chose a different eligible local 7b. That stored preference is not a hard pin on the task path.

## No unauthorized cloud inference

**PASS** for the tasks this qualification approved.

Local-only was on. The session ledger for the first completed task was 1 local and 0 other, Ollama local device. The cloud Ollama tag was excluded by the privacy rule. No OpenRouter call was available. Codex and Claude were not started.

The machine has signed-in Codex and Claude CLIs. Discovery reported them ready. The local-only constraint kept them off these tasks. This qualification did not turn local-only off.

## No blind replay

**PASS** for the interrupted task's replay surface.

The failed task offers a replay timeline of persisted events. The visible copy says gaps are not inferred, final output appears only at completion, and at the start of the timeline no output is retained. The public activity says the old session was not resumed and a retry starts fresh work. Replay was not used to re-execute the provider.

## Secret isolation

**PASS** for the feedback path exercised here.

The preview and the on-disk entry replaced the synthetic `sk-` value and the synthetic bearer with `[REDACTED_SECRET]` and `[REDACTED_TOKEN]`. `remoteUploadDispatched` was false. The Host bearer token was not written into these documents or into the feedback file. The isolated `credentials.json` was removed with the install root.

## Revocation

**NOT TESTED.**

No device was paired. The Devices page had no revoked row to display. Connection revocation behavior in unit tests is part of the local regression and is not hardware evidence.

## Signing and release gate

**BLOCKED.**

`productionReleaseGate` remains `BLOCKED`. Signing status remains `UNSIGNED` or `TEST_SIGNED`. This milestone did not sign a production artifact.

## Android permission claim

**Errata.** The internet-only flag is false once `POST_NOTIFICATIONS` is declared. The closure test expects exactly `INTERNET` and `POST_NOTIFICATIONS`, and expects `leastPrivilegeInternetOnly === false`. Merge-commit CI still fails the old assertion. See `ANDROID_HARDWARE_QUALIFICATION.md`.
