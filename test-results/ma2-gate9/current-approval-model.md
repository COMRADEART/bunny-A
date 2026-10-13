# Bunny-A — Current Approval Model (before T9)

Gate: M-A-2 T9 (Bounded Desktop Approval Batching) · Recorded: 2026-10-06 ·
Method: full reads of the current source at commit `abe993a` (branch `ma2-operational-hardening`),
plus a read-only inspection of the live production database
(`%LOCALAPPDATA%\Bunny-A\state\host.sqlite`) and install config. No code was changed before
this document was written; no prior T9 analysis was copied in.

This document states what the existing authorization vocabulary ACTUALLY means in Bunny-A today.
Where the T9 brief's vocabulary differs from Bunny's actual vocabulary, the mapping is stated
explicitly (§ "Vocabulary mapping" below).

---

## 1. Where authority lives (all of it Host-owned)

Every permission decision is made inside the Host process. The renderer (dashboard/island UI)
never holds authority: it sends commands (`mission.approve`, `mission.respond`, `mission.stop`,
`mission.revoke_batch` after T9, …) over the loopback HTTP API with the Host token, and the Host
decides. There is no renderer-local `approved` flag honored by any server code path.

| Subsystem | File | Role in approvals |
|---|---|---|
| MissionManager | `src/lib/bunny-missions/manager.server.ts` | Creates permission requests, persists envelope, resolves responses, revokes authority on stop/replan, recovers after Host restart |
| Permission engine | `src/lib/bunny-missions/authorization.server.ts` | `decide()` — the single deterministic permission gate every execution passes |
| MissionStore | `src/lib/bunny-missions/store.server.ts` | SQLite persistence of envelopes, requests, grants, runs (Host DB, schema `ma0.missions.v1`) |
| Capability Bus | `src/lib/bunny-missions/capabilities/bus.server.ts` | Admission point: consults `decide()`, records redacted capability runs, emits authority events |
| TaskManager | `src/lib/bunny-host/manager.server.ts` | Task-level approvals (user vs delegated), immutable `executionScope`/`mission` authority, restart containment |
| HTTP API | `src/lib/bunny-host/http.server.ts` | Loopback-only command surface; `mission.respond` decisions come from `local:"workstation"` or `device:<id>` actors |
| UI | `src/components/island/mission.tsx`, `mission-model.ts` | Presentation of requests/approvals; buttons submit decisions to the Host |

## 2. The four existing authority sources (exact current semantics)

### 2.1 Mission authorization envelope (one explicit approval per mission)

- Persisted in `mission_authorizations` (`id, mission_id, envelope_json, created_at, created_by`).
- Built at approval time from `envelopeFrom(mission, plan, data)` (types.ts): the envelope records
  `id`, `missionId`, `grantedAt`, `grantedBy`, `expiresAt`, `projectRoots`, `riskClasses`, the
  capability families it enables with explicit allowlists (`providers` incl. `sessions.steps` max
  sessions per step, `filesystem {read, write}`, `browser {enabled, domains}`,
  `terminal {enabled, commands, executables}`, `git.actions`, `network.allowed`,
  `computer.enabled`), `budget` (max external model calls, max runtime), `alwaysAsk`
  (ALWAYS_ASK = `EXTERNAL_SIDE_EFFECT`, `DESTRUCTIVE`), `revokedAt`.
- This is Bunny's current "one explicit permission for the whole mission". It is the mechanism the
  T9 brief calls the approval envelope; today it is already Host-owned, persisted, and revocable
  (`revokedAt`), but it has NO per-batch structure, NO action count cap, NO per-batch expiry
  shorter than the envelope, and NO target-application binding.
- Envelopes are granted by ONE decision at mission approval ("Approve & start", `mission.approve`),
  are re-validated inside `decide()` on every execution (expired ⇒ ask; revoked ⇒ deny), and are
  revoked by mission `stop()` and `replan()`.
- A model-executor step's provider session may internally perform many provider-permissioned file
  edits; those are the PROVIDER's own permission system (T2 compat, T5 provider completion
  semantics) — Bunny capability-family actions (terminal/git/browser/computer/fs/connectors) still
  go through Bunny's own `decide()`.

### 2.2 Per-action / per-skill-run permission requests ("Allow once")

- When `decide()` returns `"ask"` for a capability invocation, MissionManager creates a row in
  `permission_requests` (`permission.requested` event; step → `waiting_for_approval`; mission →
  `waiting_for_user`), and the request carries `action, risk, params (already redacted), reason,
  origin, createdAt, resolvedAt, decision` and, for skill steps, the current oneTime state.
