# Golden journeys

Each journey below was exercised on the isolated installed candidate `Bunny-A-Windows-S3T0R1-1-TEST` at commit `97d188e86ba733dcb94525ac08a5a2639012d857`, through the dashboard at `http://127.0.0.1:8084/`, except where a row says NOT TESTED.

## A. First-run onboarding to task completion

**PARTIAL.**

Onboarding finished and persisted (`status` done, stage `first-safe-workflow`, cloud inference false, implicit permissions 0, background opt-in true). The first approved local-only task `95b798e2-3fdf-42ff-a326-815665e491a7` completed on `huihui_ai/qwen2.5-abliterate:7b` in 00:13. The cloud Ollama tag and the cloud CLI providers were ineligible under local-only.

The task detail said `Verify unavailable` and the activity said independent verification was not established. Completion is evidenced. Independent verification was not established because this chat task has no verify spec.

The onboarding model pin `qwen2.5-coder:7b` was stored and was not the model the router ran.

## B. Approved monitor to one durable notice

**PASS** for the in-app notice. **Unsupported** for a background Windows toast.

One PASS-to-FAIL transition produced one notice, `Status changed: now "FAIL".`, at 09:19 PM. Later checks said no change and did not add a second notice. The away line stayed at one change while the check count rose from 12 to 16. Product copy states there is no background Windows toast. See `NOTIFICATION_DELIVERY.md`.

## C. Windows task supervision from Android

**NOT TESTED.**

ADB is not on PATH. No authorized phone was paired. The Devices page showed the workstation as the owner and remote access unconfigured.

During the Windows Host replacement, the dashboard itself showed `Workstation unreachable` and `Offline. Mission progress stays on the Host until this window reconnects.`, then `Live` after refresh. That is the Windows client reconnecting to its own Host. It is not Android supervision.

## D. Feedback submit, persistence, export, deletion, privacy

**PASS**, with the health panel **PARTIAL**.

1. Opt in, summary `Qualification note`, details containing a synthetic `sk-` string and a synthetic `Bearer` string.
2. Preview rendered `[REDACTED_SECRET]` and `Bearer [REDACTED_TOKEN]`.
3. Save wrote `state\logs\beta-feedback.json`, schema `bunny-beta-feedback/1`, one entry `fb-1792890820240-1`, `remoteUploadDispatched` false, support bundle null. The raw secret-shaped text was not in the file. SHA-256 `edef373d1bbbe022c56c8e1215387359ea69482cf3e40e5e88502a939b6d1ed7`.
4. After the Host process was replaced, the file hash was unchanged and the UI listed `Qualification note` with Delete.
5. Export from the UI produced a 372-byte JSON payload with the same id, redaction, and `remoteUploadDispatched: false`.
6. Delete removed the entry. File then had 0 entries, SHA-256 `77351f4da6c66ba76ba754abad6e773a2fe4b4fadb8757c10b58d9cc0fe23640`. The Delete button was gone.

Refresh of host health displayed `Host health is unavailable.` Feedback list and delete still worked.

## E. Manager shutdown during model execution, then recovery

**PASS.**

Task `56104627-ff56-4afd-a819-870ba695a5ce`, title beginning `Hold the local model`, provider Ollama, model `huihui_ai/qwen2.5-abliterate:7b`, was observed `running` with `stopReason` null. The owning Host pid 11988 (`Bunny-Host.mjs` under the isolated install) received SIGTERM at 2026-10-25T01:29:16.803Z. Port 43217 then failed health.

`Start-Bunny-Release.ps1 -NoIsland` started host pid 5964. The task row was then:

- state `failed`
- `stopReason` null
- error beginning `Host process restarted; this adapter cannot reattach its old pipes.`

The two earlier tasks stayed `completed` with null `stopReason`. Onboarding was unchanged. The UI timeline showed provider starting at 00:14 and task failed at 00:47, with the public line `Interrupted by Host failure or restart. The old session was not resumed; retry starts fresh work.` Reconciliation still read `No uncertain outcome is waiting.` Replay copy: `Gaps are not inferred. Final output and artifacts appear only at completion.` The replay scrubber at the start said `No output retained at this point.` Replay was not used to start a new model run.

This matches the restart walk. It is not the default user Stop text `User stopped the selected task.`
