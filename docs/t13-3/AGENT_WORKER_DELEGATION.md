# Agent worker delegation (T13.3 Gate D)

A worker is temporary, bounded help that a Personal Agent adds inside one of its own Missions. It is not a fifth identity,
not a team role and not a new executor: every admitted worker is one ordinary child Mission that MissionManager plans,
holds for the user's approval, runs, verifies and records. The worker record only decides whether that Mission may exist
and what its outcome means.

Source: `src/lib/bunny-host/workers.ts` (pure rules: lifecycle, catalogue, eligibility, verdict),
`workers.server.ts` (`WorkerStore`; additive tables `agent_workers`, `agent_worker_abilities`), Host wiring in
`http.server.ts`, Studio panel `src/components/island/workers.tsx`.

## Lifecycle

```
PROPOSED → ELIGIBILITY_CHECK → ADMITTED → RUNNING → RESULT_REPORTED → VERIFIED | REJECTED | INDETERMINATE → CLOSED
                             ↘ REJECTED → CLOSED            (refused before anything ran; no Mission is created)
           ADMITTED → RESULT_REPORTED                       (child Mission stopped or failed before it started)
```

Any other move throws. Each move is appended to the worker's `history` (bounded to 20) with a time and a plain note.
Moves after ADMITTED are driven only by the child Mission's own state, observed on the Task bus.

| Child Mission | Worker |
|---|---|
| running, verifying, waiting_for_user | RUNNING |
| completed, every step completed with Host verification `true` | RESULT_REPORTED → VERIFIED → CLOSED |
| failed, or any step's Host verification `false` | RESULT_REPORTED → REJECTED → CLOSED |
| stopped, unfinished steps, or a step finished with no Host verification | RESULT_REPORTED → INDETERMINATE → CLOSED |

## What every worker carries (directive Part E)

