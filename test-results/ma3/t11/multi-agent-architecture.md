# M-A-3 T11 — Multi-Agent Team Missions: architecture (as built)

Baseline: T10 source `2d5646d`, evidence `bde8186`. The pre-implementation design record is preserved unchanged in
`multi-agent-architecture.design-draft.md`; this document describes what was actually built and where it differs.
Every mechanism below extends an existing owner. **No second scheduler, agent runtime, task manager, permission engine,
model router, provider registry, event journal, memory authority or artifact authority was introduced.**

## 0. Summary

A **Team Mission** is an ordinary M-A-0 Mission: one MissionManager step graph, one `tickOnce` loop, one MA0
`AuthorizationEnvelope` per approval, and at most one T5 Agentic consent. What is new is that each step is **owned by a
durable AgentRuntime identity**, the plan is **proposed by a real model call owned by a Planner Agent**, and every effect
and every completion is decided by the Host:

```
user objective + requirements ─► agent.create{team} (workstation only)
  AgentRuntime.createTeam ─► Coordinator identity + Planner identity (+ scratch workspaces)
  MissionManager.create(team) ─► one planner step (tool-free local model) ─► waiting_for_approval (planning scope)
user starts planning ─► planner step ─► TaskManager.submit ─► BunnyRouter ─► Ollama (format = per-kind plan grammar)
  planner output (UNTRUSTED) ─► checkTeamOutput/validateTeamPlan ──rejected──► reasons recorded, Planner retries
                                                              (bounded: maxPlanRevisions; then the user decides)
                                   └─valid─► installTeamPlan:
      teamDrafts (Host-built executors/params/checks) + reserved dormant rework chains
      AgentRuntime.allocateTeam(roles) ─► member identities (cap: 10 active Agents) ─► step.team.agentId
      plan() ─► scopeFor ─► waiting_for_approval (review phase, planReference = sha256 over every execution field)
user approves BY REFERENCE (agent.team.approve) [or approves the Coordinator's T5 consent bound to that reference]
  tickOnce: dormant never admitted; per-step owner gate (member paused/stopped); slots = min(Mission, team) ;
            model slots ≤ maxConcurrentModelSteps (GPU)
    model step  ─► verified handoffs (hash re-checked) ─► fenced data prompt ─► TaskManager.submit (tool-free, local)
    observe     ─► CapabilityBus filesystem.read / git.log (exact Host-planned operation; team hard-deny otherwise)
    write_file  ─► verified producer content ─► filesystem.write into the fresh output folder (pre-image guard + lock)
    verify_output ─► Host reads the file, re-checks its hash against the verified write, checks the user's requirements
  verifyAndComplete ─► completed | stepFailed ─► teamFailure: rework (activate reserved chain) | hold | retryVerdict
```

## 1. Ownership (existing authorities, T11 extensions)

| Concern | Owner | T11 extension |
|---|---|---|
| Graph, admission, scheduling, retries, completion | `MissionManager` | `Mission.team`, `MissionStep.team`, `installTeamPlan`, owner gate, team slot caps, handoffs, `team_output`/`team_file`/`team_requirements` criteria, reserved rework, member-only stop of owned steps, team recovery arms |
| Durable identity, runs, checkpoints, flags, restart walk | `AgentRuntime` | `createTeam`, `allocateTeam`, Coordinator/member split, owner-scoped state (`deriveMemberState`), member pause/resume/stop, Coordinator stop of all members, Coordinator-only reconciliation |
| Provider sessions, routing, receipts | `TaskManager` + BunnyRouter (T3) | team constraints (local, offline, Ollama allowlist, no workspace tools, context 8192, output-token ceiling, JSON grammar); Ollama `done` receipt captured as `provider.receipt` |
| Capability effects, decisions, owned processes | `CapabilityBus` + local capabilities (F04 Job containment) | `teamDeny` hard deny of anything but the exact planned operation; `agentId` on capability owners; `expectBeforeSha256` pre-image guard on `filesystem.write` |
| Artifacts | `ArtifactStore` (sha256) | canonical extracted content per model step; consumption recorded per handoff |
| Consent | T5 `AgenticStore` | one consent per team, Coordinator-only, only for the reviewed execution plan; admissions attributed to the member Agent that used them |
| Workspaces / project context | `AgentWorkspaceStore`, `ProjectContextResolver` | one scratch workspace per member (declared team members only); context resolution bound to the step owner |
| Journal | Host `events` | `mission.team.*` events, `mission_handoffs` table (additive) |

## 2. Identity model

* **Coordinator** — the user's Agent for the Mission: holds the Mission-wide controls (pause team, stop team, approve,
  ask for a revised plan) and the one T5 consent. Owns no task.
* **Planner** — owns the planning step(s). Created with the Coordinator.
* **Members** — `researcher`, `implementer`, `documenter`, `reviewer`, `tester`; created by `allocateTeam` only after
  Bunny validated a plan, one per role, reused across plan revisions, never resurrected after a stop, all-or-nothing
  against the 10-active-Agent bound. A role carries **no provider, model or authority** (§4 role contract).
* Every step records `team.agentId`; capability processes record `agentId`; consent admissions record the member
  `agent_id`; handoffs record source and destination Agents.

