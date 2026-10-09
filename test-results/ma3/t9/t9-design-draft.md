# MA3 T9 — Phone remote control contract (implementation spec)

Phone = authenticated thin client. Windows Host = sole authority. No new runtime, scheduler,
router, authorization engine, provider registry, event journal or memory authority.

## 1. Principals and roles (Host, http.server.ts)

| Principal | How established | Actor string | Role |
|---|---|---|---|
| Workstation owner | master bearer token (loopback gateway, local peer) | `workstation` | `workstation` — full Host authority |
| Paired device | per-device bearer token (hash in `devices`), created by `/pair` with a workstation-issued one-time code | `device:<id>` | `paired-device` — single fixed role, rights below |

Device authentication (every request): `token_hash = sha256(bearer)` AND `revoked_at IS NULL` AND
`created_at > now - DEVICE_SESSION_MS` (365 days — the existing cookie Max-Age, now enforced
server-side). 401 bodies carry `code`: `AUTH_REQUIRED` | `DEVICE_REVOKED` | `DEVICE_EXPIRED`.
Presence: additive table `device_presence(device_id PK, last_seen_at, last_action)` updated at most
every 30 s per device. `devices` rows are never altered except by `device.revoke`.

Host identity: additive table `host_identity(key PK, value)` with one `host_id` (random UUID on
first boot, stable forever). `epoch` = existing per-boot `instanceId`.

## 2. Paired-device rights (default deny)

Anything not listed → HTTP 400 `{ code: "WORKSTATION_REQUIRED", error: "<action> is available on the Windows Host." }`.

READ: `agent.list`, `agent.get`, `mission.get`, `project.list`, `project.get`, `project.artifact`
(existing verified/hash/size/project checks), `operation.status` (new).

SUPERVISE (only reduce or hold authority): `agent.pause`, `agent.resume` (existing full
revalidation), `agent.stop`, `mission.stop`, `stop` (direct task), `agent.authorization.deny`,
`agent.authorization.revoke`, `mission.revoke_batch`, `inbox.ack`, `mission.respond` with
`decision: "deny"`.

ANSWER EXACT HOST OFFERS (sensitive boundary applies):
- `agent.authorization.approve {id, revision}` — only when the Agent has an Agentic offer in
  `WAITING_FOR_USER` at exactly `revision`; refused when no offer exists (devices never start
  Agents or initiate delegation), when `risk_ceiling ∈ {EXTERNAL_SIDE_EFFECT, DESTRUCTIVE}`, or
  when any permitted capability's manifest is `sensitive` or `hardApproval`.
- `mission.approve {id[, revision]}` — refused for Agent-owned Missions (use the Agent path) and
  when requested risk classes include `EXTERNAL_SIDE_EFFECT`/`DESTRUCTIVE`.
- `mission.start {id}` — refused for Agent-owned Missions.
- `mission.respond {requestId, decision: allow_once|allow_batch}` — refused when the request risk
  is `EXTERNAL_SIDE_EFFECT`/`DESTRUCTIVE` or the action manifest is `sensitive`/`hardApproval`.
- `approve {id}` (direct task route) — only for tool-free routes (`ollama`, text-only); a
  tool-capable agent CLI route (codex/claude/opencode/cline/cursor) needs the Windows Host.

CHAT: `submit` (queues a task that waits for approval), `task.feedback`.

SELF: `device.revoke {id: <own id>}` (sign out this phone).

Explicitly workstation-only (now refused for devices): `agent.create`, `agent.start`,
`agent.authorization.propose`, `agent.authorization.adjust`, `mission.create`, `retarget`,
`discover`, `session.get`, `input`, `session.input`, `terminal`, all `project.*` mutations, all
admin actions (already gated), every other mission/capability/skill/trigger action.

Refusals use `WORKSTATION_REQUIRED` so the phone renders **"Approval required on Windows Host."**
(for approvals) or **"Available on the Windows Host."** (other controls).

## 3. Command envelope

Request: `POST /command { action, data, operationId?, expect?: { hostId?, epoch? } }`
- `operationId`: client UUID (`^[A-Za-z0-9-]{8,64}$`). Host ledger keyed `<principal>:<operationId>`,
  bounded (2000 total, 200 per principal, 10 min TTL). Replay of a finished operation returns the
  recorded outcome with `operation.replayed=true` and does NOT re-execute. Same id with a different
  action → 409 `OPERATION_CONFLICT`. Concurrent duplicate → 409 `OPERATION_IN_PROGRESS`.
