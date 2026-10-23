# MA4-S2R1 — Skill lifecycle, rollback and control

## 1. Lifecycle and approval controls (unchanged, re-verified)

The S2 registry is kept as is: `discovered → candidate → sandbox_validated → benchmark_qualified → approved → active
→ (quarantined | rolled_back)`, every step checked by `assertTransition`, approval/activation/removal only by the
trusted workstation actor, the Host limited to screening, evidence, quarantine, rejection and rollback, and any
permission beyond the workflow's tools named explicitly at approval. The S2 tests for these (`S2-G5`, `S2-G6`) pass
unchanged in `ma4-s2.test.ts`.

S2R1 adds one Host operation, `SkillRegistry.attest(id, applicability)`: it stores the applicability contract,
appends a history entry (`from` = `to` = the current state, actor `host`) and **never changes the state**. It refuses a
contract whose `contentSha256` does not match the stored skill.

Evaluation corpus state (S2R1 evaluation database, copied read-only from S2): 9 skills — 4 `benchmark_qualified`
(attested), 5 `rejected` (unattested); **0 approved, 0 active**. The owner's Host database was never opened.

## 2. Promotion requirements for a future candidate

| # | Requirement | Where enforced |
|---|---|---|
| 1 | Schema validation | `SkillProposalSchema` at `propose` |
| 2 | Permission validation | `screen` (tools outside the workflow's), `requiredPermissions` named at approval |
| 3 | Sandbox verification | `sandbox` evidence required for `sandbox_validated` |
| 4 | Applicability testing | S2R1: `attest` from the validated task's signature; no contract → never retrievable |
| 5 | Independent behavioural evaluation | `qualify` evidence required for `benchmark_qualified` |
| 6 | Negative-case evaluation | S2R1 gate: near-miss and none tasks must not select it (dev report, held-out run) |
| 7 | Resource and latency assessment | excerpt budget (320 characters; 400 before the dev run), score cost term, injected-token measurement |
| 8 | Provenance validation | content hash bound by `attest`, re-checked on every retrieval |
| 9 | Explicit approval | owner-only `approved` / `active` |

Approved skills stay versioned (`name` + `version`) and revocable (`quarantine`, `rollback`).

## 3. Rollback in an isolated execution scenario

`S2R1-D2 rollback in an isolated execution: a rolled-back skill leaves the next run and any cached selection`
(`ma4-s2r1.test.ts`) runs the real `runCodingWorkflow` (S2 strategy, grouped schedule, scripted models, fake
sandbox, in-memory Host database). It does **not** touch any real skill approval:

1. An attested skill is approved and activated **in the test's own in-memory registry**, with a Lotus pointer, and
   the memory policy enabled in that database.
2. `buildGuidance(mode: "product")` selects it; run 1 passes and every Worker prompt contains the procedure, while
   the Planner (a role the skill does not declare) never sees it.
3. `registry.rollback(name)` retires it (`rolled_back`).
4. Run 2 with a fresh `buildGuidance`, **and** run 3 with the guidance object built *before* the rollback (the cached
   retrieval state), both pass and contain the skill in **no** prompt.

Point 4 needed a code change: S2's guidance closure captured the selected skills once and would have kept injecting a
rolled-back skill for the rest of a task. S2R1 re-reads the record and re-runs `eligibility` on every role call.
The same mechanism drops a skill whose stored text was replaced after selection (`S2R1-H … malicious replacement`).

## 4. No uncontrolled self-modification

S2R1 contains no code path that rewrites a skill, grants a tool, promotes generated code, changes provider
permissions, trains weights, edits an evaluation contract or persists prompts. Held-out trials write nothing; dev
trials write only Host-built experience records (status, failure categories, repair outcomes, skill names, signature
tags) into the evaluation database.
