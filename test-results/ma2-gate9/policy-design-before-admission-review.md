# Bunny-A T9 — Approval Batch Design (policy-design.md)

Scope: M-A-2 GATE T9 — Bounded Desktop Approval Batching. One new mechanism, added to the
existing permission system; no second engine, no new audit store. Everything below is additive to
the model recorded in `current-approval-model.md` and follows its exact vocabulary.

## 1. Concept

An **approval batch** is an ephemeral, mission-scoped, tightly bounded authorization that a user
may grant from a permission request when Bunny's plan contains a small, predictable, low-risk
sequence of desktop (Computer Runtime) actions. It exists ONLY to reduce repeated identical
approvals inside ONE bounded computer workflow. It never broadens any other authority, never
outlives the mission envelope, and always fails closed.

The user's choices remain exactly three, conservative-default-first:
**[Allow once] (default/primary) · [Allow this small batch] (secondary, only when Bunny can state
the exact bound) · [Deny]**. No allow-all. No preference. No persistence across restarts.

## 2. Structure (ACTUAL minimal fields — nothing speculative)

```ts
type ApprovalBatch = {
  id: string;
  missionId: string;
  authorizationId: string;   // the mission envelope it hangs from (must still be alive)
  family: string;            // capability family, e.g. "computer"
  actions: string[];         // exact action ids (NO wildcards)
  riskCeiling: RiskClass;    // "EXECUTE" for desktop batches
  target: { app: string | null; processId: number | null; title: string | null };
  targetTier: "process" | "app";  // highest identity verified at grant time
  maxActions: number;        // mutating-execution budget
  usedCount: number;         // canonical count of admitted mutating executions
  observedPid: number | null;// pinned from the first covered execution's structured output
  observedPidFrom: string | null;   // "params" | "post-run"
  epoch: string;             // Host boot epoch (batches never survive a Host restart)
  createdAt: number;         // Host clock (the only clock)
  expiresAt: number;         // createdAt + ttlMs
  status: "active" | "ended";
  endReason: null | "exhausted" | "expired" | "revoked" | "scope_mismatch"
           | "mission_ended" | "host_restart";
  endAt: number | null; endBy: string | null;
  originStepId: string;      // the mission step whose request created it
  createdBy: string;         // actor string: "workstation" | "device:<id>"
};
```

New permission-request side data (stored on the request, computed by Host, not by clients):

```ts
type PermissionBatchOffer = {
  action: string;            // the request being offered on
  actions: string[];         // exact covered ids
  counts: Record<string, number>;  // expected executions per action (truthful sum = maxActions)
  targetLabel: string;       // e.g. "Calculator" (display only — never raw selectors)
  maxActions: number;
  ttlMs: number;
  riskCeiling: "EXECUTE";
};
```

`PermissionRequest.resolution` gains `"allow_batch"`. `MissionStep.approvedOnce` still records the
single invocation (batch consumption is tracked by the batch, not by the step).

## 3. Eligibility policy (structured, not a string list)

A request is batch-OFFERABLE and batch-COVERABLE iff ALL hold:

1. **Family:** action's capability family is `computer` (desktop UI Automation). Browser, shell,
   git, filesystem, connector actions are structurally outside (their families differ) — so the
   shell/browser exclusions (§29, §30) are structural, not enumerated.
2. **Manifest flags:** `implemented`, and NOT `sensitive`, NOT `hardApproval`. This excludes
   `computer.read_controls` and `computer.capture` today (sensitive reads always keep their own
   approval).
3. **Risk ceiling:** the ESCALATION-AWARE risk of the exact request (`riskOf(action, params)`,
   manifest risk with any parameter-driven escalation) is `READ` or `EXECUTE` — ceiling EXECUTE.
   A future parameter escalation above EXECUTE makes that specific request uncoverable.
4. **Envelope alive:** the mission envelope exists, is not revoked, not expired, and would NORMALLY
   cover the action+family+risk for this mission (the ask was an ordinary "ask", never a deny).
   The batch is a narrowing of repeated asks, never a repair for a denied action.
