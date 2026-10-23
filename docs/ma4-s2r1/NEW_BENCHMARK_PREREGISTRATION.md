# MA4-S2R1 — New benchmark pre-registration

Written and committed **before** the relevance-gated retrieval was implemented or tuned, before any model saw these
tasks, and before any S2R1 result existed. It is not edited after results are observed; deviations go to
`INTELLIGENCE_EVALUATION.md` §Deviations.

The S2 held-out set (`bunny-ma4-s2-eval-v1`, 12 tasks × 2 trials) was inspected and diagnosed in S2; it is **not**
reused as decisive evidence. Its tasks may only serve as development regressions for retrieval (deterministic
eligibility fixtures, no model runs).

## 1. Task suites

`scripts/ma4-s2r1/eval-tasks.mjs`, version `bunny-ma4-s2r1-eval-v1`,
**task hash `76238698bc53c99b510606afcc5a91597955f06a91fa3f1cb9005e827ad72d8e`** (sha256 of `JSON.stringify(S2R1_TASKS)`).

Pre-flight (`scripts/ma4-s2r1/preflight.mjs`, `evidence/preflight.json`), run in the OS-enforced WSL2 sandbox with
no model: all 24 references pass their hidden tests, all 3 quoted buggy programs fail them, and no module or function
name is shared with G7, the S1R4 dev set, the S1R2 benchmarks or any S2 split.

| Split | Tasks | Use |
|---|---|---|
| dev | 8 (2 strict, 3 simple, 1 intermediate, 1 debugging, 1 planning) | tuning of signatures, eligibility, ranking and budgets; the only model runs before the candidate is frozen |
| heldout | 16 (5 strict, 3 simple, 4 intermediate, 2 debugging, 2 planning) | the one decisive A/B/C run; never a tuning source |

Strict tasks use the G7 v2 `all-pass` Tester rule; the others use `reference-validated`, as in S2. Hidden tests and
references never reach a model, a skill, a memory record or a prompt.

Held-out coverage: coding (all), debugging (`h-runmed`, `h-pairdiff`), mathematics (`h-gcdall`, `h-mad`,
`h-mostfreq`), date/time parsing (`h-daysbetween`, `h-weekday`, `h-dmy`, `h-hms`), structured-data transformation
(`h-teamtotal`, `h-transpose`), multi-agent planning handoffs (`h-gradebook`, `h-limiter`; every trial is a
Planner → Worker ∥ Tester → Reviewer handoff chain). Test generation is exercised in every trial by the Tester role;
the workflow has no standalone test-generation task kind, so none is claimed.

### 1.1 Frozen retrieval ground truth (`RELEVANCE` in the task file)

Evaluation metadata only: it never reaches the workflow, a prompt or the retrieval code.

| Relation | Held-out tasks | Expected retrieval |
|---|---|---|
| applicable | `h-daysbetween`, `h-weekday` (ISO date), `h-mad`, `h-runmed` (median), `h-uniqslug`, `h-slugfile` (slug) | the matching qualified skill family may be injected |
| near-miss | `h-hms` (time, not date), `h-dmy` (date, other format), `h-mostfreq` (statistic, not median), `h-snake` (identifier transform, not slug) | **no** skill (shares coarse S2 tags with a skill) |
| none | `h-transpose`, `h-teamtotal`, `h-gcdall`, `h-pairdiff`, `h-gradebook`, `h-limiter` | **no** skill |

Dev: applicable `d-adddays`, `d-medskip`, `d-slugpath`; near-miss `d-hhmm`, `d-mean`; none `d-chunksum`, `d-clamp`, `d-wordindex`.

## 2. Skill and memory corpus

* **Skills:** the four S2 `benchmark_qualified` skills (`parse-date-procedure` v1, `slugify` v1, `calculate-median`
  v1, `compute-median` v1) are copied read-only from the S2 evaluation database into a new S2R1 evaluation database.
  Their states are not changed: none is approved or active; they are usable only under this evaluation's
  authorization (`evaluation` mode), exactly as in S2. No new skill is discovered, extracted or promoted in S2R1.
  Rejected S2 skills are used only as negative fixtures. Applicability metadata may be attached to a skill only from
  Host evidence (the signature of a task the skill was validated on); a skill without it is ineligible.
