# M-A-3 T9 — Phone client implementation spec (store, connection model, UI)

Read first: `test-results/ma3/t9/remote-command-contract.md` (the Host/gateway contract, already implemented),
`src/lib/orch/host.ts` (typed `readBunnyHost` / `commandBunnyHost` results), `src/lib/bunny-host/contracts.ts`
(`hostIdentity`, `viewer`), `src/lib/bunny-missions/types.ts` (`RemoteAnswer`, `MissionView.planReference/remote`),
`src/lib/bunny-missions/agentic-types.ts` (`pending[].remote`, `remoteOffer`), `src/lib/bunny-host/event-signal.ts`
(`event: ready`, `event: hb`). The audit gaps being closed are in `test-results/ma3/t9/audit/browser.json`
(PHONE-01..16) and `gateway.json` (GW-2).

Hard rules
- The phone is a thin client. Every control calls a real Host command through the store; never mutate Agent,
  Mission, Task or approval state locally. Show a change only after the Host acknowledges it or a canonical refresh
  shows it.
- Never invent values: unknown model/usage stays "Unknown"; no fake progress or work animation.
- Codes decide behaviour, never message text (`result.code`, `result.pairing`, `result.outcome`).
- Never store a credential in browser storage. The device credential is the HttpOnly cookie only. The only new
  storage key allowed is `bunny-a.remote-host.v1` = `{ "hostId": "<uuid>" }` (non-secret), always read/written in
  try/catch.
- Keep `agentControls(agent, online: boolean)` with exactly its current three keys (`premium-model.test.ts` deep-equals
  them). Compute `online` at the call site from the connection model. Put any new captions/flags in separate helpers.
- Keep existing exported component names and existing tests green (`npm run test:ui` = 78 baseline tests).
- Do not edit `package.json`, `src/lib/bunny-host/**`, `src/lib/bunny-missions/**`, `src/lib/orch/host-bridge.server.ts`,
  `src/routes/api/**`, `install/**`, `public/__grok/**`, `server/**`. `src/lib/orch/host.ts` types may be read, not changed.
- Files use CRLF line endings in the working tree; keep each file's existing line-ending style.

## A. Store and connection (src/store/use-island.ts, src/components/island/host-stream.ts, new pure modules)

1. New pure module `src/components/island/connection-model.ts` (+ `connection-model.test.ts`, node:test, imported with
   `.ts` extensions like the other island tests). States:
   `connecting | live | polling | reconnecting | offline | pairing | host-changed`.
   - `live`: last successful snapshot ≤ 20 s old AND the event stream delivered `ready` or `hb`/message ≤ 35 s ago.
   - `polling`: fresh snapshot, stream unavailable/stalled (no `ready` within 8 s, or no `hb`/message for 35 s, or 3
     consecutive stream errors). Poll every 3 s while visible, 30 s while hidden.
   - `reconnecting`: last read failed but we had data; retry with backoff 3 → 6 → 12 → 30 → 60 s (cap), reset on success.
   - `offline`: 2+ consecutive read failures (show "Offline · last updated <time>"; retained data is marked stale).
   - `pairing`: a read/command/stream returned `pairing: true` (or 401 PAIRING/AUTH/DEVICE_* codes). Stop all automatic
     retries and streams. Clear agents, missions, tasks, projects, events, activities, presentation-derived data from
     memory. Show the pairing UI.
   - `host-changed`: viewer is a device and `snapshot.hostIdentity.hostId` ≠ pinned hostId. Controls off until the user
     explicitly taps "Trust this Host" (re-pin). Pin on successful pairing (`POST /api/bunny-pair` returns `hostId`) or
     on the first device snapshot when nothing is pinned. Workstation viewers never pin.
   - Pure helpers to export and test: `nextState(...)`/reducer of events (read ok/fail, stream ready/hb/message/error,
     pairing, host identity), `canAct(state, snapshotAgeMs)` (true only in live/polling with snapshot ≤ 20 s),
     `backoffMs(failures)`, `pollIntervalMs(visible)`, `freshness label`.