## 3. Planning (real model, untrusted output)

* The planner prompt contains the objective as data, the user's requirements with fixed ids, the role/kind catalog, the
  Host offer (observable files, Git availability, output folder, limits) and an example shaped by **this** offer
  (`exampleFor`). Ollama's `format` constrains the reply to a per-kind JSON schema (`outputGrammar`); this is a
  convenience for a 7B model, **not** a trust boundary.
* `validateTeamPlan` rejects unknown fields (provider/model/permission/command smuggling), unknown roles/kinds,
  role/kind mismatches, self/cyclic/missing dependencies, non-offered observe paths, unsafe/duplicate/reserved targets,
  content from the wrong generator kind, review/verify subjects that are not writes, requirements not covered by a
  `verify_output` on the right file type, dataset checks without a verified dataset, and budget overruns (tasks, member
  Agents, total steps including reserved rework).
* Rejections are recorded (`mission.team.plan_rejected`, `team.rejected`) and fed back to the Planner as repair text.
  After `maxPlanRevisions` rejected proposals the Mission waits for the user ("Ask for a revised plan" or stop).

## 4. Execution, handoffs and verification

* Executors, parameters, capabilities, access and checks are **built by the Host** (`teamDrafts`); the plan contributes
  ids, roles, kinds, dependencies, objectives, file names and requirement ids only.
* Model steps are **tool-free**: read-access provider sessions, local Ollama models only, no filesystem/terminal/Git
  requirement; any other route is a hard failure (`TEAM_TOOL_FREE`). Hosted `:cloud` tags are refused.
* A handoff delivers only a **completed, Host-verified** artifact whose stored body still hashes to its recorded
  sha256; a write delivers its verified producer's bytes. Refusals are recorded and hold the step (`HANDOFF_REFUSED`).
* Writes land only in a fresh output folder created for the Mission (an existing non-empty folder is refused at create),
  under an exclusive lock, with a pre-image guard: the target must be absent or equal this Mission's last verified
  write; anything else is `FILE_CONFLICT` and holds for the user (never overwritten).
* `team_file` re-reads the written file and compares its sha256 with the verified source; `team_requirements` re-reads
  the delivered file, refuses a file that changed since its verified write (`STALE_VERIFICATION`) and checks each user
  requirement deterministically. **A model's completion claim never completes anything.**
* The Reviewer's findings are advisory data: shown with Bunny's own verdict per requirement, handed to a rework
  generator as data, never used to complete, fail or authorize.

## 5. Rework (bounded, pre-approved)

For every `verify_output` chain (generator → write → verify) the reviewed plan already contains `maxReworkRounds`
dormant replica chains. Only a Host-observed verification failure activates the next replica (`activateRework`):
the failed steps are marked superseded (failure evidence preserved), the replica generator receives the Host failure
lines (and advisory Reviewer findings) as data, dependents are re-pointed. No step outside the approved plan is ever
added; unused replicas end `skipped`. When the rounds are spent the Mission waits for the user.

## 6. Control, budgets and authority

* Member pause holds only that member's new admissions; member stop stops only its open work and holds the Mission for
  the user if that work was needed; Coordinator pause/stop are Mission-wide (stop durably flags every member first).
* Budgets: ≤5 member Agents, ≤12 tasks, ≤3 concurrent team steps, ≤2 concurrent model steps, ≤2 plan revisions,
  ≤1 (ceiling 2) rework rounds, ≤20 Mission steps, bounded per-step retries, generated-token ceilings per kind; limits
  can be lowered by the user, never raised.
* Authorization: the plan cannot grant itself anything; approval is bound to the exact plan reference; a team replan is
  refused once consent exists or execution work completed; a consent reduction is never revived by a one-time answer.
  Paired devices cannot create/approve/revise teams (default-deny device rights).

## 7. Recovery

AgentRuntime's walk runs once: members only close/open their run generation; the Coordinator reconciles every
interrupted team step through `reconcileInterrupted` team arms — a write is judged by disk truth (already written and
verified → verify; still matches pre-image → re-issue; otherwise hold), other team steps are re-queued once, steps of a
stopped owner are never re-queued. After a restart, team model work is not admitted until the local provider has been
probed (no attempt is spent on an unobserved provider state).

## 8. Presentation

Agentic team view (members, own task, routed model per task, plan graph, reserved rework, handoffs, Bunny's verdict per
requirement, advisory findings, plan approval by reference, per-member controls), role-lettered Bunny Bar/Notch chips,
and voice team questions answered from canonical facts with Host labels only. Dashboard/device snapshots drop project
file listings, repair evidence and handed-off content; devices also lose Reviewer model text.

## 9. Differences from the design draft

* Rework uses **pre-materialized dormant replica chains inside the reviewed plan** (the draft appended steps).
* DOM inspection of the delivered page is harness-side in an isolated offline browser, labelled supplementary; the
  Host's own verification is static (`team_requirements`).
* Per-kind grammar, offer-shaped example, explicit requirement checks in prompts, dataset-requirement validation,
  output-token ceilings and the post-restart provider-probe wait were added after live findings (see the main report).