* **Lotus experience memory (arm C only):** verified Host-written experience records from S2R1 **dev-split** trials
  only, in a project scope of the evaluation database. S2 experience records are not carried over. Memory is
  read-only during the held-out run: no held-out outcome is written anywhere a later held-out trial could read.

## 3. Arms (same models, tasks, workflow, schedule and budgets)

Pins for every arm and role (the S2 configuration): Planner, Worker and Reviewer `qwen2.5-coder:7b`; Tester
`huihui_ai/qwen2.5-abliterate:7b`. Local Ollama only; external inference disabled (no approval exists). Generated
code runs only in the WSL2 sandbox. Workflow strategy `STRATEGY_S2` with the grouped model schedule, ≤ 2 repair
rounds per trial, the S2 sampling settings and model-call budgets.

* **A — frozen S2 collaboration baseline:** S2 arm B exactly (Coordinator, typed handoffs, grouped schedule), no
  memory read or write, no skills.
* **B — relevance-gated skill retrieval:** A plus at most **one** skill per task, injected only if it passes the
  hard eligibility filter, the evidence gate and the relevance threshold; otherwise nothing is injected.
* **C — relevance-gated skills plus Lotus Memory:** B plus at most **one** verified, eligible, project-scoped
  experience line passing the same relevance gate.

Guidance budget (per role call): skill excerpt ≤ 400 characters, experience ≤ 1 line of ≤ 160 characters, total
≤ 600 characters, labelled as advisory data below the task contract. No guidance when nothing is eligible.

## 4. Run protocol

* 16 held-out tasks × 2 trials × 3 arms = **96 trials**, one run.
* Order: the 32 (task, trial) slots are shuffled with mulberry32(seed `2610230001`); within each slot the three arms
  run in an order drawn from the same generator. The resulting order is written into the evidence before trial 1.
* The models are unloaded after every trial; free-RAM floor 4 GiB as in S2.
* **Invalid-run policy:** every recorded trial result counts, including `model_error` and `cancelled` (as not
  passed). The only re-run is a trial that never reached a model (free-memory refusal, sandbox unavailable at start)
  or a ledger node left `running` by a crash (re-queued once by the run ledger, as in S2). No re-run is selected by
  outcome. If the machine cannot complete the run, the result is reported as incomplete, not extrapolated.
* The final candidate commit is frozen before the held-out run and recorded in the evidence. After that commit the
  deterministic retrieval decisions for all 16 held-out tasks are computed once and recorded; nothing in retrieval
  changes afterwards.

## 5. Acceptance criteria (frozen)

**Primary (R1-G10, intelligence improvement):** all of

1. C final passes ≥ A final passes **+ 4** (of 32 paired slots);
2. one-sided exact sign test over the discordant (task, trial) slots, C vs A: p = P(X ≥ wins | n = wins + losses,
   ½) **≤ 0.10**;
3. every invariant holds in every arm: pins held, the deterministic gate is the only acceptance authority, no
   handoff refused, no permission or scope violation, 0 external requests;
4. retrieval overhead within budget: injected guidance tokens (characters ÷ 4) are **≤ 5 %** of all prompt tokens
   of arm C.

If any part fails: **intelligence improvement UNPROVEN**, memory/skill injection stays disabled in the product,
whatever the direction of the difference.

**Secondary (reported, not gating R1-G10):** B vs A and C vs B (same test); first-attempt and final correctness per
arm; per relation (applicable / near-miss / none) and per kind; prompt and output tokens; model loads and switches;
call latency median/P95; trial time; Reviewer false approvals; Wilson 95 % intervals.

**Retrieval quality (functional, R1-G4/R1-G5):** in the held-out run, the number of trials in which a skill or
experience line was shown on a near-miss or none task, or a skill of a different family was shown (false positives,
required 0); recall on applicable tasks (reported).

**Dependence:** the two trials of a task share the task and prompts and differ only by sampling (temperatures
0.2–0.8), so the 32 slots are not 32 independent tasks. A task-level sensitivity analysis (a task counts as a win
for C if C passes more of its two trials than A) is reported alongside, not as the criterion.