5. **Sensitive-target refusal (conservative).** `computer.type`/`computer.invoke_control`
   requests whose target control identity (automationId / name / className / controlType
   metadata — never the value being typed) matches the sensitive-field heuristic
   (password | passwd | pwd | secret | token | credential | pin | card | credit | cvv | ssn | api[_-]?key)
   are NOT coverable — they fall back to an ordinary explicit approval. Heuristic lives in one
   documented function; false NEGATIVES are possible, so values are still treated as secrets
   everywhere they are stored (existing `[N characters]` redaction — §47).
6. **Countable sequence:** an offer exists only when the mission's plan (or the skill definition
   of a skill step) yields ≥ 2 total covered mutating executions where the granting request is
   ONE of them. The asking step's own execution is covered by the ask itself — it is never
   double-counted (capability asks are excluded from the plan read; a skill ask splices its
   matching entry out). A single-action plan gets no offer — the single-action approval path
   remains EXACTLY as today (§50), including "Allow this skill run".

Never batch-eligible, per policy category (all structurally excluded by rules 1–3):
destructive, filesystem-delete, git-destructive, credentials/secrets, security-settings,
install/uninstall, elevation, payment, external comms, publish, account ops, permission changes,
device pairing, sensitive clipboard, private file upload.

**Standing-user-rule suppression (additive to rule 4):** when the user has a standing
`ask_every_time` grant covering the exact action, the action asks every time BY THE USER'S OWN
RULE — no batch offer is ever computed for it, no batch consult rescues it, and a
`respond {decision:"allow_batch"}` on such a request is rejected. Batching never overrides a
standing user rule in either direction.

## 4. Target binding (§10–§12 hierarchy, honestly bounded)

Binding tier chosen at grant time from the granting request's params:

- **`process`** — the granting request targets an explicit `window.processId` (or the batch's
  first covered execution observed and pinned one). Matching: request window `processId` must
  equal the bound/pinned pid.
- **`app`** — granting request was `computer.open_app {app}` (window not yet existing) or a
  title-filtered window request. Matching pre-pin: `open_app` app key equal, or a title-filtered
  request whose window title contains the pinned app marker. Post-run, the structured output's
  observed `processId` is pinned (`observedPid`), upgrading matching to `process` tier.

Title-filtered requests are admitted while a pid is pinned only as a *hypothesis* verified
post-execution: each covered run's structured output pid is compared to the pin; a mismatch
**immediately ends the batch** (`scope_mismatch`) so nothing further can run. This is the honest
bounded contract (T72): we do NOT claim pre-execution window isolation for title-filtered flows;
we verify at the earliest point Windows observation allows and terminate on any drift. When the
plan carries explicit pids, matching is strict before execution (no drift window at all).

Selection hierarchy remains the manifest's (AutomationId > control type/name > hierarchy >
coordinates-last-resort; no coordinate params exist). T73 preserved.

**`open_app` never pins (launcher-pid rule):** open_app's structured output pid is the LAUNCHER
process (on Windows Store apps a separate, short-lived process from the window owner), so
post-run review explicitly skips it — the first window-bearing execution (focus/type/invoke/
read_controls) is what pins the owner pid. Batches bound before any window exists stay on the
looser tier until a window-bearing run supplies a real owner.

## 5. Consumption = admission (the single canonical count; §21–§23, §69, §70)

- A mutating covered action (`focus_window`, `invoke_control`, `type`, `open_app` — i.e. any
  EXECUTE-family covered action; READ-only covered actions never consume) consumes **exactly one
  count at admission**, in the SAME SQLite transaction that saves the capability run base and
  `capability.started`.
- The admission consume is a single guarded SQL statement (the store reads the row, then a
  compare-and-set UPDATE that re-checks `used_count`):
  `UPDATE approval_batches SET used_count = used_count + 1, record = ? WHERE id = ? AND
   status='active' AND batch_epoch = ? AND expires_at > ? AND used_count = ?` — `changes = 0`
  (a racing admission took the slot, or any guard moved) ⇒ the action is NOT executed; the
  outcome is `denied` with an honest reason ("expired", "reached its limit", "unavailable") and
  NO run is created. The `record` JSON is rewritten with the same increment in the same
  statement, so every read path (`batch`/`batches`/`view`/events) sees the same canonical count
  — the column and the JSON record can never diverge. This one statement is the TOCTOU
  re-validation (§69): status, expiry, budget and epoch are re-checked atomically immediately
  before execution.
