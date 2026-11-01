# UOF Lane — Providers: honest capability probes + quota signals (W2)

**Branch:** `unify/providers-capability-probes` · **Base:** `a9a79fe` · **Master prompt refs:** §3 W1.4, W2 acceptance ("supported / limited / unavailable honestly")

## Slice

A `CapabilityProbeSurface` that turns the existing per-provider facts (`src/lib/orch/types.ts` — `Availability`, `AuthState`, `UsageCapabilities`, `ObservedUsage`) into uof.v1 `Capability` + `QuotaSignal` records:

1. **Tri-state status** per provider+account: `verified` (real probe or run), `reported` (advertised only), `unavailable` — never inferred from an advertised model list alone.
2. **Quota-signal ingestion** — windows from provider APIs; `http_429` observations recorded with reset windows when the provider sends them; local counts stay `local_observed` and are never presented as provider quota.
3. **Rate-limit etiquette** — a 429 must never trigger retry-account-rotation: no account rotation to evade provider limits.
4. **No secret carriers** — everything passes `assertNoSecretKeys`; credentials remain behind `accountRef`.

Built on existing connector/provider seams; no change to OAuth flows, browser security, or containment.

## File ownership (exclusivity)

Owns: `src/lib/orch/capability-surface.ts` (new), `src/lib/orch/capability-surface.test.ts` (new).
Must not touch: island, voice, routing policy, device registry, auth implementation files.

## Acceptance (exact commands)

- `node --experimental-strip-types --test src/lib/orch/capability-surface.test.ts` → all pass.
- `npm run typecheck` → clean.
- Fixture-driven: an advertised-but-unprobed capability lands as `reported`, a real probe flips to `verified`, a 429 lands a `http_429` QuotaSignal with reset window, and a rotated-account retry attempt is rejected.

## Report-back

Branch diff + test output + typecheck output; no merge, no unrelated edits.