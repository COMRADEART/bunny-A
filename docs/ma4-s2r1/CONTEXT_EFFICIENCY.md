# MA4-S2R1 — Context efficiency

## 1. Budgets (in code, `relevance.ts`)

| Budget | Value | Enforcement |
|---|---|---|
| Skills per role call | 1 at most | `selectRelevant` returns one or none |
| Skill excerpt | ≤ 320 characters, whole procedure steps only, `[name vN #hash8]` header | `excerpt`; a skill whose first step does not fit is not shown |
| Experience | ≤ 1 line, ≤ 160 characters, arm C only, Planner and repair calls only | `experienceEligibility`, `EXPERIENCE_LINE_CHARS` |
| Advisory block | ≤ 600 characters including its header | `renderAdvisory`, `GUIDANCE_MAX_CHARS` |
| Cost in ranking | −1 per 400 excerpt characters | `WEIGHTS.costPer400Chars` |
| No eligible candidate | no block at all; the prompt is byte-identical to a run without retrieval | `S2R1 no-skill fallback` test |

Near-duplicate skills collapse to one (`compute-median` 3.33 is chosen over `calculate-median` 3.22; ties prefer the
shorter excerpt). Retrieval reads Lotus pointers and registry records only: no conversation, prompt, hidden test or
reference is ever loaded.

## 2. Measured (injected characters ÷ 4, against the prompt tokens Ollama reported)

| Run | Arm | Prompt tokens | Injected tokens | Share | Calls with guidance | Zero-injection trials |
|---|---|---|---|---|---|---|
| Dev (excerpt 400) | C | 34,853 | 1,714 | 4.92 % | 15 / 48 | 4 / 8 |
| Held-out (excerpt 320) | B | 161,105 | 5,556 | **3.45 %** | 60 / 216 | 20 / 32 |
| Held-out (excerpt 320) | C | 179,093 | 10,078 | **5.63 %** | 75 / 221 | 20 / 32 |

S2 for comparison (`RETRIEVAL_ROOT_CAUSE.md`): skills in 24 of 24 C trials, 939 characters per guidance block on
average. S2R1 blocks: B 324–399 characters (max 399), C 239–573 (max 573), never above the 600 limit.

**The pre-registered ≤ 5 % gate failed for arm C (5.63 %).** It passed for B. The excerpt cut from 400 to 320 after the
dev run (4.92 %) was not enough because the held-out C trials had more repair rounds than dev, and arm C adds the
experience line to every repair call: C's Worker-repair calls carried 9,684 injected characters against B's 4,782.

Where C's injected characters went: Planner 5,400; Worker attempt 4,348; Tester attempt 3,052; Worker repair 9,684;
Tester repair 3,009.

## 3. Cost per call

Retrieval itself is cheap: 3.7–11.2 ms per trial (Lotus pointers + registry + signature, no model). Arm C's prompts
were 11 % larger than A's (179k vs 160k tokens) for 2 % more calls; the extra is the injected text plus longer repair
histories. Median call latency rose from 12.6 s (A) to 13.4 s (C); trial time median from 90.9 s to 98.3 s.

## 4. Conclusion

The selection side of efficiency is fixed: no-skill is the default outcome, at most one skill, bounded excerpts. The
injected volume on the applicable tasks still exceeded the gate in arm C, and since the injected text did not help
(`INTELLIGENCE_EVALUATION.md`) the right budget for this team today is zero, which is the shipped default. If a future
milestone re-enables injection, the experience line should not be repeated on every repair call.