2. `refreshOllama` (keep the name): `readBunnyHost` now returns `{ ok, snapshot } | { ok: false, code, pairing, … }`.
   Race it against a 12 s client timeout (a hung read clears the single-flight slot and counts as a failure).
   On `ok`: existing `apply` path plus host identity/epoch tracking, viewer, pin check. On `pairing`: enter pairing.
   On other failures: reconnecting/offline per the model. `needsCanonicalResync` behaviour stays.
3. `command(action, data)` rewrite:
   - Mutating actions get `operationId = crypto.randomUUID()` and `expect = { hostId, epoch }` from the current
     snapshot's `hostIdentity` (omit `expect` if unknown). Read actions (`agent.get`, `mission.get`, `project.list`,
     `project.get`, `project.artifact`, `operation.status`) send neither.
   - Refuse locally (no request) when `canAct` is false for a mutating action: show "Reconnect to the Host before
     changing anything." Nothing is queued offline; nothing is replayed later.
   - `{ ok: true }` → apply snapshot, return the result.
   - `{ ok: false, outcome: "refused" }` → show a caption chosen by code: `WORKSTATION_REQUIRED` → the Host message
     (it already reads e.g. "Approval required on Windows Host."), `HOST_EPOCH_CHANGED`/`HOST_IDENTITY_CHANGED` → "The
     Host changed since this view loaded. Nothing was changed; showing current state." then refresh; `RATE_LIMITED`
     → "Too many requests. Wait a moment."; pairing → pairing state; else the Host message. Return null.
   - `{ ok: false, outcome: "unknown" }` or the server function itself throwing/timeouts (50 s) → record an uncertain
     operation `{ operationId, action, targetId, since }` in store state `uncertain`, show "Outcome unknown — checking
     the Host…", then reconcile: refresh; if the epoch is unchanged call `operation.status`; resolve to "Confirmed by
     the Host" (applied), the refusal caption (refused), or "The Host restarted; check the current state below"
     (unknown/epoch changed). Never resend automatically. Controls for that target stay disabled while uncertain.
   - Expose `uncertain` and a `pendingAction` per target id so buttons can show pending state.
4. New/changed store actions: `resumeAgent(id)` sends `{ id, revision }` with the Agent's current
   `authorization.revision` when an authorization exists; `approveMission(id)` sends `{ id, plan: mission.planReference }`
   when present; `respondMission(requestId, decision)` unchanged API; `agentAuthorization(...)` unchanged;
   `signOutDevice()` → `fetch("/api/bunny-pair", { method: "DELETE" })` then pairing state; `pairDevice(code, name)` →
   `POST /api/bunny-pair` (JSON), pin returned `hostId`, then refresh. `trustHost()` re-pins the current hostId.
5. `host-stream.ts`: one EventSource at a time, only when `connection` allows (not pairing/host-changed). Listen for the
   named `ready` and `hb` events (addEventListener) and normal messages (invalidate → coalesced refresh, as now).
   Fall back to polling per the model; exponential reconnect with the backoff above (no fixed 3 s loop, no two reads
   per cycle). Immediate refresh on `visibilitychange` (visible) and `online`; pause polling cadence when hidden.
   On a 401/pairing stream refusal stop reconnecting. Clean up every timer and listener on unmount.
6. Notifications: wrap every `new Notification(...)` in try/catch (Android Chrome throws `Illegal constructor`); a
   notification failure must never mark the Host offline or fail a command. Bodies never include prompts or details.
7. Bounded memory: keep events/activities caps as today; do not retain more than the snapshot provides.

## B. UI (src/components/island/*.tsx, premium.css, src/routes/__root.tsx viewport meta only)

Follow the T8 premium system (tokens/classes in premium.css; light/dark; reduced motion). Mobile first at
360×800, 390×844, 430×932, 768×1024, 1280×800 and landscape phones (e.g. 844×390, 800×360). No horizontal overflow.
Touch targets ≥ 44 px. Visible text captions for every disabled control (not `title` only — touch has no tooltips).

