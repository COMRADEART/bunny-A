# MA4-S2-T3R — Real local pinned-model smoke (Phase H)

**Gate T3R-G11: PASS (10/10)** after fixing a real defect the fake model had hidden.

Run: `node --experimental-strip-types scripts/ma4-s2t3r/model-smoke.mjs` → `evidence/model-smoke.json`.
Production Host entry (`runHostEntry`: containment, the real Ollama call with the served-model receipt check), isolated data
directory and port, provider CLI probes off, synthetic project folder. Outputs are stored only as length + SHA-256 and
grounding checks.

| Item | Value |
|---|---|
| Pinned model | `qwen2.5-coder:7b` (the S2-T1 pin), Ollama 0.40.9, digest `dae161e2…f4364`, 4.68 GB |
| Excluded | `deepseek-v4.1-flash:cloud` (hosted tag) — never offered, never served |

## Defect found and fixed

The production `localModelCall` dropped the step's `schema` and `temperature`, so Ollama received no structured-output
format. With the real model every Reviewer verdict ("not a valid verdict") and Planner answer ("not JSON") was refused and
reviewed tasks failed closed. Fakes return clean JSON, so only the real run showed it. Fixed in `c4f36ff`; T3R-H1 pins the
request body. First run: 3 FAIL; after the fix: 10/10.

## Checks (after the fix)

| Step | Result |
|---|---|
| Goal proposal: a suggested goal waits (AWAITING_APPROVAL) and is active only after owner approval | PASS |
| Planning: the pinned Planner returns structured JSON; its plan left model steps unpinned, so the Host returned problems instead of a usable plan — proposal only, no task created | PASS (behaviour), quality limited |
| Authorized file read → Worker summary → Reviewer verdict, all with the pinned model, in 5.8 s | PASS — COMPLETED, evidence read/summary/review |
| The pinned model actually served (loaded in Ollama) | PASS |
| Summary grounded in the file (mentions the login timeout and RC3), 444 chars | PASS |
| Goal progress counts only the completed, verified task (1/1) | PASS |
| Pause during generation | PASS — takes effect at the step boundary (41.6 s here, by S2-T1 design) |
| Cancel | PASS — CANCELLED (installed release: 2.7 s mid-generation, `INSTALLED_WINDOWS_QUALIFICATION.md`) |
| A hosted tag named in a task | PASS — blocked `MODEL_UNAVAILABLE` ("no other model is used"), never run |

## Model-quality claims

None beyond these bounded checks: one synthetic file, one summary, one review. The 7B Planner did not produce a directly
usable plan.
