# MA5-S2 Architecture and gap analysis

The topology is still the one from MA5-S1 (docs/ma5-s1/ARCHITECTURE.md). Both native apps are clients of the Node.js
Host, which remains the only authority for routing, models, approvals, voice sessions and device scope.

## Contract inventory (verified in code at `f6c51ea`)

| Area | Host contract | Native Windows (start of S2) | Gap |
|---|---|---|---|
| Registered folders | `connector.roots.list/set` (workstation-only; Host refuses system, application and Bunny state folders) | none | **Closed in Phase 1A** |
| Connected-task planning | `ptask.plan` → `{ok, spec, team, problems, advisories?}`; spec validated by `TaskSpecSchema` + `validateTask` + intent checks; model pin must be in the envelope; envelope is local-only by schema | none | **Closed in Phase 1A** |
| Task creation | `ptask.create {spec, envelope}`: Host re-validates; no approval needed → `QUEUED` and runs at once; otherwise `AWAITING_APPROVAL` | none | **Closed in Phase 1A** |
| What Create will do | not exposed before create | n/a | **Closed**: `ptask.plan` now adds `review` (approval required?, per-step category/consequential/registered from Host executor facts) |
| Whole-task approval | `ptask.approve {id, version}` | Approval Center listed only per-action approvals; a task waiting for whole-task approval was invisible | **Closed in Phase 1A** (`ptask_launch` rows) |
| Per-action approval | `action.inspect/approve/deny`, payload-hash bound | present (MA5-S1) | none |
| Pause/Resume/Cancel/Reconcile | `ptask.pause/resume/cancel/reconcile` | present (MA5-S1) | none |
| Agent teams / coordinator | `agent.create` (team), `agent.start`, `agent.team.approve/revise`, `agent.pause/resume/stop`; `teamView.coordinatorAgentId` | team plans approved with `mission.approve`, which the Host refuses for teams; coordinator not read | **Closed in Phase 1B** (TEAM_COORDINATION.md) |
| Mission history | `mission.get`, ptask views, `action.receipts` | Task History list + reconcile | Phase 1C (not started) |
| Voice | `voice.session.open/close`, `voice.listen.start/end`, `voice.interrupt`, `voice.mute`, `voice.text`, `voice.control.confirm/cancel`, `voice.devices`, `voice.state`; worker `native/voice/BunnyVoiceWorker.cs` (`bunny-voice/1`); `voice-session.server.ts`, `voice-turn-taking.ts` | Voice Studio wiring (MA5-S1) | Phases 3–4 (not started); physical acoustic qualification is BLOCKED until a real microphone/speaker run is authorized |
| Paired devices | `device-authority.server.ts` allowlist; `publicTask` blanks outputs | Android companion (MA5-S1R2) | Phase 5 (not started); re-pair after address change is open |

## Interface changes made so far

1. `ptask.plan` result gains `review` (additive; existing clients ignore it). Create still re-validates everything.
2. `HostClient.SendCommandAsync` gains an optional per-command timeout (used only for `ptask.plan`, 5.5 min; the Host
   aborts the Planner at 5 min). A timed-out plan is a read-only proposal: nothing to reconcile.

No device-visible contract changed; every new command use is workstation-only (`WORKSTATION_ONLY` in
`task-commands.server.ts`).
