# MA4-S2 — Intelligence evaluation

## 1. Pre-registration (committed before any S2 implementation existed or ran)

Everything in this section was written and committed before any S2 code was written, before any model output on
these tasks was seen, and before any skill existed. It is not edited after results are observed; deviations are
recorded in §3 instead.

### 1.1 Task suites

`scripts/ma4-s2/eval-tasks.mjs`, version `bunny-ma4-s2-eval-v1`, **task hash
`2b9d01a75e17464028543cd757c88df0542b442675bd5332c05fb44818165784`** (sha256 of the JSON task list).
Pre-flight (`scripts/ma4-s2/preflight.mjs`, `evidence/preflight.json`), run in the OS-enforced sandbox with no model:
all 24 references pass their hidden tests, all 6 quoted buggy programs fail them, and no module or function name
is shared with G7, the S1R4 dev set or the S1R2 benchmark sets (one clash, `flatten`, was renamed `flatten_dict`
before any model saw the suite).

| Split | Tasks | Use |
|---|---|---|
| train | 8 (2 strict, 1 simple, 2 intermediate, 2 debugging, 1 planning) | the **only** source skills may be discovered from |
| qualify | 4 (1 strict, 1 simple, 1 intermediate, 1 debugging) | the **only** tasks a candidate skill is benchmark-qualified on |
| heldout | 12 (4 strict, 3 intermediate, 3 debugging, 2 planning) | the decisive A/B/C comparison; never a discovery or qualification source |

Strict tasks use the G7 v2 `all-pass` Tester rule; the others use `reference-validated`, as in G7 and the S1R4 dev set.
Hidden tests and references never reach a model, a skill, a memory record or a prompt.

### 1.2 Arms (same models, same tasks, same budgets)

Pins for every arm, every role (the S1R4 decisive configuration): Planner, Worker and Reviewer
`qwen2.5-coder:7b`; Tester `huihui_ai/qwen2.5-abliterate:7b`. Local Ollama only. Cloud inference is disabled (no
approval exists; the revoked G7C-2 Groq approval is not reused). Generated code runs only in the WSL2 sandbox.

* **A — S1R4 baseline:** `runCodingWorkflow` with the frozen strategy `s1r4-v3c`, exactly as in S1R4.
* **B — S2 collaboration, no persistent learning:** the S2 Coordinator composes and assigns the team, every role
  handoff is a validated typed protocol message, model calls are scheduled model-grouped (no concurrent loads of two
  models on the 6 GiB GPU), the S2 repair budget applies. No memory read or write, no skills. Prompts are the A prompts.
* **C — S2 with qualified skills and Lotus Memory:** B, plus retrieval of benchmark-qualified skills and verified
  experience records through the Lotus stem, injected as a bounded, labelled advisory block (the contract always wins),
  and experience-guided repair (skills matched to the attributed failure categories). Memory is **read-only** during
  the held-out run: nothing learned from a held-out trial can reach a later held-out trial.

S2 repair budget for new workloads (fixed now): ≤ 2 repair rounds per trial (the same number as the frozen G7
budget, deliberately, so a difference cannot come from more repairs), identical-proposal stop, model-call budget
from the existing task profile. Advisory guidance ≤ 3 skills and ≤ 1,200 characters; experience lines ≤ 3.

### 1.3 Skill discovery and promotion protocol

1. **Discovery:** arm B on the train split, 2 trials per task (16 trials). For each trial the deterministic gate
   passed, the local Reviewer pin is asked once for a declarative procedure (schema-validated JSON: name, description,
   categories from a fixed vocabulary, preconditions, ≤ 6 procedure steps, target roles). Its input is the public task
   specification, the attributed failure categories with the Tester's own evidence lines, and the final passing source
   — never hidden tests, references or hidden-test details.
2. **Screening → CANDIDATE:** schema; no steering/injection text; no credential-like text; no 6-token overlap with
   any hidden test or reference of any S2, G7 or S1R4-dev task; requested permissions ⊆ the workflow's existing
   deterministic tools (anything else needs owner approval and is rejected for evaluation); at most 6 candidates go
   forward (trials that needed a repair first, then task order), duplicates by name merged.
3. **Sandbox validation → SANDBOX_VALIDATED:** the skill's source task re-run once in arm C with only that skill;
   the deterministic gate must pass.
4. **Benchmark qualification → BENCHMARK_QUALIFIED:** the qualify split, 2 trials per task, arm C with all
   sandbox-validated skills vs arm B. A skill qualifies only if it was retrieved in ≥ 1 qualify trial, the C passes on
   the trials where it was retrieved are ≥ the B passes on the same task/trial slots, and no permission or security
   violation occurred. A skill that was never retrieved stays SANDBOX_VALIDATED (generalization unproven).
5. **APPROVED / ACTIVE** require the workstation owner. The harness never approves. Arm C uses BENCHMARK_QUALIFIED
   skills under this evaluation's authorization only; no skill becomes ACTIVE in the product by this run.

### 1.4 Decisive held-out run and criteria

Held-out split, 2 trials per task per arm (72 trials), arms interleaved per task and trial (A, B, C, A, B, C …),
the model unloaded after every trial, one run, no resume except trials refused by the free-memory guard (no model ran).

* **Primary quality criterion (S2 intelligence improvement):** C final passes ≥ A final passes **+ 3** (of 24),
  **and** a one-sided exact sign test over the discordant (task, trial) slots, C vs A, gives p ≤ 0.10, **and** every
  invariant holds (pins, ordering, gate authority, no permission or leakage violation).
* **Secondary (memory/skill contribution):** the same test, C vs B.
* **Secondary (collaboration alone):** B vs A, same test. B is expected to match A on correctness; its claimed value is
  scheduling efficiency (latency, model loads), which is reported, not gated.
* Reported for every arm: first-attempt and final accuracy, by kind; median/P95 call latency and trial time; model
  calls; prompt and output tokens; model loads; peak free-RAM floor and memory waits; failure categories; repairs;
  Reviewer false approvals; Wilson 95 % intervals.
* If the primary criterion is not met, the result is reported as **functionally complete, intelligence improvement
  unproven**, whatever the direction of the difference.

### 1.5 Deterministic evaluation areas (no model; pass = every case)

Fixtures in `src/lib/bunny-host/ma4-s2.test.ts`: complex task planning (graph validity, cycles, bounds), multi-agent
handoff correctness (valid/invalid/tampered messages), memory retrieval quality (fixed corpus, precision@3 = 1.0 on the
fixed queries), incorrect-memory resistance (model-trust, untrusted, steering, expired, unverified, cross-project and
quarantined records never enter guidance), validated skill reuse (lifecycle, rollback, quarantine), tool permission
enforcement (skills cannot add tools or permissions), cancellation and restart safety (no duplicate irreversible
action after a crash), prompt-injection resistance (handoff and memory content stay data), resource bounds
(concurrency, model-call and tool budgets).

## 2. Results

PENDING — no S2 evaluation has run.

## 3. Deviations from the pre-registration

None yet.