- Current resolutions: `allow_once | deny` only. `allow_once` ⇒ `approvedOnce = {requestId, action}`
  on the step and, for skill runs, sets `oneTimeAction` so one matching action is allowed for the
  remainder of THAT skill run (skill restart clears it). For capability/skill steps one
  `allow_once` covers ONE invocation (or one action type inside one skill run) — that is the
  current entire "repeat authority" story. A skill that needs `computer.focus_window` then
  `computer.type` then `computer.invoke_control` then `computer.invoke_control` … produces a NEW
  request per action type and per new run: this is the approval-fatigue vector T9 addresses.
- Deny ⇒ step fails (`step_failed`), mission fails (policy: step failure fails the mission unless
  planned otherwise).
- There is no "Allow for task" or "Allow for skill" BUTTON in today's UI: the skill case is
  implemented as "Allow once" whose span is the skill run (shown in UI as "Allow this skill run").

### 2.3 Persistent capability grants (the only standing authority today, never used in production)

- `capability_grants` table: `action` (exact id or prefix pattern), `scope`
  (`global` or `mission:<id>`), `policy` ∈ `always_allow | allow_for_mission | ask_every_time |
  read_only | never_allow`, `created_by`. Most-restrictive wins between scoped and global grants.
- Created only by the explicit workstation command `capability.grant` (§ validation refuses
  blanket `*` always_allow). `decide()` consults them BEFORE envelope logic for deny cases, and
  via `grantFor()` in the ask path.
- These are T8-era standing overrides: out of T9's scope to change (T9 must NOT add more standing
  authority; batch grants are ephemeral and narrower — see policy-design).

### 2.4 Task-level approvals (direct tasks)

- `TaskManager.submit()` routes tasks through the same permission engine; user approval
  (`approve()`, kind `user`) vs delegated approval (`approveDelegated()`, kind `mission` —
  validates the mission envelope covers the task via `missionScopeCheck` and revalidates with
  `check()`).
- A task's `executionScope` and mission link are IMMUTABLE after creation (`update()` throws).
- Restart containment: tasks in flight are marked failed ("cannot reattach", T3 semantics).
  Task approvals are not batchable in T9 (desktop batching concerns capability steps only).

### 2.5 Direct workstation invocation

- Direct `capability.run` / `skill.run` from the workstation carries `direct:{confirmed:true}`
  (the user pressed the button locally). `decide()` still ASKS when the action is
  `EXTERNAL_SIDE_EFFECT`/`DESTRUCTIVE`/`hardApproval`/sensitive even with `direct.confirmed`.
- This is NOT part of mission approvals and stays unchanged in T9.

## 3. The permission decision itself (`decide()` — abbreviated truthfully)

`decide(manifest, params, context)` evaluates, in order: unknown/not-implemented ⇒ deny;
never_allow grant ⇒ deny; read_only grant on a non-READ action ⇒ deny; envelope revoked ⇒ deny;
(envelope expired, hardApproval, ask_every_time grant, capability not in envelope list, risk class
not in envelope riskClasses, scope violation, ALWAYS_ASK risk without elevated grant, sensitive
action) ⇒ ask; oneTime/direct/envelope match ⇒ allow. Return: `{decision: allow|deny|ask, reason,
risk}`. Every capability bus request and every delegated provider launch (provider/task violation
checks) funnels through decision functions from this module; nothing executes on an "ask".

## 4. Computer Runtime actions (the surface T9 batches)

`src/lib/bunny-missions/capabilities/computer.server.ts` — Windows UI Automation, structured
per-action scripts (prelude: `Find-Window` (pid or title-contain), `Find-Control`
(AutomationId/name conditions — no raw coordinates), `Describe`; output always carries the
observed `processId`, e.g. `control.processId` / `target.processId` / `pid`):

| Action | Manifest risk | Notes |
|---|---|---|
| `computer.list_windows` | READ | enumerate top-level windows |
| `computer.read_controls` | READ, **sensitive** | control tree of a window |
| `computer.capture` | READ, **sensitive** | window screenshot |
| `computer.focus_window` | EXECUTE | bring window front |
| `computer.invoke_control` | EXECUTE | button/menu/toggle via Invoke/Expand/Toggle patterns (no synthetic mouse) |
| `computer.type` | EXECUTE | ValuePattern (field value set — NOT synthetic keystrokes) |
| `computer.open_app` | EXECUTE | allowlist: notepad, calculator, paint, explorer, terminal |

