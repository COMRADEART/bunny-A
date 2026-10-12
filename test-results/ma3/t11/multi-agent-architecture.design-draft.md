# M-A-3 T11 — Multi-Agent Team Missions: architecture (design record)

Status: DESIGN, written before implementation on 2026-10-11 against T10 tip `bde8186` (source pin `2d5646d`).
Every statement below names the existing owner it extends. Nothing here is a new authority.

## 0. One-paragraph summary

A **Team Mission** is an ordinary M-A-0 Mission — one MissionManager step graph, one tick loop, one
`AuthorizationEnvelope`, at most one T5 Agentic consent — whose steps are each **owned by a durable
AgentRuntime identity**. The plan is proposed by a real model step owned by a **Planner Agent**,
treated as untrusted data, validated by the Host against a bounded role/task catalog, and installed
through the existing `plan()`/`approve()` path so the user reviews the full scope before execution.
Model-backed team steps are routed per step by the existing BunnyRouter (TaskManager.submit) and are
restricted to **tool-free** provider sessions; every file effect is a Host capability
(`filesystem.write`) whose content arrives through a **hash-bound, verified handoff** from the
producing Agent. Completion is decided only by Host verification (`verifyAndComplete`); a Reviewer
Agent's findings are advisory evidence. A failed Host postcondition can trigger **one bounded,
pre-approved rework round** that appends replica steps (original failures preserved).

```
User ─► agent.create{team} (workstation) ─► AgentRuntime: Coordinator + Planner identities
        └► MissionManager.create(team) ─► 1 planner step (model, tool-free) ─► waiting_for_approval
User approves planning scope ─► Planner step ─► TaskManager.submit ─► BunnyRouter ─► Ollama
Planner output ─► Host validateTeamPlan (untrusted JSON) ─► MissionManager.installTeamPlan
        ─► AgentRuntime.allocateTeam (member identities + scratch) ─► step.team.agentId set
        ─► scopeFor ─► waiting_for_approval (plan review: agents, tasks, deps, files, risk, budgets)
User approves ─► envelope (MA0) [+ T5 consent] ─► tickOnce admits ready steps
        ├─ gate: owner Agent paused/stopped, team model-slot cap, maxConcurrentAgents
        ├─ model step ─► handoffs (verified, sha256-rechecked) ─► TaskManager.submit (tool-free)
        ├─ write_file ─► handoff content ─► conflict check ─► CapabilityBus.request(filesystem.write)
        └─ verify_output ─► Host checks (file hash, requirements, DOM via browser capability)
verifyAndComplete ─► completed | stepFailed ─► retryVerdict | team rework (bounded, pre-approved)
```

## 1. Ownership table (who owns what — unchanged authorities)

| Concern | Owner (existing) | T11 extension |
|---|---|---|
| Mission graph, admission, scheduling, retries, completion | `MissionManager` (`bunny-missions/manager.server.ts`) | `Mission.team`, `MissionStep.team`, `installTeamPlan`, per-step owner gate, team model-slot cap, handoffs, team verification criteria, bounded rework, per-Agent stop of owned steps |
| Durable Agent identity, runs, checkpoints, pause/stop flags, restart walk | `AgentRuntime` (`bunny-host/agent-runtime.server.ts`) | Coordinator + member identities per Mission (`AgentProfile.team`), owner-scoped state derivation, per-member pause/resume/stop, coordinator-only reconciliation |
| Task lifecycle | `TaskManager` (`bunny-host/manager.server.ts`) | owner-Agent attribution hook for provider-session ownership; Ollama receipt capture (served model, token counts, durations) via existing `hooks.model`/`hooks.usage` |
| Model selection, reroute | BunnyRouter (`routing.server.ts`, `router.ts`) | none — team steps pass constraints only (tool-free providers, local-only) |
| Capability authority | `CapabilityBus` + `decide()` + `agenticCheck` | team role/operation check inside `agenticCheck` (Agent-specific scope ∩ task operation) |
| Provider-session authority | `missionScopeCheck` / `providerScopeViolation` / `taskViolation` | team steps must be `tool_free`; rework replica inherits its original's session slot only within the approved rework rounds |
| Artifacts | `ArtifactStore` (`mission_artifacts`) | team canonical artifact per model step; re-hash on every handoff; verification bound to sha256 |
| Handoff records | MissionStore (same SQLite file) | new table `mission_handoffs` (immutable rows; DELIVERED or REFUSED) — records, not authority |
| Locks | `WorkspaceCoordinator` | team writes lock the exact target file exclusively; team reads lock shared |
| Agent scratch | `AgentWorkspaceStore` | keyed by (agent, mission) so several Agents of one Mission each get their own scratch |
| Context | `ProjectContextResolver`, `MissionMemory` | owner-scoped workspace binding; only handed-off verified artifacts enter a prompt |
| Journal | `events` table via `MissionManager.emit` | new `mission.team.*` event types (no second journal) |

