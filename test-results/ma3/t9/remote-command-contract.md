# M-A-3 T9 — Remote command contract (as implemented)

Phone = authenticated thin client of the existing Windows Host. The Host is the only authority. No second
runtime, scheduler, MissionManager, TaskManager, router, authorization engine, provider registry, event
journal or memory authority exists. This contract narrows the existing Host commands; it adds no authority.

Source: `src/lib/bunny-host/device-authority.server.ts` (policy, ledger, limits, projection),
`src/lib/bunny-host/http.server.ts` (Host boundary), `src/lib/bunny-missions/manager.server.ts`
(`device*Refusal`, `remoteVerdicts`, `reissueStaleAgenticRequests`), `src/lib/bunny-host/agent-runtime.server.ts`
(device gates, Resume CAS), `src/lib/orch/host-bridge.server.ts` + `src/lib/orch/host.ts` (gateway),
`src/routes/api/bunny-events.ts`, `src/routes/api/bunny-pair.ts`, `install/Bunny-Server.mjs`.

## 1. Principals

| Principal | Established by | Actor string |
|---|---|---|
| Workstation owner | master bearer token, loopback gateway + loopback TCP peer | `workstation` |
| Paired device | per-device bearer (SHA-256 in `devices.token_hash`), issued by `/pair` against a workstation-created one-time code (96 bit, 10 min) | `device:<id>` |

Every device request re-authenticates (`authenticateDevice`): row present, `revoked_at IS NULL`,
`now < min(created_at + 365 d, max(created_at, last_seen_at) + 30 d)`. `last_seen_at` lives in the additive
table `device_presence` (written at most every 30 s); `devices` rows are only ever changed by `device.revoke`.
401 bodies carry `code`: `AUTH_REQUIRED` | `DEVICE_REVOKED` | `DEVICE_EXPIRED`.

Host identity: additive table `host_identity` holds one stable `host_id` (UUID, created once); the epoch is the
per-boot `instanceId`. Both tables are created before the installed-state marker is reconciled at boot.

## 2. Paired-device rights (default deny, `DEVICE_RIGHTS`)

Anything not listed → HTTP 400 `{ code: "WORKSTATION_REQUIRED", error: "<action> requires workstation access on the Windows Host." }`
before any dispatch.

- READ: `agent.list`, `agent.get`, `mission.get`, `project.list`, `project.get`, `project.artifact`, `operation.status`.
- SUPERVISE: `agent.pause`, `agent.resume`, `agent.stop`, `agent.authorization.deny`, `agent.authorization.revoke`,
  `mission.stop`, `mission.revoke_batch`, `inbox.ack`, `stop` (direct task).
- ANSWER (existing MA0/MA2/T5 phone rights, kept): `agent.authorization.approve`, `mission.approve`, `mission.start`,
  `mission.respond`, `approve` (direct task).
- CHAT: `submit` (queues for approval; `verify` and `constraints.workingDirectory` refused for devices), `task.feedback`.
- SELF: `device.revoke` — only the calling device (sign out).

Workstation-only for devices (now refused): `agent.create`, `agent.start`, `agent.authorization.propose`,
`agent.authorization.adjust`, `mission.create`, `mission.plan/replan/retry/configure`, `retarget`, `discover`,
`session.get`, `input`, `session.input`, `terminal`, every `project.*` mutation, every capability/skill/trigger
action, and all admin actions (pairing, provider paths, remote/thermal configuration, policy, legacy import,
verification records).

### Owner-consent boundary (inside the canonical paths, keyed on `device:`)

A paired device's **allow** is refused with `WORKSTATION_REQUIRED` and the caption
**"Approval required on Windows Host."** when any of:

1. the risk is in the Host's always-ask set: `EXTERNAL_SIDE_EFFECT`, `DESTRUCTIVE`;
2. a capability manifest involved is `sensitive` or `hardApproval` (screen capture, credentials, calls…);
3. a `provider.execute` ask whose child route is not local tool-free inference (Ollama, never a `:cloud` tag) —
   the Host itself asked because the route exceeds what it can confine;
