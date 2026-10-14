# Host authority and secret handling: map for MA3 T13.2 (Connection Registry)

Repo: C:/Users/allam/Documents/new/bun-router @ e449456 (branch claude/ma3-t9-phone-remote). Read-only investigation; nothing edited.
All paths are relative to `src/lib/bunny-host/` unless stated otherwise.

---

## 1. Request authentication and principal (http.server.ts)

`startHost()` (http.server.ts:259) builds a single loopback HTTP server (`server.listen(port,"127.0.0.1")`, :1177).

Boot order. This order matters for schema work (section 6):
1. `hostStatePaths()` (:276). For an installed layout (`BUNNY_STATE_LAYOUT=2`) it validates `PRAGMA user_version==3` plus a sha256 of `sqlite_master` against `state-layout.json` before anything else (state-paths.server.ts:47-54).
2. The workstation token comes from `credentials.json`, or a fresh `randomBytes(32)` (:279-283). It is pushed into `containment.options.secrets` and `registerDiagnosticSecret(token)` (:290-291).
3. `new HostDatabase(paths.database)` (:293), then `ensureDeviceSchema(db.db)` (:295).
4. `new TaskManager(...)` (:313). Its constructor creates `LayaRegistry`, `JevSecretStore` and `JevService` (manager.server.ts:174-176), which creates the `jev_credentials`, `settings`, `jev_usage` and `laya_benchmarks` tables.
5. `MissionManager` (:331), then `AgentRuntime` (:334), then `ProjectService` (:335).
6. **`refreshStateMarker(...)` (:355)**. It re-fingerprints the applied schema into the marker.
7. `handler` is installed. Each request goes through `containment.background({subsystem:"http"})` (:1157).

`handler` (:577):
- The Host header must be `127.0.0.1:<port>` or `localhost:<port>` (:579). Any `Origin` header or `sec-fetch-site: cross-site` is refused with 403 (:581).
- `GET /health` is unauthenticated (:584).
- Bearer parsing: only an exact `Bearer <cred>` counts (:587). `local = equal(bearer, token)` uses timingSafeEqual (:588, `equal` at :143).
- Device authentication: `authenticateDevice(db.db, hash(bearer))` (:590), with sha256 at `hash` :140. On success the code calls `registerDiagnosticSecret(bearer)` and `DEVICE_RESPONSES.add(res)` (:592). Any `json()` sent to a device response is then passed through `redactReviewListing` (:158-161).
- `POST /pair` (:593-609): a one-time code (96-bit, 10-minute expiry, created by `pairing.create` at :962), protected by `FailureLimiter` per client and globally. It inserts a `devices` row holding the token hash, and returns `{token, deviceId, hostId}`.
- If the caller is neither local nor a device, the answer is 401 with `AUTH_REQUIRED`, `DEVICE_REVOKED` or `DEVICE_EXPIRED` (:610).
- `principal: Principal = device ?? {kind:"workstation"}` and `actor = actorOf(principal)`, which is `"workstation"` or `"device:<id>"` (:612-613; device-authority.server.ts:123).
- Device load limits: `WindowLimiter`s cap commands at 60/min, reads at 300/min and stream opens at 30/min, with 429 `RATE_LIMITED` (:614-621). `presence.touch` runs here too.
- `GET /state` returns `viewFor(after, principal)` (:628).
- `GET /events` is SSE. Devices receive `detail: publicEventDetail(event.type)` only, never the raw detail (:641-644). Validity is re-checked on every delivery through `deviceStillValid` (:648).

### `/command` dispatch (:653-1080)
In order:
1. `body(req)` (4 MB cap, :148).
2. Device re-authentication after the body arrives, which guards the revocation race (:657-660).
3. `action = input.action.slice(0,100)` (:661).
4. **`if (device) assertDeviceAction(action)` (:663)**. This is the default-deny gate, applied before anything is read or dispatched.
5. `data = record(input.data ?? {})` (:664).
6. Optional `expect.hostId` / `expect.epoch` check. A mismatch is refused with `CodedRefusal` `HOST_IDENTITY_CHANGED` or `HOST_EPOCH_CHANGED` (409) (:666-672).
7. Idempotency: an `operationId` (`OPERATION_ID` regex) is ledgered only when `mutating(action)` (:674-696). `mutating(a)` is `deviceRight(a) !== "read" && a !== "session.get"` (device-authority:96). Every owner-only action is therefore "mutating".
8. The `safeActions` set (:701-720) lists actions allowed while the Host is degraded. Every other action calls `containment.assertAccepting("http")` (:721).
9. Family routing:
   - `AGENT_ACTIONS` goes to `agentCommand` (:722-731).
   - `VOICE_ACTIONS` goes to `voiceCommand`, and devices get `WorkstationRequiredError` (:732-736).
   - `MISSION_ACTIONS` goes to `missionCommand(..., {local, actor})` (:736-737).
   - The `project.` prefix goes to `projects.command(action, data, local)`. For devices, refusal text passes through `hidePaths` (:738-747).
   - Everything else falls into the `switch` (:748-1007). `default` throws "Unknown Host action." (:1006).
