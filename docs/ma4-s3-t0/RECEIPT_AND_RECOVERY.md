# MA4-S3-T0 — Receipt and Recovery

## Receipt stores

1. **`ma4_task_operations`** — per-step operation start/receipt under lease fence  
2. **`ma4_action_receipts`** — hash-chained ActionLedger (`connected` broker)  
3. **Owner-attested** — `reconcile('happened')` writes receipt `"owner-attested"` / `outputSha256=sha256("owner-attested")` — **not** independent evidence

## No-blind-replay

| Category | Crash mid-flight |
|---|---|
| read_only | retry within maxAttempts |
| idempotent | `needs_verify` then `verify(key)` |
| irreversible | **UNCERTAIN**; never auto-retry |

Tests: `ma4-s2t1.test.ts` T1-5 (+ T0 cancel refusal), crash boundary suite.

## Secrets

Receipts must not include tokens/prompts; ActionBroker redacts; support-bundle scrubbers in `diagnostics-feedback.ts`.
