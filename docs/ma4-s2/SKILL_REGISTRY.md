# MA4-S2 — Verified skill registry

Code: `src/lib/bunny-host/ma4/skills.ts` (rules), `skills.server.ts` (`SkillRegistry`, table `ma4_skills`),
`skill-learning.server.ts` (extraction, guidance). Tests: `ma4-s2.test.ts` (S2-G5, S2-G6).

A skill is a **declarative procedure**: advisory steps for one or more roles, plus references to deterministic tools
the workflow already runs. It is never executable, never changes model weights, and never grants a tool, permission,
provider or data access.

## Skill record

| Field | Source |
|---|---|
| name (slug), description, categories (fixed tag vocabulary), preconditions, procedure (≤ 6 steps), roles (Planner/Worker/Tester), tools, limitations | proposed by the extraction model, schema-validated (`SkillProposalSchema`) |
| id, version (per name), state, schema | Host |
| inputs ("the frozen task contract"), outputs ("advisory guidance text") | Host |
| failureCategories | Host: the attributed categories the source trial overcame |
| requiredPermissions | Host: every proposed tool outside `ma4.static_check`, `ma4.import_smoke`, `ma4.run_tests` |
| budget (`maxGuidanceChars` 400) | Host |
| evidence[] (screen, sandbox, qualify, monitor) | Host |
| uses[] / failure history | Host monitoring |
| provenance (source task, trial, model, extractor prompt sha256, time) | Host |
| history[] (every transition, actor, reason) | Host |

## Lifecycle

```
discovered → candidate → sandbox_validated → benchmark_qualified → approved → active → quarantined / rolled_back
        ↘ rejected (from any pre-approval stage)                                    removed (owner, from any state)
```

| Step | Who | Requires |
|---|---|---|
| discovered | Host | schema-valid proposal from a deterministic-gate PASS |
| → candidate | Host | screening passes (below) |
| → sandbox_validated | Host | passing sandbox evidence |
| → benchmark_qualified | Host | passing qualification evidence |
| → approved | **workstation owner only** | every `requiredPermission` explicitly approved |
| → active | **workstation owner only** | — |
| → quarantined | Host | four consecutive failed uses, or any security violation during use |
| quarantined → active | **workstation owner only** | — |
| → rolled_back | Host | `rollback(name)`: retires the active version and restores the newest earlier version the owner had activated |
| → removed | **workstation owner only** | — |

Stages cannot be skipped; evidence of the required stage must exist and have passed; remote or Host actors cannot
approve, activate, reinstate or remove.

## Use

`usable(skill, mode)`: product → ACTIVE only; evaluation → benchmark_qualified, approved or active (under that
evaluation's authorization); validation → candidate or sandbox_validated, used only by the harness to gate the skill's
own stage. Quarantined, rejected, rolled-back and removed skills are never used. `selectSkills` filters by role and
Host-derived task tags; for a repair it additionally requires a matching failure category (or two shared tags).
`renderGuidance` produces the bounded, labelled advisory block.

## Screening (→ candidate or rejected)

Rejected if the text contains instruction-steering, credential-like text, a named model or provider, an instruction
to skip/weaken/delete/edit tests, assertions or checks, a 6-token run shared with **any** hidden test or reference of
the S2, G7 or S1R4-dev suites, or a tool outside the workflow's own deterministic tools (that would be a new
permission; evaluation never admits it).