- Counts are consumed by ADMISSION, not success: a failed/timed-out attempt still consumed its
  slot (the machine was instructed; retry semantics below are bounded by the same budget). Reads
  never consume. UI rendering, status reads, card refreshes never consume.
- On reaching `maxActions`, the batch flips to `ended/exhausted` and emits `approval.batch_exhausted`.
- **Retries (§23):** a failed capability step retried by the mission's normal retry policy
  issues a NEW request when no batch covers it (today's behavior); when a batch is still active it
  consumes another count (bounded). A retried attempt can never bypass the budget; off-by-one is
  impossible because admission is guarded (the max+1-th attempt finds `used_count = max` and is
  denied).
- **Failure never expands scope (§24):** a failure can only consume or end a batch. No code path
  raises `maxActions`, extends the TTL, widens `actions`, or mutates the target.

## 6. Expiry (§13) and risk ceiling (§14)

- `expiresAt` is stamped by the **Host clock** at grant. Default TTL **2 minutes**
  (chosen against the staged live Calculator matrix and the skill-run pacing; the longest staged
  covered flow completed well inside 2 minutes). The granting client may SHORTEN only
  (`ttlMs` clamped to [1000, 120000]; never lengthened). Lazy expiry flip + `approval.batch_expired`
  happen on any admission-time consult that finds expiry; the SQL guard independently refuses
  expired batches even if the flip has not yet run (no double-ask).
- Risk ceiling EXECUTE (§14): a request whose escalation-aware risk exceeds EXECUTE is not covered
  (falls back to its normal approval path) even if the app/timeline still match.

## 7. Grant flow

1. A capability request inside a mission gets `decide()` → `"ask"` → MissionManager creates the
   PermissionRequest. At creation, when the request is batch-offerable per §3, the manager
   computes the `batchOffer` from the mission's plan/skill definition and stores it on the request.
2. UI shows the offer block — exact actions in Bunny's action-label language (e.g. "Open
   Calculator", "Press a Calculator button ×6"), with "at most N actions · for 2 minutes ·
   Calculator only · ordinary risk". No capability JSON, no selectors, no stack traces (§19).
3. `mission.respond {decision:"allow_batch"}` (workstation or trusted device — same actor rules as
   today; §41). The Host revalidates (request open, mission live, offer present, envelope alive)
   and creates the batch FROM THE STORED OFFER — client data can only SHRINK (`maxActions`,
   `ttlMs` clamped down). Model steps and providers cannot send commands; no natural-language
   claim touches this (§16, §17).
4. The batch becomes consultable by future `decide()` asks for this mission only.

## 8. Consult during decisions

- In the capability bus's decision path, when `decide()` returns `"ask"`, the bus consults the
  mission's ACTIVE batches (same missionId, same envelope, epoch = current Host boot, not expired):
  the consult applies eligibility §3 (family/flags/escalated risk), target binding §4, and
  sensitive-target refusal. A match converts the decision to allow-by-batch (reason states the
  batch bound and remaining count) — consult NEVER converts a deny, and NEVER applies to
  non-mission requests.
- **Step binding (§36):** a request matches a batch only when it comes from the mission itself —
  its `stepId` is one of the mission's planned steps (this covers explicit capability steps and
  skill runs launched by that step). Provider-internal or delegated child-task steps have
  different step ids and are NOT covered: a sibling child Task (B) does not inherit Task A's
  batch; another Mission never consults another Mission's batch (§37, §71: two concurrent Tasks
  — including two missions using the same app, same action, same user — cannot share a batch,
  because consultation is scoped per missionId and per mission step set).
- **Provider reroute (§38):** rerouting changes only which provider runs model steps; batch
  consult depends on mission/envelope identity and is unaffected — routing never broadens
  capability.

## 9. Revocation, stop, mission end, restart (§39, §43–§45)

- Mission `stop()`: batches → `ended/mission_ended` (message says revoked-by-stop), in-flight
  covered runs aborted by the existing cancel machinery; future asks re-ask fresh. Unrelated
  missions unaffected.