1. Connection banner in the shell (premium.tsx): state from the connection model with last-updated time:
   live ("Live"), polling ("Updating every few seconds"), reconnecting ("Reconnecting…"), offline ("Offline · last
   updated HH:MM — controls are paused"), pairing (pairing card inline, not only under `?companion=1`),
   host-changed ("This is a different Bunny-A Host" + Trust button + explanation). The stream indicator must never say
   "Live" unless the model says live.
2. Viewer-aware controls: when `snapshot.viewer.kind === "device"`, hide or disable workstation-only controls with a
   visible caption "Available on the Windows Host": New Agent / project.agent.create, Review bounded access (propose),
   Reduce scope (adjust), Mission settings toggles, pairing code creation, revoking other devices, thermal settings,
   provider paths, project add/edit/remove/relink, repository inspection, retarget, Talk/Redirect (keep them disabled
   with a visible caption saying Agent conversation is not supported yet — never fake it).
3. Agent detail (agentic.tsx / agent.tsx) — PHONE-01: show the Agent's pending per-request asks from
   `agent.authorization.pending` and its Mission's unresolved `requests`, each with the exact capability, concrete
   resource (`resource`), risk, reason, and the Agentic revision; buttons "Allow once" (`mission.respond allow_once`)
   and "Deny" (`deny`). If `remote.answerable === false` show "Approval required on Windows Host." (plus reason) instead
   of Allow, but keep Deny. Offer review for a pending Agentic consent (`authorization.state === "WAITING_FOR_USER"`):
   objective, capabilities, roots, commands, risk ceiling, max actions, duration/expiry, concurrency, revision;
   Approve (`agent.authorization.approve {id, revision}`) only if `remoteOffer.answerable` (or viewer is the
   workstation); otherwise "Approval required on Windows Host." Deny always (with confirmation). Pause / Resume / Stop
   use the store; Stop and Deny/Revoke need a confirmation dialog stating the real effect ("Stop prevents new work.
   Completed work and artifacts stay. Effects already made are not undone."). Show pending/uncertain states on the
   buttons. Show model/provider only from canonical records ("Unknown" otherwise).
4. Mission plan approval card: when `mission.remote?.answerable === false` and the viewer is a device, show "Approval
   required on Windows Host." instead of Approve.
5. Devices page (premium.tsx DevicesWorkspace): for a device viewer: this device name, paired at, session expires, last
   seen, role "Paired device" and a readable rights list (Read / Supervise / Answer within limits / Chat / Sign out),
   Host identity (short hostId + epoch start time), connection state, "Sign out this phone" (confirm) → store
   `signOutDevice`. For the workstation viewer: existing device list with last seen / expires and Revoke, plus the
   pairing code creation (existing).
6. Attention badge visible on the collapsed mobile header (next to the menu button): count of Agents needing attention
   plus unresolved requests. (PHONE-11)
7. Safe areas and landscape: add `viewport-fit=cover` to the viewport meta in `src/routes/__root.tsx` and
   `env(safe-area-inset-*)` padding for the top bar, mobile menu, toasts and bottom controls; make the sidebar scroll
   (`overflow-y: auto`) and compact under `@media (max-height: 500px)` so landscape phones can reach every item.
   (PHONE-14/16)
8. Task-level controls (task.tsx, phone.tsx) disabled with a caption when the store cannot act (PHONE-08).
9. ModelsWorkspace "Refresh discovery": the Host has no `refresh` action (PHONE-10). For a workstation viewer send
   `discover`; for a device viewer just refresh the snapshot (read) and label it "Refresh".
10. Reduced motion: honour `prefers-reduced-motion` and the appearance setting for any new animation (none required).

## C. Acceptance for the client work

- `npm run typecheck` clean; `npm run lint` no new errors in touched files; `npm run test:ui` all pass (78 baseline +
  new connection-model tests).
- New pure tests cover: state transitions (ready → live, no ready in 8 s → polling, hb gap → polling, read failures →
  reconnecting → offline, pairing stops retries, host-changed blocks actions until trust), `canAct`, backoff caps,
  poll intervals, command result handling helpers (if factored as pure functions: caption by code, outcome mapping).