10. Success path:
    - An `audit.command` event is written (:1008-1014). It holds the action name only and never the data.
    - `ledger.finish` runs.
    - A device whose credential was revoked during the command gets 401 (:1019-1022).
    - Voice actions return `{data: extra.voice}` only (:1024).
    - Otherwise the response is `projected = viewFor(after, principal)`. For devices, `extra.agents`, `extra.agent` and `extra.mission` are re-taken from the projected snapshot (:1026-1031). **Every other `extra` key, for example `extra.data`, is spread raw into the device response (:1032-1039).**
11. Error path (:1040-1079):
    - Status and code mapping: `HostUnavailableError` gives 503 `HOST_UNAVAILABLE`. `WorkstationRequiredError` gives 400 `WORKSTATION_REQUIRED`. `CodedRefusal` gives its own `status`/`code`. `CommandRefusedError` gives 400 `REFUSED`. Anything else gives 400 `FAILED`.
    - Message: only `CommandRefusedError` subclasses expose their text, and only after `safeError(error,[token]).message` (:1061). A plain `Error` becomes the generic "Host command failed. Inspect operation state before retrying." It also goes through `containment.contain(error,"boundary")`, which logs a diagnostic incident (:1042-1045).
    - Device refusals are journaled as `audit.device_refused` (`device <id>: <action> (<code>)`), except for `RATE_LIMITED` (:1067-1068).

### How the `intelligence.*` actions are gated (:768-795)
These actions are not in `DEVICE_RIGHTS`, so a phone is already refused at step 4 (:663) with `WORKSTATION_REQUIRED`. Each case also carries its own guard, `if (!local) throw new WorkstationRequiredError(...)`, as defence in depth:
- `intelligence.configure`: `manager.configureIntelligence(data.policy)`.
- `intelligence.credential.save`:
  - It calls `registerDiagnosticSecret(data.apiKey.trim())` before the device check, and only when `local` and the value matches `API_KEY_SHAPE` (:773). The key is then redacted even from a later failure message.
  - It then calls `manager.saveIntelligenceKey(data.apiKey)`.
- `intelligence.credential.remove`: `manager.removeIntelligenceKey()`.
- `intelligence.test`: `decisionTest` must be a boolean. A billable test requires `confirmBillable === true`, otherwise `CommandRefusedError`.
- `intelligence.laya.configure` and `intelligence.laya.benchmark`: the benchmark is fire-and-forget (`void`).
- `submit` (:749-767):
  - A device may not set `verify` or `constraints.workingDirectory` (`WorkstationRequiredError`).
  - **Only `local` callers get `manager.assistDecision(submitted, abortSignal)`.** Devices always pass `decisionAssistance = null`, so they never spend the owner's TypeSafe budget.
  - `decisionAssistance` is never accepted from the HTTP body: `validateSubmit` (:82-102) drops unknown fields.

Older owner-only cases use a plain `Error` for the local check: `verification.record`, `policy.*`, `legacy.import`, `provider.configure_path`, `remote.configure` and `thermal.configure`. Newer cases (T13, T13.1) use `WorkstationRequiredError`. **New code should use `WorkstationRequiredError` or `CommandRefusedError`.** A plain `Error` maps to `FAILED` and an incident, and the operation is marked "failed", so the client treats the outcome as "unknown" (`src/lib/orch/host.ts:80`).

### Device revocation
`device.revoke` (:975-999) is a "self" right: a device may only target itself. It calls `endDeviceGrants(actor, "signout"|"revocation")` (:1086-1147), which synchronously ends:
- one-time answers
- staged changes
- approval batches
- Agentic consents (`agentic_authorizations`)
- Mission envelopes the device granted

**T13.2 hook:** any per-device consent stored by the Connection Registry (if devices could ever grant one; recommended: they cannot) must also be ended here.