Target identification in manifests: `window` params accept `processId` or `title`; controls accept
`automationId` / `controlType` / `name`; there are no coordinate parameters. Selection hierarchy
(T73): AutomationId > control type/name; title only as a filter context. Every structured output
already surfaces the observed processId — usable post-execution for target-drift detection.

## 5. Approval surfaces today

- **Workstation dashboard / island** (`mission.tsx`): per-open-request cards with `Allow once`
  (or `Allow this skill run`) + `Deny`; mission-wide approval card ("Approve & start" + plan +
  scope lines + budget/time limit) while `waiting_for_approval`; Stop mission (live states); Retry
  failed steps; verification card ("steps verified · not independently verified"); activity
  timeline; accountings. All buttons are Host-command wrappers — no local state can authorize.
- **Phone / remote** (`mission.respond` reachable from device actors over the tunnel; T6):
  same two decisions, envelope revalidated by the Host; revoked devices cannot send (T6).
- **Restart/recovery**: `recover()` marks in-flight runs `interrupted`, live steps
  `failed host_restart`, mission `waiting_for_user` with recovery detail; envelopes are NOT
  silently re-armed by anyone (an expired envelope just keeps asking; a revoked one denies).
  TaskManager constructor marks in-flight tasks failed (T3).
- **Journal events** (existing authority, `taskManager.emit` → `events` table + snapshots):
  `permission.requested`, `authorization.required`, `authorization.granted`,
  `authorization.denied`, `approval.mission_envelope`, `mission.*`,
  `capability.requested/started/completed/failed`, `audit.command`. No batch events exist yet
  (T9 adds approval.batch_* on the same emit path).

## 6. Production baseline facts (read-only inspection, 2026-10-06)

- Install: `Bunny-A-Windows-v17-T6` (`17.0.0-T6`), sourceCommit `cb005ef…`, manifest
  `f5bf648c92711b…`, host port 43119, host at rest at time of inspection.
- `missions` 9 · `mission_authorizations` 9 — **all 9 envelopes have `computer.enabled = false`,
  terminal disabled**, riskClasses only `READ` or `READ,EXECUTE`; desktop control has never been
  envelope-approved in production.
- `permission_requests` 0 · `capability_grants` 0 (no standing authority ever created).
- `capability_runs` 12 — all `git.status` / `git.diff` READ runs.
- migrations: only `ma0.missions.v1`.

## 7. Vocabulary mapping (brief → Bunny)

| Brief term | Bunny term today |
|---|---|
| approval envelope | mission authorization envelope (`mission_authorizations`) |
| "Allow once" | permission request resolution `allow_once` (one invocation, or one action inside one skill run) |
| "Allow for task" | does not exist as a separate knob; delegated task approval rides the mission envelope |
| "Allow for skill" | `allow_once` on a skill step = "Allow this skill run" (one action for one run) |
| grant override | `capability_grants` policies (standing; not touched by T9) |
| approval scope | envelope capability families + riskClasses + projectRoots + budget + alwaysAsk |
| Computer Runtime | `computer.*` capability family (Windows UI Automation bus adapter) |

## 8. What "one bounded approval" currently costs (the fatigue mechanism, evidenced)

A desktop mission with envelope `riskClasses = [READ, WRITE]` (the common case in production
history) running an explicit plan of, e.g., `computer.open_app` → `computer.focus_window` →
`computer.type` ×3 → `computer.invoke_control` → `computer.capture` yields at least the following
asks, each needing its own approval round-trip: every EXECUTE computer action not allowed by
`envelope.capabilities` → ask; every SENSITIVE read (`read_controls`, `capture`) → ask; skill runs
add one ask per distinct action type. In the worst case the user approves the same Calculator flow
5–8 times in one mission. That is the observable, current-model behavior T9 reduces without
expanding standing authority. (Re-verified live in the T9 runtime test matrix: see
live-approval-batching.json prompts-before counts.)

## 9. Sources

- Code read fully at `abe993a`: `authorization.server.ts`, `types.ts`, `store.server.ts`,
  `manager.server.ts`, `caps/bus.server.ts`, `caps/computer.server.ts`, `skills.server.ts`,
  `commands.server.ts`, `bunny-host/manager.server.ts`, `bunny-host/http.server.ts`,
  `island/mission.tsx`, `island/mission-model.ts`, `bunny-release.test.mjs`, `install/release-pin.json`.
- Production DB queried read-only: count/list dump commands recorded in the T9 live records.
- T8 baseline: `test-results/ma2-gate8/baseline/baseline.json` (floor 592 = 247 scripts + 311
  app + 34 UI).