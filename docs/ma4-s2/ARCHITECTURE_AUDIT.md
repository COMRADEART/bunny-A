# MA4-S2 — Starting-state and architecture audit

Audit date 2026-10-23, before any S2 code was written.

## Repository state

| Item | State |
|---|---|
| Integrated baseline (S2 base) | `origin/ma4-s1r3-agent-reliability` at **`e5006c5`** = merge of PR #14 (S1R4). Contains the S1R4 reference commit `b62f2dc`. Does **not** contain the G7C Groq harness (`3edb289`). |
| Hosted CI on the base | run 39866800595 (`e5006c5`) **success** |
| PR #14 (S1R4) | MERGED into `ma4-s1r3-agent-reliability` |
| PR #15 (G7C-1, 1/3) | OPEN, not merged; head `fa38a9d` |
| PR #16 (G7C-2, 3/3 cloud-assisted) | OPEN draft, stacked on #15; head `fcd1cbd` |
| S2 branch / worktree | `ma4-s2-adaptive-agent-intelligence` at `../bun-router-s2`, own `node_modules` (`npm ci`, lockfile identical to S1R4) |
| Local baseline on the base | `test:ma4` 77 pass / 1 skip; `typecheck` pass |
| Unrelated local changes | the main checkout (`bun-router`, branch `ma4-s1-model-intelligence`) has many modified evidence files and untracked items; untouched. The S2 worktree's rebuilt `native/voice` worker files (pretest output) are not committed. |

S2 deliberately does **not** depend on PR #15/#16: the experimental Groq adapter is not imported, and cloud inference
stays disabled (no current approval; the G7C-2 approval was revoked and its credential deleted).

## What already exists (reused, not rebuilt)

| Area | Existing implementation | S2 use |
|---|---|---|
| Coding workflow | `ma4/coding-workflow.server.ts` (S1R3/S1R4): Planner → frozen contract → Worker ∥ Tester → static checks → sandboxed tests → deterministic attribution → targeted repair (≤ 2) → Reviewer (advisory) → deterministic gate | unchanged default path; S2 adds three opt-in hooks |
| Task intelligence | `ma4/task-intelligence.ts`: deterministic profile, bounded typed graph, `validateGraph` (cycles, size, ≤ 4 agents) | reused by the Coordinator and by run control |
| Routing | `ma4/hybrid.ts` `assignRole` (pins never substituted, eligibility hard, Wilson lower bound soft, abstention), approvals, reliability evidence | reused for team assignment and performance learning |
| Permission broker | `bunny-missions/authorization.server.ts` `decide`, `isTrustedLocalActor` | deterministic tools stay behind it; owner-only skill and run steps use the trusted actor |
| Sandbox | `ma4/sandbox.server.ts` WSL2 userns + pivot_root + cgroup v2 + seccomp, no network | all generated code, references and pre-flight run only here |
| MA3 teams | `bunny-missions/team.ts` role catalog (coordinator, planner, researcher, implementer, documenter, reviewer, tester), Host-validated plans, handoff refusal | S2 roles map onto this catalog (§ below) |
| Personal Agents | `personal-agents.ts`: Gada, Spear, Vishnu Chakra, Sword are **presentation** of user-facing Agents; internal team members are never bound to weapons | unchanged; no UI change |
| Lotus Memory | `lotus.ts` + `lotus.server.ts` (T13.3 Gate C): bud/outer/inner/central layers, trust ceilings (model ≤ outer, untrusted ≤ bud), steering detection, credential refusal, provenance, revisions, scoped retrieval (`rank`), compaction, retention | **implemented**; S2 integrates through an adapter, no second memory system |
| Routing learning | `learning.server.ts` + `routing-feedback.ts`: proposed → shadow → accepted policy lifecycle | pattern followed for skill promotion (evidence-gated, owner-gated) |

### Lotus Memory interfaces — what was missing for S2

Lotus rows carry scope, layer, key, value, trust, provenance, sources and revisions, but not: record type, content
hash, validation status, confidence, task categories, expiry and sensitivity. S2 adds them in one additive metadata
table keyed by the Lotus memory id (`ma4_memory_meta`), owned by the adapter, behind a policy flag that is off by
default. Nothing else in Lotus changed.

## Role mapping

| S2 role | MA3 team role | Executed by | Model? |
|---|---|---|---|
| Coordinator | coordinator | Host orchestrator | no |
| Planner | planner | pinned model | yes |
| Worker | implementer | pinned model | yes |
| Researcher | researcher | Host retrieval over Lotus (the stem) | no |
| Tester | tester | pinned model (writes tests); Host runs them | yes |
| Reviewer | reviewer | pinned model (advisory only) | yes |

Active model roles stay ≤ 4 (unchanged bound). Weapons remain presentation of user-facing Agents; no internal role
is drawn as a weapon.

## Gaps S2 closes

1. No typed agent-to-agent message contract inside the coding workflow → `ma4/collaboration.ts` + Coordinator channel.
2. No team composition from capabilities and no memory-aware schedule (S1R4 ran two 7B models concurrently on a
   6 GiB GPU) → `ma4/coordinator.ts`.
3. Lotus Memory not connected to agent execution → `ma4/experience.server.ts` (adapter) + `skill-learning.server.ts`.
4. No procedural learning → `ma4/skills.ts` + `skills.server.ts` (declarative skills, evidence-gated lifecycle).
5. Repair could not use prior verified lessons → guidance hook on repair prompts, matched to attributed categories.
6. No per-role, per-kind performance aggregate with uncertainty → `ma4/role-performance.ts`.
7. No resumable bounded run ledger for multi-step S2 work → `ma4/team-run.server.ts`.