---

## 2. Device authority (device-authority.server.ts)

- `WorkstationRequiredError extends CommandRefusedError` with `code="WORKSTATION_REQUIRED"` (:42-48).
- `DeviceRight = "read"|"supervise"|"answer"|"chat"|"self"` (:51).
- **`DEVICE_RIGHTS` (:57-82)** is the complete default-deny allowlist (24 actions):
  - read: `agent.list`, `agent.get`, `mission.get`, `project.list`, `project.get`, `project.artifact`, `operation.status`
  - supervise: `agent.pause`, `agent.resume`, `agent.stop`, `agent.authorization.deny`, `agent.authorization.revoke`, `mission.stop`, `mission.revoke_batch`, `inbox.ack`, `stop`
  - answer: `agent.authorization.approve`, `mission.approve`, `mission.start`, `mission.respond`, `approve`
  - chat: `submit`, `task.feedback`
  - self: `device.revoke`
- `deviceRight()` uses `Object.hasOwn`, so prototype keys cannot widen the list (:83-85). `assertDeviceAction()` throws `WorkstationRequiredError("<action> requires workstation access on the Windows Host.")` (:87-94).
- `viewerOf()` publishes `rights: Object.keys(DEVICE_RIGHTS).sort()` to the client (:344-357). The phone UI computes capabilities from those strings through `holdsRight()` / `phoneCapabilities()` (src/components/island/phone-model.ts:169-194). **Adding a key to `DEVICE_RIGHTS` is visible to the phone UI and changes `viewer.rights`.**
- `deviceMayLaunch()`: a device may launch only `ollama` with a non-remote tag (:29, :35-38).
- `ensureDeviceSchema()` creates `host_identity` and `device_presence` (:127-130). `hostId()` is a stable UUID (:132-135).
- `authenticateDevice()` (:142-162) enforces revocation, a 365-day absolute lifetime and a 30-day idle bound (`deviceExpiresAt` :461). `deviceStillValid()` is used for SSE (:164).
- `OperationLedger` is keyed per principal, memory-only and per epoch (:289-341). `CodedRefusal(code, msg, status)` is at :450.
- **`deviceSnapshot(snapshot, principal, presence)` (:369-416)** is the Host-side phone projection. It spreads `...snapshot`, then overrides:
  - `projects` (paths masked)
  - `devices` (own row only)
  - `tasks` (`deviceTask`; active tasks plus the newest 100)
  - `providers` (`executable:null`, `evidence:[]`, session pid and id nulled)
  - `presentation.tasks`
  - `missions` (team missions go through `deviceTeamMission`)
  - `agents` (the newest 50 finished; roots and cwd masked)
  - **`intelligence: undefined` (:414)**

  **It is default-ALLOW per field: any new `HostSnapshot` field reaches the phone unless it is explicitly overridden here.**
- `deviceTask()` masks the prompt for mission and voice turns and nulls cwd, pid, processTree and sessionId (:498-514). `hidePaths()` is at :465. `deviceArtifactRead()` is at :472. `deviceProjectDetail()` is at :436.

`viewFor(after, principal)` (http.server.ts:519-568) runs `snapshot()`, adds `hostIdentity`, `viewer`, mission and agent remote verdicts and `devices` presence. Then:
- devices get `dashboardSnapshot(deviceSnapshot(...))`, with `personalAgents.bindable=[]` (:557-566)
- the workstation gets `...withVerdicts` plus `voice` (:567)

---

## 3. Presentation and redacted projections

### presentation.ts
- `dashboardSnapshot()` (:486-606) is the public browser projection. The Host applies it for devices (http:558) and the gateway applies it for everyone (src/lib/orch/host.ts:46). It also spreads `...snapshot`; it rewrites health, event details, tasks (`publicTask` :442), missions, inbox and capabilities. **It passes `intelligence` through unchanged for the workstation**, which is how Settings receives `IntelligenceSnapshot`.
- `dashboardCommand(result, action)` (:631-650) is the gateway command filter. **`data` is forwarded only for VOICE_ACTIONS or the explicit list** `project.list|get|add|create|update|relink|remove|artifact|repository|agent.create`, `operation.status` (:642). A new `connections.*` command that returns `extra.data` will have that data silently dropped unless the action is added to this list. The alternative is to return only state through the snapshot, which is the pattern `intelligence.*` uses.
- `LABELS` (:109-181) holds public event labels, with T13.1 entries at :173-180. `publicEventLabel()` is at :182. `publicEventDetail(type)` (:237) gives devices a fixed label plus "Details omitted from public activity.". `projectEvents()` keeps only types listed in `LABELS` (:294-296). New `connection.*` / `connections.*` journal types need LABELS entries, and their `detail` strings must never contain secrets: the workstation SSE and `snapshot.events` carry raw detail.