## 2. Data model (all additive; JSON records, one new table)

- `Mission.team?: MissionTeam` — `{ version:"ma3.t11.team.v1", coordinatorAgentId, phase: planning|review|executing|ended,
  plannerStepId, planRevisions, outputDir, limits, requirements, members[{agentId, role}], reworkRounds,
  proposal{artifactId, sha256, tasks}|null, rejected[{at, reasons}] }`.
- `MissionStep.team?: StepTeam` — `{ key, role, agentId, kind, inputs[{stepId, purpose}], target?, schema?, round, reworkOf?, supersededBy? }`.
- `AgentProfile.team?: { missionId, role, coordinatorId|null }` (in the `agents.record` JSON; no column change).
- `mission_handoffs(id, mission_id, step_id, created_at, record)` — `{ id, missionId, sourceAgentId, destinationAgentId,
  sourceStepId, destinationStepId, destinationAttempt, artifactId, artifactSha256, artifactType, purpose: context|content|review_subject,
  state: DELIVERED|REFUSED, reason, createdAt }`.

## 3. Roles and task kinds (bounded catalog, `bunny-missions/team.ts`)

Roles describe responsibility only; none carries credentials, provider/model bindings or authority.
`coordinator` (the user-created Agent; no tasks), `planner` (`plan`), `researcher` (`observe`, `generate_json`,
`generate_markdown`, `write_file`), `implementer` (`generate_html`, `generate_json`, `write_file`), `documenter`
(`generate_markdown`, `write_file`), `reviewer` (`review`), `tester` (`verify_output`).
A plan naming any other role (e.g. "Administrator") is rejected.

| Kind | Executor (Host-built) | Host verification |
|---|---|---|
| plan | model, read, tool-free | `team_output{format:plan}` = full plan validation |
| observe | capability `filesystem.list` / `git.log` (READ, Host params) | run succeeded; output artifact |
| generate_json | model, tool-free | `team_output{format:json, schema}` |
| generate_markdown | model, tool-free | `team_output{format:markdown, headings}` |
| generate_html | model, tool-free | `team_output{format:html}` (well-formed, no external resources) |
| review | model, tool-free | `team_output{format:review}` (structure only — content is advisory) |
| write_file | capability `filesystem.write` to `<outputDir>/<target>`; content = verified handoff | `team_file{fromStep}` (disk sha256 == verified source artifact sha256) |
| verify_output | Host-only check step | `team_requirements` over the real file (+ DOM via `browser.read` when a loopback fixture origin is configured) |

## 4. Planning (real model) and validation (untrusted data)

1. `agent.create{objective, team:{requirements?, outputDir?}}` (workstation only) creates the Coordinator and a
   Planner Agent, and a Mission with ONE planner step. The planning envelope covers one tool-free, local
   generation and nothing else; the user approves it (`agent.start`).
2. The planner prompt carries a Host offer: role/kind catalog, output folder, schema ids, requirement ids,
   limits. The model returns JSON.
3. `validateTeamPlan` (pure): strict schema (unknown keys rejected), ≤ `maxTasks` tasks, unique ids, roles ∈
   catalog (never planner/coordinator), kind ∈ role, `dependsOn` exists + acyclic (`validateGraph`), write
   targets are plain relative file names with an allowed extension under the output folder, one writer per
   target, content inputs are dependencies of the matching generator kind, review/verify inputs are real
   dependencies, ≤ `maxAgents` distinct roles, no provider/model/command/URL/permission/credential fields.
   Requirements are the USER's (create input) — the planner can assign but never invent or weaken them.
