# D4 — Trusted workstation identity audit

**Question:** can anything other than the Host's own owner-authentication contract make Host code treat an action as the trusted workstation?

**Answer:** no supported path was found. Two hardening changes were made: a strict `Bearer` scheme, and gateway handling of unknown relay headers.

## The owner-authentication contract (unchanged in principle)

1. **The Host token.** The Host listens only on `127.0.0.1` and rejects any `Host` header other than `127.0.0.1:<port>` / `localhost:<port>`, and any `Origin` or cross-site fetch (`http.server.ts`). Its token is 32 random bytes, persisted only in the Host's private `credentials.json`.
2. **The local principal.** `local = equal(bearer, token)` is a timing-safe comparison. Only then is `principal = { kind: "workstation" }`, and `actorOf(principal)` the only producer of the string `"workstation"` for HTTP requests.
3. **Device principals.** A device credential is a different random token, stored only as a SHA-256 hash in `devices`. It always yields `device:<uuid>`. A UUID can never equal `"workstation"`.
4. **Actor provenance.** The `actor` passed to `missionCommand`, `agentCommand`, `TaskManager.approve`, `respond`, `approve`, `stop` and the rest is always that derived value. Request JSON fields (`actor`, `by`, `grantedBy`, `resolvedBy`, `principal`) are never read as identity. A device's `mission.respond` body may carry only `requestId`, `decision`, `maxActions` and `ttlMs`.
5. **Trusted-local check.** `isTrustedLocalActor()` accepts exactly `"workstation"`. Every other grantor, including synthetic strings such as `"test"`, is remote and fails closed. Under F02 their writes are staged, which is why three Agent tests that model the local owner now pass `"workstation"`, as F01 did for their siblings.

## F02 hardening

| Change | Why |
|---|---|
| `http.server.ts`: only an exact `Bearer <credential>` header authenticates (`/^Bearer (\S+)$/`); a bare token, other schemes, padding and suffixes are refused | Removes the lenient `replace(/^Bearer /, "")` parse. Every Host client already sends exactly `Bearer <token>` (bridge `hostCall`, `bunny-events`, `bunny-pair`, rollback preflight), verified by review round 2. |
| `host-bridge.server.ts`: any `x-*` header outside `x-tss-*`, `x-tsr-*`, `x-requested-with` and `x-bunny-pair-client` marks a loopback request as relayed, so it never receives the workstation token | The previous denylist of relay families could miss an unknown loopback relay (review round 1, MEDIUM). |
| Device liveness at admission (`missions.deviceActive`) | A device answer or a remote-envelope staged change is honoured only while that device row is unrevoked, within its absolute lifetime and within its idle bound. |

## Impersonation tests (real HTTP Host, `src/lib/bunny-missions/f02-identity-signout.test.ts`)

| Attempt | Result | Test |
|---|---|---|
| Paired phone body `actor/by/grantedBy/resolvedBy/principal: "workstation"` on `mission.respond`, `mission.approve`, `agent.authorization.approve`, `device.revoke` | SQLite records only `device:<id>`; desktop-required asks stay refused | F02-E26 |
| Forged headers `X-Owner`, `X-Bunny-Actor`, `X-Forwarded-For: 127.0.0.1`, `Forwarded`, device cookie | viewer stays `device`; staging list refused `WORKSTATION_REQUIRED`; no answer applied | F02-E27 |
| Unpaired token, no credential, `Token`/`Basic` schemes, cookie-only, bare Host token, padded or suffixed `Bearer`, lowercase `bearer` | `401` | F02-E27 |
| Gateway: relay headers, device cookie, unknown `x-*` relay family; local `x-tss-*`/`x-requested-with`/`x-bunny-pair-client` still local | throws or remote; local headers keep `local` | F02-E27 (gateway) |
| Paired phone answers a promotion or desktop-required ask; reads or lists staging | refused `WORKSTATION_REQUIRED` | F02-E28, F02-E14 |
| Real workstation token promotes a staged change end to end | `200`, `PROMOTED`, file verified | F02-E29, live §18 step 6-9 |
| Replay of a revoked (signed-out) device token | `401 DEVICE_REVOKED` | F02-E29, live §18 step 15 |
| Re-paired device (new id) re-using old request ids | refused; old answers stay invalid | F02-E34 |

## Synthetic fixtures

In-process tests pass the literal `"workstation"` directly to manager methods. These are clearly in-process unit and integration fixtures with no HTTP surface. The HTTP-level tests above (and the live acceptance) authenticate with the real Host token and real device tokens.

## Residual (documented, not claimed closed)

- A process running as the same Windows user that can read `credentials.json` can act as the workstation. This is the existing local trust model and is out of F02 scope.
- Hard-coded `"workstation"` literals remain in Host-internal flows: `adjustAgentAuthorization` re-ask provenance, project-service owner flows behind `if (!local)`, the `TaskManager.approve` default, and restart reconciliation `decidedBy`. Review rounds 1–2 confirmed each is unreachable from a device. They are recorded as LOW hardening items.