### intelligence-snapshot.ts (whole file, 12 lines)
`IntelligenceSnapshot = { version:1; router:"BunnyRouter"; laya: LayaSnapshot; jev: JevPublicState; localDecisionPolicy; lastAssistance }`. It is produced by `TaskManager.intelligenceSnapshot()` (manager.server.ts:622-633) and inserted in `manager.snapshot()` (:521). `JevPublicState` (typesafe-jev.server.ts:189-206) exposes `hasCredential`, `credentialUpdatedAt`, `credentialProtection` (a label), state, policy, usage, `usable` and `detail`. It never exposes the key or the ciphertext.

### contracts.ts
- `HostSnapshot` (:22-58) is the snapshot contract. All extension fields are optional, and older clients ignore them.
- `SnapshotViewer` is at :19-21.
- `SubmitTask` (:60) carries the `decisionAssistance` field, documented as never accepted from HTTP.
- **There is no command list in contracts.ts.** Command names live in:
  - the http.server.ts switch
  - `AGENT_ACTIONS` (agent-runtime.server.ts:1103)
  - `MISSION_ACTIONS` (bunny-missions/commands.server.ts:16)
  - `VOICE_ACTIONS` / `VOICE_SAFE_ACTIONS` (voice/voice-protocol.ts:332/:346)
  - the `project.` prefix
  - `DEVICE_RIGHTS`

### Gateway and phone side
- `src/lib/orch/host-bridge.server.ts`: `authorizeBridge()` (:31-57) decides between workstation and device.
  - Workstation access requires a loopback TCP peer and loopback host, with no relay or proxy headers (`RELAY_PREFIX`, `PROXY_HEADERS`, and any unknown `x-*` header outside `LOCAL_X_HEADER`), and no `bunny_device` cookie.
  - Remote access requires `BUNNY_REMOTE_ORIGIN` over https and a loopback peer (the tunnel); the device token comes from the `bunny_device` cookie.
- `hostCall()` (:96-113) injects the workstation token from the credentials file, or the device cookie token.
- `src/routes/api/bunny-pair.ts` handles pairing (POST, which sets an HttpOnly/Secure/SameSite=Strict cookie) and sign-out (DELETE, which sends `device.revoke`).
- `src/lib/orch/host.ts`: `readBunnyHost` and `commandBunnyHost` server functions apply `dashboardSnapshot` and `dashboardCommand`.
- UI:
  - `src/components/island/ai-models.tsx:107-118` shows "Model connections and API keys are managed on the workstation" when `viewer.kind==="device"` (where intelligence is absent).
  - Store commands: `src/store/use-island.ts:1120-1130` (`command("intelligence.configure", …)`).

---

## 4. Secret storage (jev-secrets.server.ts)

- `SecretProtector` interface: `{ kind:"dpapi"|"test"; protect(plain)→Buffer; unprotect(Buffer)→string }` (:15-19).
- `DPAPI_SCRIPT` (:21-33) runs Windows PowerShell `ProtectedData.Protect/Unprotect`, CurrentUser scope.
  - **The entropy is hard-coded: `'Bunny-A/TypeSafe-Jev/credential/v1'` (:24).**
  - The secret travels base64-encoded on **stdin** (`[Console]::In.ReadToEnd()`); the mode travels in env `BUNNY_DPAPI_MODE`.
- `DpapiProtector.run()` (:38-52) calls `execFile(systemTool("powershell.exe"), ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-Command",DPAPI_SCRIPT], {windowsHide, timeout:20s, maxBuffer:64KB, env:{...process.env, BUNNY_DPAPI_MODE}})` and writes `child.stdin.end(input)`.
  - It fails closed on non-win32.
  - The error text is generic ("Windows secret protection failed."), so no stderr is echoed.
  - `systemTool` comes from system-tools.server.ts (absolute System32 path).
