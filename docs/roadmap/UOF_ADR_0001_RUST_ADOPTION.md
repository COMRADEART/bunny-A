# ADR-0001 — Rust adoption decision for UOF reliability components

**Status:** Accepted (TypeScript stays; revisit triggers defined below)
**Date:** 2026-11-01 · **Owner approval:** none required for a no-op decision (master prompt §0.3 permits TypeScript when reasons are explicit)
**Scope:** Phase 1B decision required by `Bunny_A_Unified_Orchestration_Master_Prompt.md` §0.3

## Decision

New UOF orchestrator components (route ledger, capability/quota surface, coordinator fencing, and their planned integration wiring) are TypeScript modules inside the existing Host process. No Rust crate is introduced in Phase 1B; versioned FFI/IPC seams are *not* added for their own sake.

## Evidence (measured or cited, per the master prompt's bar)

1. **The dominant latency is not JS.** Whole-answer voice P50 ≈ 6.5 s under load (MA5-S2 Phase 4R1 evidence; masterplan §2), dominated by model/STT/TTS stages the process doesn't schedule. Agent-run durations are dominated by inference + tool I/O. No profiler artifact shows event-loop starvation as the bottleneck.
2. **Reliability work already landed in TypeScript, tested.** Failure containment, idempotency, approval gating (MA2/MA3), DAG admission/fairness (ma4), and now epoch/lease fencing — the split-brain arithmetic is pure and test-locked (8/9-then-9/9 fence tests, all CI green).
3. **Migration cost is real and one-sided.** A Rust coordinator means FFI/IPC at every host seam (agent-store, connectors, device fabric), a second toolchain in CI, and Android cross-compile surface — all to fix a bottleneck never observed at this scale.
4. **Durable state lives in the existing DB path** (pg/Kysely + pglite) with WAL semantics; the durable-queue pattern rides the platform rather than a new runtime.

## Revisit triggers (measured, not vibes)

Reopen this ADR when any of the following is measured:

- Host event-loop p95 stall > **200 ms** while voice + ≥3 concurrent agents run (integration-gate telemetry owns this number);
- Durable-queue fsync/append path > **50 ms** p95 under the gate's failure-injection load;
- Cross-device transport needs sustained > **100 MB/s** through-process relay.

## Consequences

- Phase 1B integration gate runs against the TypeScript stack; the ADR travels with the gate report.
- If a trigger fires, the FIRST Rust slice is the coordinator event loop/lease handoff only (per §0.3: new shared functions behind a narrow protocol), not a migration.