| Requirement | Field / mechanism |
|---|---|
| Parent Mission | `parentMissionId`; the parent must be live (draft … verifying) |
| Owning Personal Agent | `slot`, `provenance: "agent:<slot>"`; the parent must be in that slot's ownership ledger |
| Explicit Project scope | `projectId` must equal the parent Mission's Project; the child Mission is created in that Project |
| Bounded budget | `timeoutMs` 30 s – 30 min (default 10 min) per step, `maxRetries` 0–1 |
| Bounded context | at most 4 Lotus memories from the Project slice only (never the Agent's private `agent:<slot>` scope) |
| Tool allowlist | derived from the ability's skill requirements; requesting anything beyond it is refused |
| Provider/harness identity | `harness` (e.g. `skill:project.test`, or `model:routed`); `providers` filled from the child's recorded attempts at close |
| Cancellation propagation | `worker.cancel` stops the child Mission; a parent that completes, fails or stops stops all its open workers |
| Time and concurrency limits | 3 open per parent Mission, 12 admitted per parent Mission, 6 open per Personal Agent |
| Output provenance | `childMissionId`, history, result summary and reason; the child Mission keeps its own evidence and artifacts |

## Authority rules

- **No self-escalation.** Tools are fixed at admission from the ability. A worker has no command surface; only the
  workstation can propose, cancel or approve abilities. Paired devices get `WORKSTATION_REQUIRED` for every `worker.*`
  command and never see the worker projection.
- **No recursion.** A worker's child Mission cannot be the parent of another worker.
- **Ownership.** A Personal Agent can add workers only to a Mission it owns. No ability, harness or tool family is tied to a
  weapon; every slot sees the same catalogue.
- **Approval stays.** The child Mission waits in `waiting_for_approval` like any other Mission; Gate D adds no auto-start.
- **Text never verifies.** The verdict reads only MissionManager's per-step `verified` flag, which is set by the Host's
  own criteria (here: the skill's command re-run with an expected exit code). A step that reports success in its summary
  but has no Host verification closes as INDETERMINATE.
- **Every proposal is recorded.** A refused proposal is saved as `PROPOSED → ELIGIBILITY_CHECK → REJECTED → CLOSED` with
  the reasons and returns 400 with the same text; no Mission is created.
- **Ownership follows the Agent (Gate J).** When an Agent's owner changes (`personal_agent.assign` or a Studio
  rebinding), its open workers move to the new slot; closed workers keep the slot they ran under as history. A move that
  would push a slot over its open-worker cap is refused and changes nothing; the check uses the net effect of the save.
- **Pause holds workers (Gate J).** While a Personal Agent is paused, its workers' child Missions admit no new step,
  exactly like the Agent's own Missions.
- **Memory is labelled in the prompt.** A model worker's Project memory reaches only its model prompt, under its own
  "Context from the Project's memory" heading, never under "Verified facts" and never on a Mission field.
- **Restart.** Workers persist. On boot an open worker without a child Mission closes as REJECTED; others are re-synced
  from their child Mission. An ADMITTED worker stays ADMITTED; nothing is marked complete by a restart.

## Ability catalogue

Built-in (`source: "builtin"`):

| Id | Name | Runs | Can be VERIFIED |
|---|---|---|---|
| `test` | Run tests | skill `project.test`, verified by `npm test` exit 0 | Yes |
| `build` | Build verification | skill `project.build`, verified by `npm run build` exit 0 | Yes |
| `typecheck` | Typecheck | skill `project.typecheck`, verified by `npm run typecheck` exit 0 | Yes |
| `lint` | Lint | skill `project.lint`, verified by `npm run lint` exit 0 | Yes |
| `repository` | Repository analysis | skill `git.snapshot` | No (evidence only) |
| `web` | Web page capture | skill `web.capture_page` with a `url` parameter | No (evidence only) |
| `research`, `documentation`, `review` | Research notes, Documentation draft, Review | one tool-free model step through the existing Mission model executor and routing | No (a model's words are not verification) |

Described abilities (`source: "user"`): the user names an ability, describes it and chooses 1–5 built-in, Host-verified,
parameter-free skill abilities to run in order (`worker.ability.compose`). It is saved as `pending_review` and cannot be
used until approved on the workstation (`worker.ability.approve`); it can be removed (`worker.ability.remove`). No code is
generated, nothing is downloaded and no new executable is introduced: a described ability is only an ordered list of
skills that already pass MissionManager's own skill gate.

## Host commands (workstation only)

| Action | Data | Result |
|---|---|---|
| `worker.propose` | `slot, parentMissionId, ability, objective, projectId?, tools?, timeoutMs?, maxRetries?, params?` | `{data:{worker}, mission}` or 400 with reasons |
| `worker.cancel` | `id` | stops the child Mission; the worker closes INDETERMINATE |
| `worker.ability.compose` | `name, description, components[]` | pending ability |
| `worker.ability.approve` / `worker.ability.remove` | `id` | user abilities only |

Events: `worker.admitted`, `worker.refused`, `worker.closed`, `worker.ability_proposed`, `worker.ability_approved`,
`worker.ability_removed`.

## Studio

Agents → Talk to your Agents → (choose an Agent) → "<Name>'s workers": the Agent's workers with plain outcome labels
(Waiting for your approval, Running, Verified by the Host, Rejected, Not verified), Stop for open workers, an "Add worker"
form limited to that Agent's live Missions, and the Abilities list with Describe / Approve / Remove.

## Test coverage

- `workers.test.ts` (pure): lifecycle table, eligibility problems, the verdict ignoring text claims, budgets and composition.
- `workers-host.test.ts` (real Host over HTTP, real child Missions running `npm test` / `typecheck` / `lint` fixtures):
  VERIFIED and REJECTED outcomes, Project-only context, events; refusals for another Agent's Mission, Project mismatch,
  extra tools, unknown ability, missing parent, recursion and the open-worker limit, each recorded as REJECTED;
  `worker.cancel` and parent-stop propagation; an ADMITTED worker across a Host restart; a described ability refused while
  pending, then approved and VERIFIED across two skills; device refusal and projection stripping.

## Not implemented or not exercised (explicit)

- Model-backed abilities (`research`, `documentation`, `review`) are wired through the existing Mission model executor but
  were not run against a live provider here; the test fixture provider refuses to launch. They can never reach VERIFIED.
- Directive skills without a worker ability yet: coding (write access), test generation, UI inspection, debugging, data
  processing. Adding one means adding a Host skill with verification first.
- GitHub-sourced or generated executable skills: no import or generation path exists, so nothing downloaded can run.
- Part F planning additions (task graph with alternatives and budgets, Laya/Jev advice, replan triggers, recorded plan
  revisions, scope-expansion review) are not part of Gate D. MissionManager's existing planning and replanning apply.
- Workers do not yet share a session or quota ledger; that is Gate F.