4. a direct-task `approve` of a tool-capable or hosted route, or of a Mission child task;
5. initial Agentic delegation (the Agent's Mission is still `waiting_for_approval`) — the first start of an
   Agent stays on the Windows Host; post-restart re-consent of the same reviewed scope may be answered remotely
   within 1–2 (cross-application envelopes always need the workstation);
6. `mission.approve` / `mission.start` of an Agent-owned Mission (use the Agent path).

**Deny is never limited.** The Host publishes its verdict in projections (`remote: { answerable, reason }` on
pending requests, `remoteOffer` on a pending Agentic consent offer, `remote` on a pending Mission plan) so the
phone never re-derives policy.

### Scope clamp

- Agentic offers: `agent.authorization.*` data from a device may contain only `id` and `revision`; the Host
  checks the exact current revision (`assertRevision`) and identity of roots/commands/plan. A device can never
  propose or adjust scope.
- Mission plans: `mission.approve` binds to `plan` = the Host-computed `planReference` (digest of the reviewed
  steps); a replanned scope is refused (`The plan changed after it was reviewed…`). Extra client keys are ignored;
  the envelope is always built from the Host's own `requestedScope`.
- Batches: only the Host-computed `batchOffer`; `maxActions`/`ttlMs` may only shrink it.
- Resume: a device must send the Agentic `revision` it reviewed (when an Agentic record exists); stale → refused.

## 3. Command envelope

`POST /command { action, data, operationId?, expect?: { hostId?, epoch? } }`

- `expect` (sent by the phone on every mutating command): mismatching `hostId` → 409 `HOST_IDENTITY_CHANGED`,
  mismatching `epoch` → 409 `HOST_EPOCH_CHANGED`. Nothing executes.
- `operationId` (`^[A-Za-z0-9-]{8,64}$`, mutating actions only): per-epoch ledger keyed `<actor>\0<id>`,
  10 min TTL, 2000 total / 200 per principal. A replay returns the recorded outcome with
  `operation.replayed = true` and never executes again. Same id, different action → 409 `OPERATION_CONFLICT`;
  concurrent duplicate → 409 `OPERATION_IN_PROGRESS`.
- Success: `{ snapshot, task?, mission?, data?, agents?, operation?: { id, state: "applied", replayed } }`.
- Failure: `{ requestId, error, code, operation? }` with statuses: `REFUSED` 400, `WORKSTATION_REQUIRED` 400,
  `FAILED` 400 (generic text "Host command failed. Inspect operation state before retrying."), `HOST_UNAVAILABLE`
  503, `RATE_LIMITED` 429 (+ `retry-after`, `retryAfterMs`), `HOST_*_CHANGED` / `OPERATION_*` 409.
  Ledger state: refusals → `refused` (nothing executed); `FAILED`/`HOST_UNAVAILABLE` → `failed` (may have partly
  applied: reconcile).
- `operation.status { operationId }` → `data: { operationId, state: applied|refused|failed|in_progress|unknown, action?, at?, code?, error?, epoch }`.
  `unknown` after a Host restart (the ledger is per epoch): reconcile from canonical state only.

## 4. Limits (devices only; the workstation is unchanged)

Per device, fixed 60 s windows: `/command` 60, `/state` 300, `/events` opens 30. Open `/events` per device ≤ 3,
all device streams ≤ 24. Exceeding → 429 `RATE_LIMITED`. `device.revoke` closes that device's open streams at
once (in addition to the per-delivery credential check). Refused device commands emit `audit.device_refused`.

## 5. Snapshot additions

- `hostIdentity: { hostId, epoch, startedAt }` and `viewer` (`workstation`, or `device` with id, name, role
  `paired-device`, pairedAt, expiresAt, lastSeenAt, rights) for every caller. No credential or hash ever.
- `devices[]` gains `expiresAt`, `lastSeenAt`.
- Device projection (Host-side, before the gateway's public redaction): only the caller's own device row;
  tasks = every active task + newest 100 finished; Mission child task prompts replaced by the step objective;
  task `cwd`/`pid`/`processTree`/`sessionId` removed; provider `executable`/`evidence` and active session
  ids/pids removed; `presentation.tasks` trimmed to the kept tasks; Agents = every unfinished + newest 50 finished.

## 6. Gateway

- `authorizeBridge`: remote access additionally requires a loopback TCP peer (the tunnel connector on this
  machine); a LAN peer forging `x-forwarded-proto: https` is refused (transport downgrade).
- `readBunnyHost` → `{ ok: true, snapshot } | { ok: false, code, message, status, pairing, retryAfterMs? }`.
- `commandBunnyHost({ action, data, operationId?, expect? })` →
  `{ ok: true, snapshot, task?, mission?, data?, pairCode?, operation? }` or
  `{ ok: false, outcome: "refused" | "unknown", code, message, status, pairing, requestId?, operation? }`.
  `unknown` = the Host may have applied it (timeout/reset after sending, or a Host `FAILED`); the client must
  reconcile (`operation.status` + canonical refresh) and never resend automatically. Command timeout 45 s.
- `/api/bunny-events`: typed 401/429/403; the stream starts with `event: ready` and turns Host heartbeats
  (~15 s) into `event: hb`; event messages carry only `{ sequence }`.
- `/api/bunny-pair`: `POST` returns `{ paired, deviceId, hostId }` (+ HttpOnly/Secure/SameSite=Strict cookie);
  `DELETE` = sign out (device revokes itself on the Host, cookie cleared).
- Installed gateway (`install/Bunny-Server.mjs`): `X-Frame-Options: DENY`,
  `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: no-referrer` on every response.

## 7. Agent runtime fixes made for remote supervision

- G2: Pause/Resume (and workstation scope reduction) move the Agentic revision; open asks stamped with the old
  revision are closed (`resolvedBy: "<actor> (superseded at Agentic revision N)"`, no denial fingerprint) and
  re-asked at the current revision. Answering while paused is refused with an explicit message.
- G3: a paused Agentic Agent after a Host restart: fresh reviewed consent (`agent.authorization.approve`) makes
  consent ACTIVE; Resume then lifts the hold without re-granting anything.
- G6: `agent.stop`, `agent.pause`, `agent.authorization.deny/revoke` work while the Host is degraded.
- G13: Revoke/Deny on already-ended consent still stops the Agent.
- G7: `mission.start` of an Agent-owned Mission is refused for devices.
- Workstation `device.revoke` of a lost device ends the batches it created and revokes Agentic consent it
  approved (stopping those Agents). A device's own sign-out does not cascade.
