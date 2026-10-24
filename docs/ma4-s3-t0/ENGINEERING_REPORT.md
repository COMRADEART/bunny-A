# MA4-S3-T0 — Engineering Report

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T0 Unified Product Foundation  
**Branch:** `ma4-s3-t0-unified-foundation`  
**Integration merge:** `5e6c7e956a9c8271939bd93722b2d59107d4e9c9` (main + T8 + local remediation `e7d3bf2`)  
**Candidate tip:** `f5577389a0eaffb8520399e0a1104822f1987cdc`  
**Pull request:** https://github.com/COMRADEART/bunny-A/pull/35

## What we did

1. **Phase 1 reconciliation** — proved remediation was local-only; merged safely onto current `main` without destroying worktrees.  
2. **Architecture audit** — documented dual execution paths, trust boundaries, maturity matrix; corrected prior S2 PASS overclaims for notifications/feedback/onboarding.  
3. **Targeted repairs (no rewrite):**
   - Block cancel of `UNCERTAIN` (Host + UI + transition table + test)
   - Preserve `taskId` on ptask event emit
   - Durable beta feedback + Host `feedback.*` commands + export
   - Route session notifications through `evaluateNativeNotification`
   - `.unref()` runtime timers (force-exit root cause)
4. **Documentation** — concise evidence-linked set under `docs/ma4-s3-t0/`.

## What we did not do (on purpose)

- Did not rewrite main prompt onto `ptask`
- Did not implement OS tray or Android push
- Did not replace 7-step onboarding with 10-stage UI in this pass
- Did not force-merge/deploy, did not kill soaks, did not change model pins
- Did not claim Layer 4 hardware PASS

## Verification this turn

- `tsc --noEmit`: pass  
- Targeted suites (37): pass  
- `npm run test:ma4`: **252 pass, 0 fail, 2 skipped**, 33.2s on tip  

## Recommended readiness

| Scope | Decision |
|---|---|
| Controlled local-only preview | **CONDITIONAL GO** — local models + Host + schedules; external OAuth/signing/Android push off |
| Public beta | **NO-GO** until G13–G17 evidence on sealed tip |

## Next: MA4-S3-T1

Adaptive agent intelligence & hardware-aware inference — **after** this foundation’s remaining gates (installed journeys, soak, CI) close or are explicitly waived.
