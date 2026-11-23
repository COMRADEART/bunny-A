# Bunny-A M-A-0 — Architecture

Branch `ma0-mission-architecture`, baseline `ea0e803`. Companion documents: [compatibility](MA0_COMPATIBILITY.md), [security](MA0_SECURITY_MODEL.md), [capabilities](MA0_CAPABILITY_MODEL.md), [state machine](MA0_MISSION_STATE_MACHINE.md).

Updated for Review 0 remediation M-A-0R; the original architecture and router remain in place. Finding evidence: [remediation report](reports/MA0_REMEDIATION_REPORT.md).

## 1. Old architecture (unchanged, still first-class)

```
UI (web Island / native WPF Island / phone)
  → same-origin bridge (src/lib/orch/host-bridge.server.ts)
  → Bunny-A Host HTTP (127.0.0.1:43119, bearer or paired-device token)
  → TaskManager (src/lib/bunny-host/manager.server.ts)
      → BunnyRouter (hard eligibility + scoring + learned policy)
      → waiting_for_approval  ── approve(id) by the user ──►
      → ProviderAdapter (Codex / Claude Code / Ollama) owned session
      → optional independent verification (VerifySpec)
      → SQLite (tasks, events, outcomes) → snapshot / SSE
```

## 2. New architecture (added above TaskManager)

```
                           USER (workstation / paired phone)
                                      │
                         Host /command  (validated)
                    ┌─────────────────┴──────────────────┐
              DIRECT TASK                              MISSION
             (unchanged path)                  MissionManager (bunny-missions/manager.server.ts)
                    │                                   │ plan (planner.server.ts) → bounded DAG
                    │                                   │ one scoped approval → AuthorizationEnvelope
                    │                                   │ scheduler: ready steps, concurrency, workspace locks
                    │                       ┌───────────┴─────────────┐
                    │                 model step                deterministic step
                    │                       │                         │
                    │      TaskManager.submit(…, delegated)     CapabilityBus.request()
                    │      TaskManager.approveDelegated()        ├─ filesystem / terminal / git
                    │                       │                     ├─ browser (isolated profile)
                    │                 BunnyRouter                 ├─ computer (UI Automation)
                    │                       │                     ├─ notifications / github
                    │                 ProviderAdapter             └─ email/calendar/sms/whatsapp/phone (unconfigured)
                    │                       │                         │
                    └───────────────────────┴──── Bunny's own verification (file / command / git diff / artifact / TaskManager VerifySpec)
                                                        │
                                       Artifact store (by reference) · Mission memory · Inbox · Event journal
                                                        │
                                                  Mission result
```

The MissionManager never imports or calls a provider adapter. Every model-backed step is an ordinary `OrchTask` created through `TaskManager.submit()` and launched through `TaskManager.approveDelegated()`, so routing, eligibility, session ownership, streaming, Stop, verification and outcome learning are the existing ones.

## 3. Module map (`src/lib/bunny-missions/`)

| Module | Responsibility |
|---|---|
| `types.ts` | All mission, step, envelope, capability, artifact, memory, inbox, trigger and skill contracts. |
| `machine.ts` | Mission and step transition tables, DAG validation (cycles, unknown deps, size), ready-step computation, failure propagation, progress, category-specific retry policy, task-failure classification. Pure. |
| `store.server.ts` | Additive SQLite tables on the Host database, config/feature flag, secret redaction. |
| `planner.server.ts` | Deterministic planner `bunny-planner-deterministic-v1`; explicit user graphs are validated here. |
| `authorization.server.ts` | Scope request derived from the plan, envelope creation, parameter-level scope checks, the single `decide()` permission function, child-task envelope check. |
| `manager.server.ts` | MissionManager: create/plan/approve/start/schedule/verify/retry/replan/stop/respond, recovery after Host restart, trigger actions, snapshot. |
| `context.ts` | AgentContext prompt for a model step (objective, dependency summaries + artifact references, verified facts, folder/access, output contract). |
| `capabilities/bus.server.ts` | Capability Bus: registry, health, decision, execution with timeout/abort, run records, artifacts, events. |
| `capabilities/local.server.ts` | filesystem, terminal, git, notifications adapters. |
| `capabilities/process.server.ts` | Shell-free executable resolution and owned-process execution. |
| `capabilities/browser.server.ts` | Browser Runtime (Playwright persistent context on a Bunny-owned profile). |
| `capabilities/browser-network.server.ts` | Browser checking proxy: resolve/check every destination, then connect to the approved literal IP for HTTP, CONNECT and WebSocket traffic. |
| `capabilities/git-merge.server.ts` | Owned Git merge transaction, independent cancellation cleanup and explicit cleanup results; no reset. |
| `capabilities/computer.server.ts` | Computer Runtime (Windows UI Automation / user32 via PowerShell). |
| `capabilities/connectors.server.ts` | GitHub (gh CLI, read-only) and unconfigured communication connectors + `CommunicationProvider` contract. |
| `skills.server.ts` | Skill Library: built-in skills, versioning, verified repair, record/replay. |
| `artifacts.server.ts` | Artifact Bus: inline (≤64 KB) or file artifacts with SHA-256, consumers, verification status. |
| `memory.server.ts` | Bounded mission memory with provenance and verified/unverified separation. |
| `inbox.server.ts` | Bunny Inbox: classification of Host events, rule-based suggestion, acknowledgement. |
| `triggers.server.ts` | Trigger abstraction, validation, rate limits, disabled by default. |
| `workspace.server.ts` | Shared/exclusive workspace locks (persisted). |
| `commands.server.ts` | Host command handlers and remote/workstation authorization for mission actions. |

