# Current intelligence architecture

T1 adds decisions in `src/lib/bunny-host/ma4/s3t1.ts` and applies two of them inside the existing Host.

The Host still authorizes tools, approvals, and providers. Classification does not. The task runtime, Approval Center, permission broker, scheduler, voice stack, and Android companion are unchanged as products. Local routing and launch revalidation grew a preference check and a digest check.

```text
request
  -> Host baseline class C0–C3
  -> untrusted model class is discarded when it disagrees
  -> C0: one local model, no team
  -> C1: one tool executor, deterministic check, no planner
  -> C2: Planner + Worker
  -> C3: Planner + Worker + Reviewer, plus Host verification
  -> model policy HARD_PIN | PREFERRED | AUTO_LOCAL
  -> admission against measured budget
  -> existing Host execution
  -> completion and verification recorded separately
```

`boundedTeamCapabilities()` returns null for C0 and C1. For C2 and C3 it feeds the existing `composeTeam()`, which already omits roles whose capabilities were not requested. Connected workflows keep their previous constant team.

The coding-task graph in `task-intelligence.ts` is still the four-role graph for that explicit coding contract. T1 does not silently shrink a task that already asked for code, tests, and review.