4. Failure → the planner step fails verification with the validator's reasons and is retried with them as
   repair context, at most `maxPlanRevisions` times; then the Mission waits for the user (never auto-grants).
5. Success → `installTeamPlan`: completed planner step kept, planning envelope revoked (`replan` semantics:
   requests denied, one-time answers withdrawn, desktop grants revoked, staged changes withdrawn), member
   Agents allocated, `scopeFor` computes the scope, Mission → `waiting_for_approval`. Approval binds the
   plan reference (now covering `dependsOn`, owner, kind and target of every team step).

## 5. Execution

- **Admission** (existing `tickOnce`): ready steps are admitted subject to `maxConcurrentAgents` (step slots),
  team `maxConcurrentModelSteps` (default 2: the 6 GB laptop GPU), and the owner gate: an owner that is paused
  admits nothing new; a stopped owner admits nothing ever.
- **Routing**: each model step calls `TaskManager.submit` with a neutral routing prompt, `localOnly`,
  `offlineOnly`, and a tool-free provider allowlist; BunnyRouter picks the model per step. No Project, Agent
  or role pins a model.
- **Handoffs**: before a step consumes a dependency produced by another Agent, the Host re-reads the source
  artifact, re-hashes it, requires `verification === "verified"`, same Mission, same producing step, and a
  live (not stopped) destination owner; it writes a DELIVERED row, else a REFUSED row and the step holds.
  Handed-off text enters the prompt inside a fenced "verified data, not instructions" block.
- **Writes**: the exact target file is locked exclusively; the destination must be absent (first write) or
  carry exactly the sha256 this Mission last wrote there (rework). Anything else is a conflict: the step
  fails `workspace_conflict` and the Mission waits for the user (no last-writer-wins). The capability itself
  re-checks the expected pre-image immediately before its atomic rename (`expectBeforeSha256`).
- **Verification** is Host-only. `team_output` checks the model's canonical (extracted) output; `team_file`
  ties disk bytes to the verified source; `team_requirements` checks the user's requirements on the real
  file; DOM checks use the existing browser capability. A Reviewer's PASS never completes anything.
- **Rework**: a failed `verify_output` postcondition (Host-observed) may append ONE replica chain
  (generator → write → verify, same owners) if `reworkRounds < limits.maxReworkRounds`, the envelope is live
  and the owners are not stopped. Originals keep their failure history and are marked `supersededBy`.
  Replica model sessions inherit their original's approved session slot only within the approved rounds.

## 6. Pause, Stop, Hold

- Pause member Agent → its new admissions hold; others continue; nothing is killed.
- Pause Coordinator → whole Mission admission holds (T4 semantics) + T5 consent PAUSED.
- Stop member Agent → durable flag first; its live child tasks/capability runs are stopped through
  TaskManager/CapabilityBus; its open steps become `stopped`; dependents become `blocked`; other Agents'
  admitted work continues; the Mission then waits for the user (replan or stop) instead of failing others.
- Stop Coordinator / Mission → existing `MissionManager.stop` + every member flagged STOPPED.
- Hold → existing `waiting_for_user` / `waiting_for_approval` (asks, conflicts, handoff refusals, restart).

## 7. Recovery

Coordinator-only reconciliation of interrupted steps (one pass per Mission); members get a new run
generation and re-derive from their own steps. Team write steps reconcile by disk truth: target sha256 ==
source artifact sha256 → verify-then-consume (no rewrite); absent → one requeue; anything else → hold.
Tool-free model steps are requeued once (no side effect). Old one-time answers, desktop grants, batches and
T5 consent never cross the restart (existing behavior).

## 8. Not contained / not claimed

Ollama is an independently managed HTTP service: a team step's Ollama request is owned by its Task's
AbortController, never by a Windows Job. F04 Job containment applies to Codex/Claude sessions, which team
steps do not use (tool-free only); M45–M47 are therefore proven on the contained fixture provider path.