## 4. MissionManager and the Agent Runtime

An *agent* is a mission step with a `role` (free text; the planner uses Planner, Research, Architect, Coding, Debugging, Documentation, Test, Reviewer, Search, Computer, Browser, Git … but the runtime treats roles as labels). Each step declares objective, dependencies, required capabilities, reasoning level, access (`read`/`write`), isolation (`shared`/`worktree`), provider constraints, optional model constraint, expected artifacts, verification criteria, retries, timeout and optional weight.

Execution kinds (`StepExecutor`):

* `model` — a child `OrchTask`. Reasoning `light` routes in Fast mode, `deep` in Deep mode, otherwise the mission's mode; `local` preference and an exhausted external-call budget add the `localOnly` constraint. The prompt is built by `agentPrompt()` and contains only the step's dependencies (summaries ≤1,200 characters plus artifact references), verified facts and the output contract — never other agents' transcripts.
* `capability` — one Capability Bus action.
* `skill` — a Skill Library workflow (sequence of capability actions).

Agents cannot create agents: there is no API for a step to add steps; only `mission.create`/`mission.replan` (bounded by `maxSteps`, `maxReplans`) change a graph.

## 5. TaskManager relationship

Additions to `TaskManager` (all additive):

* `submit(input, delegated?)` — the optional second argument is passed only in-process by the MissionManager. It records `task.mission = {missionId, stepId}` and the step's immutable `executionScope: {access: "read"|"write"}`. It may set the working directory to a Host-owned mission worktree under `<data>/worktrees`; the folder must be an approved project root, the default root, or inside `workspaceRoots`.
* `approveDelegated(id, {missionId, stepId, authorizationId, check})` — refuses tasks that are not this step's child, re-runs `check` (envelope) at launch time, then runs the same launch path as `approve(id)` and journals `approval.delegated` (never `approval.accepted`). The task record gets `approval: {kind: "mission", authorizationId, …}`.
* `approve(id, by?)` — legacy direct behavior and `approval.accepted` remain; the optional actor adds a remote-device audit event. All mission-child launches, including extra direct approvals, pass the installed mission scope validator. Scope/mission-link mutations are refused and adapters receive a frozen scope snapshot.

For models: user approval → envelope step/session authority → step access → child execution scope → existing adapter configuration. `providerScopeViolation()` enforces child ≤ step ≤ envelope; role names are labels. Codex read uses its read-only sandbox; Claude read exposes only its Read tool. Unscoped direct tasks keep previous defaults. For deterministic work: envelope → capability decision/grant → existing capability adapter. Session counts, retry ceilings, access and provider-internal shell authority are shown before approval; provider-internal side effects remain a disclosed CLI trust boundary (M1 mitigation).

## 6. Capability Bus, Browser Runtime, Computer Runtime, Skills

See [MA0_CAPABILITY_MODEL.md](MA0_CAPABILITY_MODEL.md). Summary of the execution preference that the planner and skills follow: native API/library → CLI → browser DOM → UI Automation → (no raw input injection is offered) → local model → external model. Known requests (`run the tests`, `build`, `typecheck`, `lint`, `git status`, `capture screen`, `open <url>`, `download <url>`, `open notepad`, `list windows`, and `… and then …` chains of them) are planned as skill/capability steps with zero model calls.

## 7. Mission memory and Artifact Bus