- `TestProtector` (:62-70) is a reversible fake for tests only. It is injected through `startHost({intelligence:{jevProtector}})` and `ManagerOptions.intelligence` (manager.server.ts:69-70).
- `API_KEY_SHAPE = /^[\x21-\x7e]{8,512}$/` (:72).
- `JevSecretStore` (:74-120):
  - The constructor creates `jev_credentials(id INTEGER PRIMARY KEY CHECK(id=1), ciphertext BLOB NOT NULL, protector TEXT NOT NULL, updated_at INTEGER NOT NULL)`. The table is a singleton.
  - `hasCredential()` and `updatedAt()` reveal existence only.
  - `save(apiKey)`:
    1. trim and check the shape
    2. `registerDiagnosticSecret(key)`
    3. protect
    4. refuse if the ciphertext contains the plaintext bytes
    5. upsert with `protector=kind`
  - `retrieve()` (Host-internal):
    - It fails if the stored `protector` differs from the current kind.
    - It turns a decrypt failure into "could not be decrypted on this Windows account; replace it".
    - It calls `registerDiagnosticSecret(key)` on every read.
  - `remove()` deletes the row.
- Consumer: `TypeSafeJevClient` gets `apiKey: () => secrets.retrieve()` (typesafe-jev.server.ts:245). The key is used only in an `authorization: Bearer` header on an approved-origin fetch.
  - `assertApprovedEndpoint` (:76) pins https to the TypeSafe API host.
  - Redirects are refused (`redirect:"manual"`, :116/:126).
  - The client refuses to send when `NODE_TLS_REJECT_UNAUTHORIZED==="0"` (:98).

## 5. Redaction (failure.server.ts)

- `registerDiagnosticSecret(secret)` (:56-61) keeps a process-global, bounded `Set` (512 entries, 4..8192 chars). It is for real credentials only, never request payloads. Callers: the Host token, device bearers, pairing tokens, the Jev key on save, retrieve and HTTP pre-validation.
- `safeError(value, secrets[])` (:70-144):
  - It hides registered secrets, the extra `secrets`, and the value of **every env var whose name matches `SECRET_KEY = /token|secret|password|passwd|api.?key|cookie|authorization|credential/i`** (:51, :73-74). That covers `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` values.
  - Regex scrubs: `Bearer …`; authorization, cookie and set-cookie headers; `key=value` pairs whose key looks like a secret; `sk-…`, `gh?_…` and `github_pat_…` tokens; URL userinfo.
  - Control characters are stripped. Lengths are bounded (message 1024, stack 4096, 8000 in total).
- `CommandRefusedError` (:172) is the only error class whose message reaches HTTP clients, always through `safeError(error,[token])`. `HostUnavailableError` is at :165.
- `HostContainment` writes diagnostics with `safeError(error, this.options.secrets)` (:287, :419).

---

## 6. Persistence and schema migration pattern (persistence.server.ts and state-paths.server.ts)

- `HostDatabase` (:16-117) uses `node:sqlite` `DatabaseSync` with WAL and busy_timeout. The constructor creates the core tables `tasks`, `projects`, `events`, `outcomes`, `devices` and `migrations`, and sets **`PRAGMA user_version=3`** (:21-29).
- Additive column migration: `PRAGMA table_info` followed by `ALTER TABLE … ADD COLUMN` for missing `OUTCOME_COLUMNS` (:9-13, :31-32) and `events.mission_id` (:34-36).
- `transaction()` uses BEGIN IMMEDIATE and rolls back safely, with `onFailure` leading to containment degrade or fatal (:44-51).
- `event()` trims the journal to the newest 20,000 rows every 500 inserts (:52-57). That is the existing retention precedent.
- **Every other table is created by its owner's constructor with `CREATE TABLE IF NOT EXISTS`** and never touches user_version (comment at routing-store.server.ts:1-9 and :34-35). Owners:
  - routing_decisions, routing_attempts, model_routing_profiles
  - providers (registry.server.ts:53)
  - model_capabilities (:137)
  - settings / laya_benchmarks (laya.server.ts:105-108, including a `digest` ADD COLUMN)
  - settings / jev_usage (typesafe-jev.server.ts:235-237)
  - jev_credentials
  - policies / settings (learning.server.ts:28)
  - mission tables (bunny-missions/store.server.ts:37-70), agentic tables, device_staging
  - agent tables (agent-store.server.ts:18-21)
  - host_identity / device_presence
