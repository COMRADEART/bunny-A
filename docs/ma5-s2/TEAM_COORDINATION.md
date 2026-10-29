# MA5-S2 Phase 1B: Native Agent Team coordination (S2-G5)

## Defect found and fixed

A team Mission waiting on plan review was offered in the Windows Approval Center as an ordinary plan and approved
with `mission.approve`. The Host refuses that for teams ("approved, started and replanned through its Coordinator
Agent"), so **a team plan could not be approved from Windows**. Verified against the real Host
(`evidence/team-contract.json`) before the fix.

## What Windows now does

| Capability | Host command | Notes |
|---|---|---|
| Create a team (Projects → New Agent Team) | `agent.create {objective, projectId?, team{requirements, outputDir?}}` | Requirement grammar as on the web workstation: `check [value] \| description`; parsed locally, validated again by the Host. Creating starts nothing. |
| Start team planning (Agent Dashboard) | `agent.start` on the Coordinator | Confirmation; only the Planner runs, up to plan review. |
| Approve the exact plan (Approval Center, `team_plan`) | `agent.team.approve {id: coordinator, planReference}` | Shown only in the Host's `review` phase; bound to `teamView.planReference`. |
| Deny | `agent.stop` on the Coordinator | Stops every member. |
| Pause / Resume / Cancel | `agent.pause/resume/stop` on the Coordinator | Previously these buttons acted on ptasks only. |
| Team detail | read-only: `teamView` + Agent runtime rows | Coordinator, phase, output folder, every member with role, step, provider/model, verified/failed counts and failure; handoffs; requirement verdicts from Bunny's Tester checks. |

The Coordinator is always `teamView.coordinatorAgentId` from the Host, never inferred from an agent list.

**Activity honesty.** The Host gives the Planner a started run in state `PLANNING` as soon as a team is created, while its
only step is still `pending`. Agent state alone therefore cannot say whether an agent is working. Windows shows a
member as **working** only while the Host reports its current step `running` or `verifying`, and **idle** otherwise,
with the raw Host state alongside. A Coordinator without a Host start time is shown as "not started".

## Evidence

| Check | Kind | Result |
|---|---|---|
| `scripts/ma5-s2/team-contract.mjs` → `evidence/team-contract.json` | Host-integrated, real local model (qwen2.5 7B) | create → start → plan review in 18.6 s; `mission.approve` refused for the team; wrong `planReference` refused; `agent.team.approve` → completed with Planner, Researcher, Implementer, Reviewer, Tester, all steps Host-verified |
| `scripts/ma5-s2/verify-team-windows.mjs` → `evidence/windows-team.json` | **Real UI-tested** (compiled WPF, UI Automation, disposable Host, real local model) | 5/5: t1 malformed requirement rejected locally, nothing sent; team created, nothing started. t2 shown with Coordinator "not started", Planner "idle". t3 Start → review, plan visible step by step. t4 Approval Center shows `agent.team.approve` with the Host's exact reference; approved; team completed; R1 and R2 passed Bunny's checks. t5 Deny stopped the Coordinator and all five members |

## Not covered

- Pause/Resume of a running team through the UI: the run took 8–11 s, too short to drive reliably. These are the
  existing Host commands, covered by the Host agent-team tests, but **not UI-tested** here.
- Revise plan (`agent.team.revise`) and Agentic consent (`agent.authorization.*`) are not exposed in Windows yet.
- Model assignment per role is Host routing policy (each member shows the provider/model it was routed to); Windows
  does not override it.
- Completed teams move to Task History, which does not yet show the team detail (Phase 1C).