* Memory kinds: `mission_state`, `verified_fact`, `agent_conclusion`, `artifact`, `user_decision`, `skill_knowledge`. `verified` can only be true for provenance `bunny:verification:*`/`bunny:capability:*` (facts) or `user:*` (decisions). Provider conclusions are always stored unverified. 300 entries per mission; verified facts and user decisions are never trimmed. Stored in the Host database (`mission_memory`), not React state.
* Artifacts: `source_file, patch, research_note, browser_evidence, test_report, screenshot, build_artifact, plan, specification, review, structured_result, text, download`. Inline up to 64 KB, otherwise a file under `<data>/artifacts/<mission>/` (or the file a capability wrote inside an approved root). Every artifact has SHA-256, byte size, producer step, provenance, verification status and a consumer list; dependents receive an excerpt + reference.

## 8. Authorization, persistence, Inbox, triggers

* Authorization: [security model](MA0_SECURITY_MODEL.md).
* Persistence: schema v3; events gain `mission_id`; new tables `missions, mission_steps, mission_dependencies, mission_artifacts, mission_authorizations, permission_requests, capability_grants, capability_runs, skills, skill_versions, triggers, inbox_events, mission_memory, workspace_locks`; recorded once as `ma0.missions.v1` in `migrations`. Details in [compatibility](MA0_COMPATIBILITY.md).
* Inbox: every Host event passes `Inbox.classify()`; the listed types become `informational / requires_attention / requires_approval / failure / completed / external_event` items with a rule-based suggestion (`ignore / notify / ask_user`). Mission children's own `approval.required` / `task.*` are excluded (the mission reports them). Answered requests are acknowledged by the Host.
* Triggers: sources `schedule, mission_event, system_event, capability_event` have feeds; `filesystem, github, message, email, calendar` are in the contract but creation is refused ("no event feed on this Host yet"). New triggers are disabled; the engine also requires the global `triggersEnabled`. Actions: Inbox notification, or a mission *draft* that stops at `waiting_for_approval`.

## 9. UI state flow

```
Host snapshot.missions (MissionSnapshot) ─► useIsland.missions ─► mission-model.ts (pure)
   focusMission → Bar strip  |  agentRows → glyph chips (+N)  |  agentDetail → panel  |  progressLabel
User actions → useIsland.{approveMission, respondMission, stopMission, retryMission, configureMissions}
   → commandBunnyHost → Host /command → MissionManager → new snapshot
```

The UI holds no orchestration state: missions, requests, progress and activity all come from the Host. Bunny Bar (`floating.tsx`): compact mission strip while a mission is live, expanded Mission Control (`mission.tsx`), a completion line for 8 s after a mission ends, auto-collapse using the existing preference. Provider rings and telemetry are untouched. Motion follows the existing global Reduced/Off rules.

## 10. Phone flow

The paired phone uses the same bridge and cookie-held device token. Allowed remotely: `mission.create` (planner-derived graphs only), `mission.get`, `mission.approve`, `mission.start`, `mission.respond`, `mission.stop`, `inbox.ack`. Everything else is workstation-only. If the Host is offline the phone cannot execute anything; the existing on-device draft queue still applies to the composer text.

Desktop and phone approval grant the same persisted requested envelope. A phone cannot supply broader roots, access or session budgets. Envelope, delegated launch, extra capability and remote-device approvals have distinct journal types.

## 11. Failure and recovery

Category-specific retries (`machine.ts:retryVerdict`), reroute only when another eligible provider exists, dependency failure blocks dependents, permission/budget/host-restart wait for the user, user stop never retries. On Host start the TaskManager still fails interrupted child tasks ("cannot reattach"); `MissionManager.recover()` marks their steps `failed/host_restart`, marks running capability runs `interrupted`, releases locks and puts the mission in `waiting_for_user` with a recovery note. `mission.retry` starts fresh child tasks. Nothing is resumed.

Stop now blocks new scheduling while it cancels and awaits active capability cleanup, then persists a truthful Stop result. Git cleanup uses a fresh bounded signal and requires proof of transaction ownership. Provider retry/reroute retains execution scope; replanning requires a new displayed scope and approval. Old JSON records remain unchanged and missing provider authority fails closed.

## 12. Future connector model

New external capabilities register as `CapabilityAdapter`s on the bus (manifest + health + execute). Communication backends implement `CommunicationProvider` (`sendMessage, receiveMessages, startCall, speak, listen, hangUp, transcript`) and replace the `UnconfiguredConnector` for their channel. MissionManager needs no change.