- `expect`: when present and not equal to the current `hostId`/`epoch` → 409
  `HOST_IDENTITY_CHANGED` / `HOST_EPOCH_CHANGED`; nothing executes. The phone always sends it for
  mutating commands; authority itself still comes from the canonical revision/grant checks.

Responses add `operation: { id, state: "applied"|"refused", replayed }` when an operationId was sent.
Error bodies: `{ error, code, requestId, operation? }`; codes `REFUSED`, `FAILED`,
`WORKSTATION_REQUIRED`, `RATE_LIMITED` (429 + retry-after), `HOST_UNAVAILABLE` (503), epoch/op codes.

`operation.status {operationId}` → `data: { operationId, state: applied|refused|in_progress|unknown,
action?, at?, code?, error? }`. `unknown` after a Host restart (ledger is per epoch) — the client
then reconciles from canonical state only.

## 4. Rate limits (devices only; workstation unchanged)

Per device fixed window 60 s: `/command` 60, `/state` 300. `/events` concurrent ≤ 3 per device,
≤ 24 device streams total. Exceed → 429 `RATE_LIMITED`. On `device.revoke` the Host closes that
device's open streams immediately (registry), in addition to the per-delivery check.

## 5. Snapshot additions

`hostIdentity: { hostId, epoch, startedAt }` for all callers.
`viewer`: `{ kind: "workstation" }` or `{ kind: "device", deviceId, name, pairedAt, expiresAt,
lastSeenAt, role: "paired-device" }`.
Device projection (Host-side, before the gateway): `devices` → only the caller's own row; tasks →
active + newest 100; task `cwd`/`pid`/`processTree` removed; provider `executable` removed.

## 6. Gateway

- `authorizeBridge`: the remote branch also requires a loopback TCP peer (the local tunnel
  connector) — a LAN peer forging `x-forwarded-proto: https` is refused (transport downgrade).
- `hostRequest` returns Host refusals as typed data, throws only on transport failure:
  commandBunnyHost → `{ snapshot, ..., operation }` or `{ refused: { code, message, requestId, operation } , snapshot? }`.
  Device 401 → typed refusal `DEVICE_REVOKED`/`DEVICE_EXPIRED`/`AUTH_REQUIRED` (pairingRequired).
- `/api/bunny-pair` POST returns `hostId`; new DELETE = sign out (revoke own device + clear cookie).
- Installed gateway (install/Bunny-Server.mjs): `Content-Security-Policy: frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` on every response.

## 7. Client

Connection model (pure, tested): `live` (fresh snapshot ≤ 20 s & stream live) / `polling`
(fresh, SSE unavailable) / `reconnecting` / `offline` (stale since T) / `pairing` (revoked,
expired, unpaired) / `host-changed` (pinned hostId differs). Mutating controls enabled only in
`live`/`polling` with a fresh snapshot.
SSE `live` only after the first message; if no message within 8 s or 3 consecutive errors →
polling (3 s visible, 30 s hidden; backoff 3→60 s while unreachable; immediate refresh on
`visibilitychange`/`online`). Stop auto-retry while pairing is required.
Commands: every mutating command gets an `operationId` + `expect`; a transport failure leaves the
control in **"Outcome unknown — checking the Host…"**, then `operation.status` + canonical
refresh decide; nothing is resent automatically; nothing is queued offline.
Host pin: `localStorage["bunny-a.remote-host.v1"] = { hostId }` (non-secret). Mismatch →
`host-changed`, controls off until the user explicitly trusts the new Host.
Revoked/expired: clear Agents/Missions/Tasks/Projects from memory, show pairing.
Notification constructor wrapped in try/catch (Android Chrome throws).
UI: connection banner with last-updated time; viewer-aware controls (device: hide/disable
workstation-only controls with visible captions); Agent detail answers per-request asks (Allow once
/ Deny) and the Agentic offer review with exact fields; "Approval required on Windows Host" where
the Host requires it; Devices page shows this device, Host identity, session expiry, rights, sign
out; attention badge on the mobile menu; Talk/Redirect stay disabled with a visible caption.