- **Why this does not break production:**
  - An installed Host refuses to boot unless the database's `user_version` (must be 3) and the sha256 of `SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name` equal the marker (state-paths.server.ts:47-53).
  - After all constructors have applied their additive DDL, `refreshStateMarker()` (state-paths.server.ts:73-95, called at http.server.ts:355) re-hashes the schema and rewrites `databaseSchemaSha256` and `databaseUserVersion` in `state-layout.json`. It refuses if user_version ≠ 3 or quick_check fails.
  - **Rules:**
    1. Never bump user_version.
    2. Use only additive DDL (CREATE IF NOT EXISTS, ADD COLUMN, CREATE INDEX IF NOT EXISTS).
    3. All DDL must run in a constructor reached before http.server.ts:355, meaning HostDatabase, ensureDeviceSchema, TaskManager, MissionManager, AgentRuntime or ProjectService construction. It must never run lazily on a request path.

    A table created after the marker refresh would make the next installed boot fail with "unexpected schema".
  - Data rows (settings, usage) do not affect the fingerprint; only DDL text in sqlite_master does.
- `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)` is created idempotently by several owners. Keys currently in use:
  - `active_policy`, `thermal_policy`, `provider_paths`
  - `personal_agent_slots` (`PERSONAL_AGENTS_SETTING`, personal-agents.ts:21)
  - `missions_config`, `agent_workspace_owner`
  - `laya_enabled_v1`, `laya_memory_v1`
  - `jev_policy_v1`, `jev_last_test_v1`, `jev_guard_v1`

  The idiom is `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value` with versioned key names and JSON values parsed defensively (a corrupt row reads as the default). **Settings never hold secrets.**

### `jev_usage` retention (the T13.1 gap)
- The table is `jev_usage(id AUTOINCREMENT, at, session_id, kind, answered_by, input_tokens, output_tokens, latency_ms, outcome)` with index `jev_usage_at` (typesafe-jev.server.ts:236-237).
- On boot, `pending` rows become `unknown_restart` (:239).
- `reserve()` inserts a pending row before sending (:375-380). `settle()` and `settleFailure()` update it, or delete it if nothing was sent (:381-398). `recordDiscovery()` inserts `kind='discovery'` rows (:399-403).
- **There is no pruning anywhere.**
- Budget reads (`usage()` :326-343):
  - the current-session count (`session_id = instanceId`, no time bound)
  - rows with `at >= local day start` and `kind IN ('decision','decision_test')`
  - the last billable row

  Therefore a retention policy must never delete:
  - rows of the current `sessionId`
  - rows at or after today's local midnight
  - pending or unknown rows that are still within the budget window, since they fail strict ceilings closed

  It should also keep the newest billable row so `lastRequestAt` survives. The safe shape is a `DELETE FROM jev_usage WHERE at < ? AND session_id <> ?` (cutoff = min(now − N days, dayStart)), run in the JevService constructor after the `unknown_restart` update, plus a periodic or row-count trigger like `HostDatabase.event()`. This needs no new DDL, so the schema hash is unchanged.

---

## 7. How to add each new element

### A. A new owner-only command family (for example `connections.*`)
1. **Do not add the actions to `DEVICE_RIGHTS`.** Default-deny at http.server.ts:663 then refuses a phone with `WORKSTATION_REQUIRED` before any read.
2. Add either a family branch next to the agent, voice and mission branches (around :722-747), for example `else if (action.startsWith("connections.")) { if (!local) throw new WorkstationRequiredError("…on the workstation (Windows Host)."); extra = await connectionCommand(registry, action, data, actor); }`, or `case` entries in the switch, each with its own `if (!local) throw new WorkstationRequiredError(…)` (the T13.1 style, :768-795).
3. Validation failures must be `CommandRefusedError`, or they become `FAILED` plus an incident.
4. For a secret-bearing field, call `registerDiagnosticSecret(value)` before any validation can fail (the :773 pattern), local-only and shape-checked.
5. Revoking consent or disconnecting should probably join `safeActions` (:701), so it works while the Host is degraded, like `agent.authorization.revoke`.
6. Journal with `manager.emit(db.event("connections.<verb>", null, "<secret-free detail>"))` and add `LABELS` entries in presentation.ts (:173 block).
7. If the command returns data rather than snapshot state, add the action to the `dashboardCommand` data allowlist (presentation.ts:642), or the gateway drops it. Prefer returning state through the snapshot, as `intelligence.*` does.
8. UI: add a store helper next to use-island.ts:1120-1130 (`command("connections.x", data, "<section>", onRefused)`).
9. **Consent at final dispatch.** The two launch points are:
   - `adapter.launch(adapterTask, adapterHooks)` at manager.server.ts:1745 (first launch)
   - `targetAdapter.launch(...)` at :1723, inside the retry/reroute closure where `rerouting` is computed (:1666)

   Mission tasks already pass `missionScopeCheck` and `missionAttemptAdmission` there (:1668-1685; hooks declared at :130-136). A Connection consent check (provider, account, project) must run at both points for all tasks (direct and Mission), before `this.update(...)`. It must refuse by returning null, emitting a journal event, as the Mission check does at :1676-1684.

   It must also run in the launch-revalidation reroute at :1449-1470 (`rerouteFromDecision`). That closes T13.1 limitation 7, where advice applied in `submit` (`applyDecisionAdvice` at :1088) could move Claude to Codex.

