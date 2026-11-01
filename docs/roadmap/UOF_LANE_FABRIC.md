# UOF Lane — Fabric: coordinator epoch/lease fencing (W3)

**Branch:** `unify/fabric-coordinator-lease` · **Base:** `a9a79fe` · **Master prompt refs:** §3 W3 (split-brain prevention: leases, monotonic epochs/fencing tokens, single-writer decisions, reconciliation), §1 idempotency

## Slice

A `CoordinatorFence` module implementing the split-brain arithmetic the device fabric needs before any remote execution ships:

1. **Leases** on serialized task resources: acquire/renew/expire with holder + TTL + heartbeat interval.
2. **Monotonic epochs with fence tokens** — every takeover bumps the epoch; old epoch actions are rejected as `stale_epoch`; a fenced-out coordinator can never double-run a destructive side effect.
3. **Fence-guarded action admission** — destructive/single-writer actions must carry `(resourceRef, epoch, fenceToken)`; the guard verifies current lease holder, epoch, expiry.
4. **Idempotent side effects** — `applyOnce(actionKey, run)` dedups replayed/duplicate deliveries so reconnect storms can't duplicate work.
5. **Ownership policy data** — `pickCoordinator(devices, health)` expresses server-primary preference with Windows fallback as a pure decision function; no runtime wiring in this slice (wiring into the persistent host is the next slice, gated on this module's tests).

Pure module, injected clock, no I/O, no changes to existing host files.

## File ownership (exclusivity)

Owns: `src/lib/bunny-host/coordinator-fence.ts` (new), `src/lib/bunny-host/coordinator-fence.test.ts` (new).
Must not touch: host.ts, agent-machine, workers, remote-device, island, voice.

## Acceptance (exact commands)

- `node --experimental-strip-types --test src/lib/bunny-host/coordinator-fence.test.ts` → all pass.
- `npm run typecheck` → clean.
- Required cases: takeover bumps epoch + stales old fence token; expired lease cannot renew but permits takeover; guard rejects stale epoch / wrong token / wrong holder / expired lease; duplicate delivery runs the effect exactly once; server-primary → Windows fallback decision on unhealthy server.

## Report-back

Branch diff + test output + typecheck output; no merge, no unrelated edits.