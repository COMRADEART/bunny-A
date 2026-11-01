# UOF Lane — Core: route-decision ledger (W1)

**Branch:** `unify/core-route-ledger` · **Base:** `a9a79fe` · **Master prompt refs:** §3 W1.4/W1.5, §2 (ExecutionEvent, PolicyDecision)

## Slice

A `RouteDecisionLedger` that makes every routing decision:

1. **Reasoned** — the chosen candidate plus the reason it won (quality floor, latency, remaining quota, device health).
2. **Alternatives-aware** — every candidate considered with its elimination reason (unsupported capability / no authorization / unavailable device / quota cap / quality below target) or losing reason (cost, latency, policy).
3. **Outcome-carrying** — calibratable record of `requested → routed → actual outcome` (success/verify-failed/quota-exhausted/provider-failed) per attempt.
4. **Quota-uncertainty-honest** — unknown cost/usage stored as `basis: "unknown"`; never treated as zero.

Built ON the existing router (`src/lib/orch/router.ts`, `src/lib/bunny-host/routing*.ts`) — a recording layer beside it, not a second decision engine. No change to existing routing behavior, orderings, or the MA4 admission gates.

## File ownership (exclusivity)

Owns: `src/lib/orch/route-ledger.ts` (new), `src/lib/orch/route-ledger.test.ts` (new).
Must not touch: island, voice, connectors, device registry, host event loop, routing policy files.

## Acceptance (exact commands)

- `node --experimental-strip-types --test src/lib/orch/route-ledger.test.ts` → all pass.
- `npm run typecheck` → clean.
- Recorded decisions reproduce deterministically on fixed fixtures (same inputs → same decision row, byte-stable `alternatives` ordering).
- A provider failure and a quota cap injected on replay both land as outcome rows with `basis` honesty preserved.

## Report-back

Branch diff + test output + typecheck output; no merge, no unrelated edits.