### B. A new phone-visible redacted projection field
1. Add an optional field to `HostSnapshot` (contracts.ts:22-58), for example `connections?: ConnectionsSnapshot`, with a `/** absent for … */` doc line.
2. Populate it in `TaskManager.snapshot()` (manager.server.ts:501-522) or in http.server.ts `snapshot()` (:358-408).
3. **In `deviceSnapshot()` (device-authority.server.ts:369-416), explicitly override it**, for example `connections: snapshot.connections ? deviceConnections(snapshot.connections) : undefined`. A device projection should hold provider id, display name, mode label, connected/state enum and a coarse usage band. It should never hold handles, account emails, paths, policy internals or error text. Without this override the full field reaches the phone, because the spread is default-allow.
4. `dashboardSnapshot()` also spreads, so the workstation gets the full (secret-free) field. Handle-free must hold at the source.
5. Never include credential handles or ids in `AgentSnapshot` or any task or agent field. Adapters receive a frozen `structuredClone(task)` (manager.server.ts:1718-1722, :1740-1744).
6. Phone UI: gate on the field's presence or on `viewer.kind`, not on `viewer.rights`, unless a new read right is added.

### C. A new DPAPI-protected secret kind
1. Parameterize the entropy. Keep `'Bunny-A/TypeSafe-Jev/credential/v1'` bit-for-bit for existing Jev ciphertext. Add a per-kind entropy string (for example `Bunny-A/Connections/<kind>/v1`) passed to PowerShell the way the mode is, through an env var such as `BUNNY_DPAPI_ENTROPY`. Entropy is not secret. Alternatively, build per-kind script constants. The plaintext must stay on stdin and never go in argv or env.
2. Generalize `JevSecretStore` into a keyed store, or add a sibling class with a new table (see D). Keep the invariants:
   - shape check
   - `registerDiagnosticSecret` on save and on retrieve
   - refuse if the ciphertext contains the plaintext
   - record the `protector` kind and refuse on mismatch
   - map decrypt failures to "replace it"
   - expose only `hasCredential` and `updatedAt`
   - retrieval only Host-internal
3. Inject the protector through `ManagerOptions.intelligence` (or a new `connections` seam) so tests use `TestProtector`.
4. Keep outbound use origin-pinned, refuse redirects and refuse TLS-disabled processes (typesafe-jev.server.ts:76-138).

### D. A new table
- Use `CREATE TABLE IF NOT EXISTS` (plus `CREATE INDEX IF NOT EXISTS`, and `ADD COLUMN` after a `PRAGMA table_info` check) inside the owning class's constructor.
- That constructor must be instantiated inside `TaskManager`'s constructor (where JevSecretStore is, manager.server.ts:174-176) or otherwise before http.server.ts:355.
- Do not touch `user_version`. Do not alter or drop existing tables.
- Suggested tables:
  - `connection_accounts(id TEXT PRIMARY KEY, provider TEXT NOT NULL, mode TEXT NOT NULL, record TEXT NOT NULL, updated_at INTEGER NOT NULL)`
  - `connection_credentials(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, kind TEXT NOT NULL, ciphertext BLOB NOT NULL, protector TEXT NOT NULL, updated_at INTEGER NOT NULL)`
  - `connection_consents(id TEXT PRIMARY KEY, provider TEXT NOT NULL, account_id TEXT, project_id TEXT, scope TEXT NOT NULL, granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL, revoked_at INTEGER)`

  Store consent `granted_by` as an actor string so `endDeviceGrants` can find device rows. Put non-secret config in `settings` with versioned keys (for example `connections_policy_v1`).

---

## 8. Ambient API key risk (relevant to "must not silently switch to paid API")

