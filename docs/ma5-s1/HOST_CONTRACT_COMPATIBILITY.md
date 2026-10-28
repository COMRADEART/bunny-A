# MA5-S1 — Host contract compatibility

No Host source file changed (`git diff b93109a -- src/` touches only one test file, `voice-t2-eval.test.ts`, whose
Android source audit now reads every app Java file instead of the deleted `MainActivity.java`). The clients now use
the Host contract as it already is:

| Contract element | Host source | Native use |
|---|---|---|
| `expect{hostId,epoch}` refusal `HOST_IDENTITY_CHANGED` / `HOST_EPOCH_CHANGED` (409) | `http.server.ts` | Windows sends it on every command and refuses to send without a snapshot; Android sends pinned Host id + view epoch. |
| `operationId` idempotency, `operation.status` | `http.server.ts`, `OperationLedger` (in memory, 10 min) | Windows never retries; resolves an uncertain outcome with `operation.status` only within the same epoch. |
| `cursor` in `/state`, `/events?after=` SSE with 15 s heartbeat | `manager.server.ts`, `streamSse` | Windows reads from the current cursor; 45 s of silence reconnects. |
| `missions[].planReference` (waiting Missions), `mission.approve{plan}` | `remoteVerdicts`, `MissionManager.approve` | Windows approves the reviewed reference; a different one is refused by the Host (observed: HTTP 400 "The plan changed after it was reviewed"). |
| `action.inspect` context (scope, side effect, recovery, expiry, receipts) | `ma4/task-commands.server.ts` | Windows shows it and requires it before Approve. |
| `action.approve{payloadSha256}` | same | Hash from the Host snapshot (observed: wrong hash → HTTP 400). |
| `personalAgents.slots[].presentation.state` | `personal-agents.ts` | Agent chips and notch badges. `slot.active` is a configuration flag and is no longer shown as activity. |
| `voice` snapshot: `open`, `state`, `capturing`, `playing`, `muted`, `devices`, `finalTranscript`, `answer`, `error`, `turnId` | `voice-protocol.ts` | Voice Studio and notch. `voice.mute{muted}`, `voice.listen.end{turnId}`, `voice.session.close`. |
| `devices[]`: `createdAt`, `revoked` (after the viewer projection) | `http.server.ts` viewFor | Device list. |
| `thermal{cpuWarn,gpuWarn,autoStop}`, `thermal.configure` | `manager.server.ts` | Settings. |
| `persistentTasks.policy`, `ptask.policy{policy}` | `ma4/task-store.server.ts` | Settings (whole policy echoed with `resumeOnStart` changed). |
| `missions.enabled`, `mission.configure{enabled}` | `bunny-missions/manager.server.ts` | Settings ("Allow Missions"; off by default on the Host). |
| `project.create{confirmed}` | `project-service.server.ts` | Sent only after an explicit owner dialog. |
| `intelligence.jev.lastTest{ok,detail}` | `typesafe-jev.server.ts` | Shown after the hosted TypeSafe test. |
| `tasks[].servedModel{name,digest}` | `orch/types.ts` | Chat label shows the served digest. |
| Device launch rule `deviceMayLaunch` (Ollama only, not a cloud tag, not in `remoteModels`) | `device-authority.server.ts` | The Windows chat auto-starts only such a launch; other routes wait in the Approval Center. |

Gateway (`src/lib/orch/native-companion.server.ts`) is unchanged; it already forwards `expect` and the Host's refusal
`code` and `error`.