- `replan()`: same termination.
- **Host restart (§39, strong default):** `recover()` ends active/paused... (status set above)
  active batches with `host_restart`; additionally every batch carries the Host `epoch`; a batch
  stamped with a previous epoch can never match (belt and braces even if `recover()` were
  interrupted). No pending GUI mutation is replayed blind (T3 semantics unchanged: interrupted
  runs stay interrupted; retry requires a fresh approval).
- **UI disconnect (§40):** nothing new is approved by a reconnect; the snapshot is the canonical
  truth (offer persisted on the request; usedCount canonical); `mission.respond` revalidates
  request/mission state on arrival — an approval arriving after stop/termination is refused.
- **Remote/phone approval (§41):** `mission.respond decision:"allow_batch"` from a trusted device
  actor uses the same revalidation and cannot lengthen TTL or budget; revoked devices are rejected
  by the existing device auth before dispatch (T6 unchanged; device identity recorded in the
  batch's `createdBy`, used as supporting context, not as the boundary; §42).

## 10. Journal events (§46) — existing emit authority only

`approval.batch_started` (offer bound summary: actions count, target label, ttl, max)
· `approval.batch_consumed` ("3 / 8 used", action label, no values)
· `approval.batch_exhausted` · `approval.batch_expired`
· `approval.batch_ended` (reason) · `approval.batch_scope_mismatch` (observed pid bound — a pid,
  not a credential)
All through `TaskManager.emit` into the existing events table. Event strings never contain typed
values, secrets, control values, or private reasoning (§47); parameter values in journals/runs keep
the existing redaction ("[N characters]").

## 11. UI truth (§18–§21) in Bunny's existing visual language

- Request card: offer block + buttons in conservative order: **Allow once** (primary, unchanged),
  **Allow this small batch** (secondary; only when offer exists), **Deny** (quiet). Offer lines
  name the actions in Bunny's labels (e.g. "Open Calculator", "Enter text in Calculator (×3)",
  "Press a Calculator button (×6)"), plus the bound sentence ("At most 8 actions · Calculator
  only · for 2 minutes · ordinary risk").
- Mission panel gains a truthful batch block when a batch exists: `3 / 8 actions used ·
  Calculator · ends in 1:42` (countdown from the Host-supplied timestamp) and a **Revoke batch**
  button. Counts come only from canonical `usedCount/maxActions` — never from elapsed-time
  percentages (§21).
- Batch ending states render with their truthful reason (exhausted / expired / revoked /
  scope mismatch / mission ended / host restart).

## 12. What T9 deliberately does NOT do

No persistent grants (`capability_grants` untouched). No global preference ("always for this app"
is future work per §52). No broader OD-1 revocation architecture (§43). No changes to envelope
granting itself, TaskManager approvals, direct invocation, T1–T8 preserved surfaces, or the
verification flow. No release activation without the §64 procedure.

### 12a. Installed-state marker reconciliation (found while preparing the staged runtime)

The `approval_batches` table makes the SECOND boot after any T9-class activation fail:
`hostStatePaths()` validates the database against `state-layout.json`'s
`databaseSchemaSha256`, which describes the schema at migration time — before the Host's own
additive `CREATE TABLE IF NOT EXISTS`. A healthy migrated database would be refused
("unexpected schema") and a restarted T9 Host could never boot. Fix (additive):
`refreshStateMarker` runs in `startHost` after the mission layer applies its schema and
reconciles exactly two marker fields (`databaseSchemaSha256`, `databaseUserVersion`) to the
applied schema — `quick_check` must pass or nothing is rewritten; damaged databases stay
refused; non-installed (development) state is untouched. Proven in
`src/lib/bunny-host/state-marker.test.ts`, which first reproduces the refusal with a stale
marker, then heals and re-validates.

## 13. Defaults chosen (§5, §12) and why

- `maxActions`: derived from the plan, `min(2 × mutating, 12)` — the offer states the expected
  executions truthfully and pads to ~2× for bounded retry/interaction headroom, hard-capped at
  12 so no batch is ever more than a dozen admitted actions; client may shrink only.
- TTL: 2 minutes default, client may shorten only — the staged flow finishes in well under 2
  minutes; a stale paused mission cannot silently revive authority hours later.
- Conservative default button remains "Allow once".