Provider CLI children inherit the full Host environment: `const env = { ...process.env }; delete env.CLAUDECODE;` in adapters.server.ts:227 (spawnChild path) and :351 (OwnedProcessGroup path). An ambient `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` for codex) therefore reaches the CLI, which may bill the API instead of the subscription. The env build at those two lines is the place to strip or allow provider API-key variables according to the Connection's mode (subscription CLI means strip; API-key mode means inject from DPAPI). `owned-process-group.server.ts:238` defaults to `process.env` when no env is passed. `safeError` already redacts such values in diagnostics.

---

## 9. How existing tests assert phone denial at the handler level

### intelligence-host.test.ts (ports 43830-43839 reserved, :14)
- `boot(port)` (:45-77) runs the real `startHost({dataDirectory: mkdtemp, root, port, adapters:[neverLaunches()], intelligence:{jevFetch: fake, jevProtector: new TestProtector()}})`. Helpers:
  - `command(action, data, token=host.token)` POSTs `/command` with a Bearer token.
  - `state(token)` does GET `/state`.
  - `pair()` sends `pairing.create` as the owner, then POSTs `/pair {code,name}` and returns the device token.
  - `calls[]` records fake TypeSafe URLs.
- K05/K06 (:79-108):
  1. The owner saves the key.
  2. The phone's `/state` has `intelligence === undefined` and its text does not contain the key.
  3. Every `intelligence.*` action (save, remove, test, configure, laya.configure, laya.benchmark) sent with the phone token gives `body.code === "WORKSTATION_REQUIRED"`, without the key in the text.
  4. The owner state is unchanged.
  5. `calls.length === 0`.
- K04/K20 (:110-133): the owner snapshot holds state but never the key; an invalid key or unconfirmed billable test is refused; reads make no TypeSafe call.
- R07/R16 (:135): a forged `decisionAssistance` in the submit body is ignored.
- RV-S2 (:148-164): a phone `submit` makes zero TypeSafe calls and spends nothing.

### remote-device.test.ts (uses `freePort()`, :25)
`fixture()` (:52-97) runs the real `startHost` with fake claude and ollama adapters (recording `launched`). It returns `api(action,data,token,extra,headers)`, `raw`, `state`, `pair(name)` (giving `{token, deviceId, hostId}`) and `stream(token)`.
- F01/F02/F05/F11 (:116-164):
  - The viewer projection has `kind: "device"`, the device's own row only, and no tokens or token hash.
  - Forged identity headers still give `WORKSTATION_REQUIRED` with status 400.
  - Self sign-out works; revoking another device is refused.
  - A revoked token gets 401 `DEVICE_REVOKED`.
- F26-F29 (:243-295):
  - A phone can only queue a claude task; approving it gives `WORKSTATION_REQUIRED` and nothing launches.
  - An ollama approval launches.
  - A loop over ~20 forbidden actions asserts `status===400`, `code==="WORKSTATION_REQUIRED"` and `error` matching `/workstation/`. The actions include capability.run, terminal, session.input, retarget, discover, agent.create, mission.create, project.add, provider.configure_path, remote.configure, pairing.create and unknown.action.
  - It asserts an `audit.device_refused` event exists.
- Device projection test (:492-520): a sentinel private transcript is absent from the device `/state`, from command responses and from the SSE replay. It also checks task cwd, pid and processTree, and provider executable and evidence.
- Other tests:
  - :196 epoch and operation-id replay of refused actions
  - :297 rate limits
  - :584 revocation race (delayed body)
- The unit-level pin is agent-team-matrix.test.ts:163: `assert.equal(DEVICE_RIGHTS[action], undefined)` for team actions.

### Template for T13.2
Copy `boot()` from intelligence-host.test.ts (reserve a new port block, or use `freePort`).
1. Have the owner create a connection and save a secret.
2. Pair a phone.
3. Assert the phone `/state` has only the redacted `connections` field, with no handle, account, key or path (use string `includes` checks on the raw text).
4. Loop over every `connections.*` action sent with the phone token and assert `WORKSTATION_REQUIRED`.
5. Assert the owner state is unchanged.
6. Add a unit assertion that `DEVICE_RIGHTS["connections.*"]` is undefined.

Also add a dispatch-level test: a task whose consent is revoked (or whose advice moves it to a provider without consent) must not reach `adapter.launch`, through the `launched[]` recorder, on both the first launch and the retry/reroute.
