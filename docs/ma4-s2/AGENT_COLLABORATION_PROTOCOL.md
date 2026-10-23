# MA4-S2 — Agent collaboration protocol

Code: `src/lib/bunny-host/ma4/collaboration.ts`, `coordinator.ts`; used by `coding-workflow.server.ts` when a
Coordinator channel is supplied (arms B and C). Tests: `ma4-s2.test.ts` (S2-G2, S2-G6, prompt injection).

## Topology

Hub and spoke. Agents never address each other: every transfer is a message **to or from the Coordinator**, and the
Coordinator is the orchestrator (Host code), not a model. The admitted edges of a team are exactly
`Coordinator → member` and `member → Coordinator`; `Worker → Tester` is refused.

## Message (`bunny-a.ma4-s2.handoff.v1`, strict schema)

| Field | Meaning |
|---|---|
| `id`, `taskId`, `subtaskId` | identifiers (`plan`, `implement`, `test`, `repair`, `review`) |
| `from`, `to` | Coordinator, Planner, Worker, Researcher, Tester, Reviewer |
| `capabilities` | what the receiver must provide; a Coordinator message is refused if the receiver's role lacks one |
| `requirementsSha256` | sha256 of the Host's own task facts (spec, module, allowed imports, Tester rule), computed by the sender from the task it actually runs; must equal the hash frozen when the team was formed |
| `schemas.input` / `schemas.output` | schema versions of the payload and the expected reply |
| `artifacts[]` | kind, sha256, bytes — only hashes the Host itself registered are admitted |
| `deadlineAt` | refused once passed |
| `budget` | model calls, tool calls, tokens this message authorizes; refused above the team's remaining budget, which it then reduces |
| `trust` | `host` (orchestrator), `model` (unverified output), `untrusted` (outside or steering text) |
| `validation` | `unvalidated`, `schema-valid`, `verified`, `rejected` |
| `content` | data only, ≤ 20,000 chars |

There is **no field** for a model pin, a permission, a provider authorization or an acceptance criterion. The schema
is strict, so a message that carries one is rejected as an unknown key: a Worker cannot alter another agent's pin,
permissions, provider approval or the acceptance rule by sending a message. Pins come from the Coordinator's
assignment and are frozen before the workflow starts; acceptance is decided only by the deterministic gate.

## Admission rules (each refusal names its reason)

1. Strict schema and version. 2. Sender ≠ receiver; both are team members; the edge is hub-and-spoke.
3. `requirementsSha256` equals the frozen hash (a changed or tampered task is refused before any model call).
4. Coordinator messages: receiver has every required capability. 5. Only the Coordinator may send `trust: host` or
`validation: verified`; an agent cannot vouch for itself. 6. Every artifact hash was registered by the Host with the
same size. 7. Deadline not passed. 8. Budget within the remaining team budget. 9. Content with steering text is
admitted but downgraded to `untrusted`; when shown to a model it is fenced as data (`<<<DATA … >>>`, the fence cannot
be closed from inside).

A refused handoff ends the run with status `handoff_refused` (category `handoff_refused`, component `router`).

## Messages in one coding run

`Coordinator→Planner (plan, contract=spec)` · `Planner→Coordinator (plan artifact)` · `Coordinator→Worker (contract,
samples)` · `Coordinator→Tester (contract)` · `Worker→Coordinator` per sample · `Tester→Coordinator` · per repair
round `Coordinator→target (Host feedback)` and `target→Coordinator` · `Coordinator→Reviewer` · `Reviewer→Coordinator`.
The prompts are the S1R4 prompts: the protocol governs transfers at the Host level and changes no prompt (verified
by test: arm B sends exactly the same set of prompts as arm A).

## Delegation and scheduling

`composeTeam(needs)` builds the smallest team covering the needed capabilities; retrieval is the Researcher's job and
is executed by the Host over Lotus (no model, no extra inference). `assignTeam` calls the S1R4 `assignRole` per role
(pin → eligibility → measured role evidence → local-first order; abstain rather than guess; a missing role refuses the
team). `planSchedule` runs Worker and Tester in parallel only if both models fit in VRAM together; otherwise calls are
grouped by model. `gateCalls` bounds in-flight calls, applies a per-call timeout, propagates cancellation, and records
peak concurrency and model switches.
