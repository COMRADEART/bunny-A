# MA4-S3-T0 — Delegation Efficiency

## Status: MEASUREMENT FRAMEWORK / PRIOR EVIDENCE

Complexity-aware paths already exist in connected workflow + orch modes (`fast` / `balanced` / etc.). T0 does not add new models.

Suggested classification (product policy):

| Class | Agents |
|---|---|
| Direct response | One model |
| Simple tool | Executor + deterministic verify |
| Multi-step | Planner + Worker |
| High-risk | Planner + Worker + independent verify (deterministic first; optional AI review) |

**Gate S3T0-G9:** PARTIAL — prior qualify scripts measure model-call counts; fresh before/after on this SHA pending.
