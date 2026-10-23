# Bunny-A M-A-0 Claude Review 0

Independent architecture + security + regression audit. Review-only: no production
source was modified, no commits were made, no Codex/Claude/Ollama mission was run,
and no external model quota was spent. Evidence scripts and gate logs live outside
the repo (session scratchpad); the migration harness opened only disposable copies.

## Review identity

| | |
|---|---|
| Repository | `COMRADEART/router_agent` (local `C:\Users\allam\Documents\new\bun-router`) |
| Branch | `ma0-mission-architecture` |
| Base SHA | `ea0e803b8186ac777ba67f4c47db58ccd6b4407d` (`main`, clean) |
| Reviewed SHA | `33723ee0d3992203bc4951cee76d32ff6df3935a` (4 commits on base; working tree clean) |
| Diff | 48 files, +6,098 / −51 |
| Date | 2026-10-02 |

Confirmed: exactly 4 commits on top of `ea0e803`, tree clean, `git merge-base` = base.

## Executive assessment

M-A-0 adds a MissionManager **above** the existing TaskManager. The core structural
claim holds under inspection: the mission layer plans a bounded step DAG, takes one
scoped approval, and runs model steps as ordinary child `OrchTask`s through
`TaskManager.submit(…, delegated)` + `approveDelegated()`, and deterministic steps
through a Capability Bus. It does **not** import or call a provider adapter, does
**not** introduce a second router or provider registry, and leaves the entire
direct-task pipeline byte-identical. The migration is additive and I verified it
independently (below). Gates pass. Code quality is high and unusually defensive
(re-reads before every state write, honest recovery, no fabricated success).

The single most important finding is **H1**: a mission step the planner marks
`access: "read"` (Research, Architect, Reviewer) is still launched with a
write- and shell-capable provider session, and the envelope's `filesystem.write`
/`terminal` restrictions bind only Capability Bus actions, not the provider CLI.
The envelope therefore promises containment it does not deliver for model steps.
This is partly inherited from the direct path, but missions amplify it (many
sessions under one approval, approvable from a phone) and add a *new* mismatch
(a step declared read-only is not read-only at the provider). It should be fixed
before M-A-1 live acceptance; it is not a freeze-blocker because it changes no
existing behaviour and model-step execution authority already existed at `ea0e803`.

No BLOCKER. One HIGH, three MEDIUM, three LOW.

## Gate results

| Gate | Command | Result |
|---|---|---|
| Tests (scripts) | `npm test` | 205 / 205 pass |
| Tests (app/Host/missions) | `npm test` | 139 / 139 pass, 0 skipped — real headless-Chrome, real git worktree/merge, real HTTP Host on :43131, live Windows window-list all ran, not skipped |
| UI tests | `npm run test:ui` | 18 / 18 pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | 0 errors, 10 warnings — **identical set** (file:line:col+rule) to the builder's recorded baseline; all pre-existing, none in `bunny-missions/**` |
| Build | `npm run build` | exit 0; left no tracked/untracked changes in the tree |
| Migration (independent) | disposable copies of live DB + pre-M2 backup | legacy rows byte-identical; see below |

## Architecture verdict

**Sound to freeze for M-A-1, with the remediation set below.** The layering is
real (mission → TaskManager → BunnyRouter → adapter), the compatibility boundary is
preserved, persistence is additive and reversible, and the authorization model is
coherent and enforced on the Capability Bus. The gaps are at the **provider-session
boundary** (H1/M1) and in two documented limitations (M2/M3), not in the mission
core.

---

## Findings

### H1 — A read-only mission step is not read-only at the provider; the envelope's write/terminal limits do not bind model children
- **Severity:** HIGH
- **Subsystem:** Mission execution ↔ provider adapters
- **Files:** `src/lib/bunny-missions/manager.server.ts` `launchModel` (≈353–409); `src/lib/bunny-host/adapters.server.ts` `CodexAdapter.launch` (280), `ClaudeAdapter.launch` (316–323); `src/lib/bunny-missions/authorization.server.ts` `scopeFor` (write/terminal only set from capability steps)
- **Description:** The planner marks Research/Architect/Reviewer steps `access:"read"` and `scopeFor` leaves `filesystem.write: []` and `terminal.enabled:false` when no *capability* step writes. But `launchModel` passes only routing `TaskConstraints` (provider/local/runtime) to `submit`; it threads **nothing** about read-vs-write or the envelope into the adapter. `CodexAdapter.launch` always uses `--sandbox workspace-write`; `ClaudeAdapter.launch` always uses `--permission-mode acceptEdits --permission-prompts none --allowedTools Read,Write,Edit,Bash,PowerShell`. So a step the mission presents as read-only runs a provider session that can write files in the cwd and execute arbitrary shell/PowerShell. The envelope's write/terminal/git restrictions are enforced by `decide()` on the Capability Bus only — model children never pass through it.
- **Reproduction / reasoning:** Create a research-only mission (`"Explain how the router scores providers"`) → plan is one read model step, `requestedScope.filesystem.write = []`, `terminal.enabled=false`. On approval the Codex/Claude child still launches write+shell capable. Static arg construction confirms it; a live provider run (reserved for M-A-1) would demonstrate a write from a "read" step.
- **Impact:** The approval card and `scopeSummary` tell the user a mission is read-only / has no terminal, while its model steps can modify the repo and run commands. The mission-declared per-step access is not an enforced boundary.
- **Recommended remediation:** Thread `step.scope.access` and the envelope into the adapter launch: for `access:"read"` (and when the envelope grants no write/terminal), launch Codex with `--sandbox read-only` and Claude with `--allowedTools Read` (no Write/Edit/Bash/PowerShell). More broadly, document that write/EXECUTE model steps run with the provider's own authority, not an OS sandbox (see M1).
- **Required before M-A-1:** YES (at minimum the read-only mapping).

### M1 — Provider-session actions bypass the Capability Bus; one mission approval authorizes several unsupervised full-authority sessions, approvable remotely
- **Severity:** MEDIUM
- **Subsystem:** Security model / approval UX
- **Files:** `docs/MA0_SECURITY_MODEL.md` (disclosed); `src/components/island/mission-model.ts` `scopeSummary`; `src/components/island/mission.tsx` `ApprovalCard`; `commands.server.ts` `REMOTE`
- **Description:** Inside a launched Codex/Claude session, file and shell actions are governed by the provider CLI, not Bunny (correctly disclosed in the security model). This is **inherited** from the direct path, but missions change the shape of consent: a single `mission.approve` authorizes up to `maxExternalModelCalls` provider sessions, and `mission.approve`/`start` are in the remote allow-list, so a paired phone can grant it. The approval card lists capabilities/commands/roots but never states that model steps are not confined by them.
- **Reproduction / reasoning:** Code reading; `REMOTE` includes `mission.create/approve/start/respond/stop`.
- **Impact:** A user (or phone) approving a mission may believe the listed scope bounds all work; it bounds only deterministic steps.
- **Recommended remediation:** In the approval card, state explicitly that "AI-agent steps run with the provider's own permissions (full file/command access in the working folder), not the Bunny scope above." Consider requiring workstation (not phone) approval when the plan contains write/EXECUTE model steps.
- **Required before M-A-1:** NO (fix with H1).

### M2 — Browser SSRF via DNS rebinding (public hostname resolving to a private IP)
- **Severity:** MEDIUM
- **Subsystem:** Browser Runtime
- **Files:** `src/lib/bunny-missions/capabilities/browser.server.ts` `blockedHost`/`safeUrl`/route handler (20–36, 80–84, 130)
- **Description:** `blockedHost` rejects literal loopback/RFC1918/link-local/CGNAT/`.local/.internal/.localhost` for the initial URL, the post-redirect URL, and every subresource — verified by tests and reading. It cannot catch a **public** hostname that DNS-resolves to a private address (no DNS pinning), which the builder discloses. `browser.read` returns page text as an artifact, so a rebinding attack can read an unauthenticated local service's response.
- **Reproduction / reasoning:** Not exercised live (needs a controlled rebinding domain); confirmed by code — the route check inspects `url.hostname`, never the resolved IP. The Host API at `127.0.0.1:43119` stays protected by its bearer token (a rebind read gets 401), but other local services do not.
- **Impact:** Limited to missions with the browser enabled visiting an attacker-chosen domain; read-only exfiltration of local-service responses.
- **Recommended remediation:** DNS-pin (resolve, check every resolved address against the private ranges, then connect to the pinned IP with the original Host header), or route browser traffic through a checking proxy. Reserved for M-A-1 live testing.
- **Required before M-A-1:** NO (track as known limitation).

### M3 — Stop/replan during `git.merge` can leave the repository mid-merge
- **Severity:** MEDIUM
- **Subsystem:** Git capability / cancellation
- **Files:** `src/lib/bunny-missions/capabilities/local.server.ts` `GitCapability.execute` `git.merge` (201–211); `capabilities/process.server.ts` `runProcess` abort/kill; `manager.server.ts` `cancelChildren`→`bus.cancel`
- **Description:** `git.merge` runs `git merge --no-ff` and only on a **non-zero exit** runs `merge --abort`. A mission stop/replan calls `bus.cancel`, which aborts the `AbortController`; `runProcess` kills the git process (`taskkill /T /F`). A kill mid-merge does not trigger the `--abort` cleanup, so the working tree can be left with `MERGE_HEAD`/conflict markers.
- **Reproduction / reasoning:** Code path; not timed live. Low likelihood in M-A-0 because the deterministic planner never emits a merge step — `git.merge` is reachable only via an explicit workstation graph or a (non-builtin) skill.
- **Impact:** Workspace-integrity surprise in the user's repo after a stop during a merge.
- **Recommended remediation:** On abort of a merge run, attempt `git merge --abort` in a `finally`; or gate merge behind a dedicated confirmation. Reserved for M-A-1.
- **Required before M-A-1:** NO.

### L1 — `terminal.exec` allowlist matches by basename, so an absolute path to a same-named binary passes
- **Severity:** LOW
- **Files:** `authorization.server.ts` `commandName`/`scopeViolation` (17–18, 95–101); `capabilities/process.server.ts` `resolveCommand`
- **Description:** The envelope stores command **names** (`node`, `npm`, `git`); `scopeViolation` compares `commandName(params.command)`. A param like `C:\x\node.exe` reduces to `node`, passes an approved `node`, and `resolveCommand` will launch that absolute file. **Not agent-reachable in M-A-0**: capability params come from the planner, explicit workstation graphs, or skills — never from model output (models run in provider sessions, not on the bus). Latent hardening gap only.
- **Recommended remediation:** When a command is an absolute/relative path, resolve it and require the resolved file to sit in an approved root or match a configured executable path; otherwise compare the full resolved path, not the basename.
- **Required before M-A-1:** NO.

### L2 — Allow-once inside a multi-step skill covers every instance of that action in the run
- **Severity:** LOW (documented)
- **Files:** `manager.server.ts` `capabilityRequest` (414–419), `runDeterministic` skill branch; `skills.server.ts` `run`; `authorization.server.ts` `decide` (143)
- **Description:** `approvedOnce.action` makes `decide()` return allow for every step in a skill whose action matches, until the step clears it. Disclosed by the builder. **Mitigated** for path actions: the skill branch passes `roots: envelope.projectRoots` (no dirname widening — widening happens only in `capabilityRequest`, used by single capability steps), so `scopedPath` still blocks any path outside the approved roots even when `decide` allows. Single capability steps clear `approvedOnce` on completion, so there allow-once is genuinely once.
- **Recommended remediation:** Scope a one-time allowance to a single `{action, params-hash}` rather than to the action for the step's lifetime.
- **Required before M-A-1:** NO.

### L3 — Direct `capability.run`/`skill.run` `cwd` is length-validated only, relying on downstream `scopedPath`
- **Severity:** LOW
- **Files:** `commands.server.ts` `direct()` (23–27), `capability.run`/`skill.run`
- **Description:** The direct `cwd` is `text(cwd,2000)` with no root check at the command layer; containment depends entirely on each adapter calling `scopedPath(context.cwd, …, roots)`. It does hold today (filesystem/terminal/git/computer/github all canonicalize against `context.roots`), but a future adapter that forgets would leak. Workstation-only.
- **Recommended remediation:** Validate `cwd ∈ roots` once in `direct()` as defense in depth.
- **Required before M-A-1:** NO.

---

## Protected legacy path assessment — PASS

Verified against `ea0e803`:
- `router.ts`, `learning.server.ts`, `adapters.server.ts`, `registry.server.ts`,
  `verification.server.ts`, `orch/host-bridge.server.ts` are **byte-identical**
  (`git diff --quiet` clean).
- `approve(id)` is unchanged in behaviour: it now calls a private `launch()` but
  still emits `approval.accepted` with the original detail text; direct task records
  get **no** `mission`/`approval` fields (test "model steps flow…" asserts
  `approval === undefined`, `mission === undefined`; I re-read the code to confirm
  `launch` only attaches `approval` when `kind==="mission"`).
- No duplicate router/registry; `MissionManager` imports no adapter and never calls
  `adapter.launch` (its only `.launch(` is its own method).
- Stop ownership preserved: `cancelChildren` stops only tasks whose
  `task.mission.missionId` matches; test confirms an unrelated direct task keeps
  running.
- Provider eligibility and project-root checks in `submit`/`launch` are unchanged;
  delegated cwd must be an approved project, the default root, or a Host-owned
  worktree.

## Mission authorization assessment — PASS (with H1 caveat on model steps)

`decide()` order is correct: contract-only → never_allow/read_only grant →
one-time → direct(confirmed) → envelope presence/revocation/expiry → hardApproval →
ask_every_time → capability-in-envelope → risk-class → parameter scope → alwaysAsk →
sensitive → allow. Confirmed:
- Envelope is persisted on approval and re-checked per capability call and per child
  (`taskViolation` at delegated launch, re-run inside `approveDelegated`).
- Replan revokes the prior envelope (`revokedAt`) and forces re-approval; revoked ⇒
  deny, expired ⇒ ask.
- `alwaysAsk` (EXTERNAL_SIDE_EFFECT, DESTRUCTIVE) holds against grants except a
  non-destructive `always_allow`/`allow_for_mission`; hardApproval survives any grant
  (test confirms).
- A child outside the envelope stays `waiting_for_approval` and raises
  `provider.execute`; approving it is recorded as the user's own `approval.accepted`,
  not delegated (test confirms). An expired authorization does not launch on the old
  approval.
- No replay across missions: envelopes carry `missionId`; grants are
  `global`/`mission:<id>`; `*` allow is refused.
- Capability **params are never agent-controlled**: model output goes to the provider
  session, not the bus; bus params come from planner/explicit-graph/skills. This is
  the property that keeps the authorization model meaningful — it holds in M-A-0.

The one gap is H1: the envelope governs *which provider runs where* but not what the
provider does inside its session, and per-step read/write is not enforced there.

## Provider sandbox boundary assessment — KNOWN LIMITATION, trending HIGH for missions

Bunny authorizes before launch (eligibility, cwd ∈ roots, provider allow-list,
local-only, external-call budget). After launch, Codex (`--sandbox workspace-write
--cd <root>`) and Claude (`acceptEdits`, `--permission-prompts none`, Bash/PowerShell
allowed) act under their own sandboxes. Bunny cannot independently observe or veto a
command inside the session; the approved cwd is the effective filesystem anchor, not a
jail (Codex workspace-write limits writes to the workspace and blocks network by
default; Claude's Bash/PowerShell is not similarly confined). Equivalent to the direct
path at `ea0e803`, so **not a new BLOCKER**, but missions aggregate it and H1 makes a
declared-read step write-capable. Classification: **KNOWN LIMITATION** for the boundary
itself; **HIGH (H1)** for the read/write mismatch and **MEDIUM (M1)** for the consent
clarity. Documentation is honest but should be surfaced at approval time.

## Browser isolation assessment — PASS except DNS rebinding (M2)

Separate Bunny profile under the data dir; `http(s)` only; embedded credentials
refused; loopback/RFC1918/link-local (incl. 169.254.169.254)/CGNAT/`.local/.internal`
refused for initial URL, post-redirect URL, and **every** subresource via
`context.route("**/*")`. The Host API on `127.0.0.1:43119` is unreachable without
loopback permission (test confirms). Gap: public hostname → private IP (no DNS
pinning), M2.

## Capability Bus assessment — PASS

Manifests authoritative; duplicate ids and un-namespaced actions refused; `ask`
executes nothing and records no run; `deny`/`unavailable`/`unconfigured`/`unsupported`
never report success; inputs validated per adapter; outputs typed; secrets and typed
text/content redacted in run records (`redact`, and `text`/`content` stored as
lengths — test confirms); `AbortController` timeout ≤30 min; cancel aborts in-flight
runs and `taskkill /T` ends the spawned tree. `terminal.exec` is argv-only
`shell:false`, refuses `.cmd/.bat/.ps1`, routes npm/npx through the bundled CLI, and
escalates destructive/external commands via `riskFor`. Filesystem canonicalizes
(symlink/junction-followed) and contains to roots; atomic write with read-back, no
silent overwrite; single-file delete only.

## Scheduler / concurrency assessment — PASS

DAG validation (Kahn) rejects cycles, self-deps, unknown deps, duplicates, oversize.
Per-mission ticks are serialized (`ticking`/`again`); within a tick launches are
sequential with the mission re-read between them, so budget and concurrency cannot be
raced past their limits (watchdog re-enters through the same guard). `evaluate`
reaches a terminal state for every combination I traced (all-done → verifying →
completed; waiting → waiting_for_user; otherwise failed); blocked dependents are set
only when a dep has permanently failed, so no "blocked behind a succeeded dep". Deny
transitions the mission back to running before failing the step, so it does not hang in
waiting_for_user. `countModelCall` and `setMission`/`setStep` are synchronous
read-modify-writes (no interleaving on Node's single thread). The async-finalization
surface (`finishModelStep`/`childApprovedDirectly` via `setImmediate` vs. ticks) is
guarded by consistent state re-reads before each write; I found no concrete
lost-update, but recommend soak-testing it under a real multi-provider load in M-A-1.

## Persistence / recovery assessment — PASS (independently verified)

Migration is additive: `user_version 2→3`, `events.mission_id` (nullable) + index,
14 `CREATE TABLE IF NOT EXISTS`, one `INSERT OR IGNORE` of `ma0.missions.v1`. I did
not trust the builder's evidence — I ran my own harness on **disposable copies** of
the live DB (read-only `VACUUM INTO` snapshot; the live file's SHA-256 was identical
before and after) and the pre-M2 backup:
- Legacy tables (`tasks, projects, events, outcomes, devices, policies, settings,
  providers`) hashed over their **pre-migration** columns were identical after one and
  after two opens (idempotent). The only legacy-table change is the intended
  `migrations` row.
- Live snapshot: 51 tasks / 13 projects / 1,836 events / 36 outcomes / 9 devices all
  preserved; all events read back `missionId: null`; 14 new tables created; tasks
  parse.
- Downgrade-safe: opening the migrated DB with the `ea0e803` `HostDatabase` reads all
  rows and writes a new event (it resets `user_version` to 2 and ignores the extra
  column/tables); re-opening with M-A-0 re-migrates cleanly and the old-code event is
  intact with `mission_id = null`.

Recovery is honest: interrupted model/capability steps become `failed/host_restart`
with `outcome:"interrupted"`, never "resumed"; the TaskManager independently fails
reattach-impossible sessions; `mission.retry` starts a **fresh** child
(`id !== oldChild.id`, test confirms); locks are released; `planning` missions fail.
No phantom "completed because it existed".

## Computer Runtime assessment — PASS (architecture), action paths NOT live-tested

Windows UI Automation + user32 via `powershell.exe`; parameters passed through
`BUNNY_COMPUTER_PARAMS` env (JSON), never interpolated into script text, so no script
injection through structured params. Semantic only: no raw mouse coordinates, no
synthetic keystrokes (test asserts no such actions exist). `open_app` is allowlisted
and refuses executable/script targets; non-READ actions are EXECUTE needing
`computer.enabled`; `read_controls`/`capture` are privacy-sensitive and ask. Only
`list_windows` was exercised live; focus/invoke/type/capture/open success paths are
NOT TESTED (verified only for refusal/permission), as the builder states.

## Skill system assessment — PASS

A failing step stops immediately, runs cleanup, records the failure, keeps the
last-known-good active, and asks for repair. `proposeRepair` saves a new **candidate**
(active untouched); `verifyCandidate` promotes only on a run that passes every
validation (previous retired, kept as history — test asserts `[retired, candidate,
active]`). `record` refuses runs with redacted/private params and keeps the skill a
candidate until verified. Parameters validated; skill steps pass the same `decide()`;
recursion is impossible (skills call capabilities, not skills). A malformed repaired
skill cannot go active without a verified run.

## UI assessment — PASS (projection only), production render reserved

The UI is a pure projection of `snapshot.missions`; it holds no orchestration state
and every action calls a Host command. `mission-model.ts` is pure (glyphs, labels,
progress from counts only, never time; agent rows cap + overflow; provider shown
separately from role). Flag-off hides the Task/Mission switch and all mission
sections. The approval card lists plan + scope but omits the model-step authority
caveat (M1). Typecheck/lint clean; `test:ui` 18/18. The mission UI is not render-tested
against the production build because missions are off by default; reserved for M-A-1.

## Phone / remote assessment — PASS, with a noted authority point

Remote devices may call only `mission.create` (no explicit graphs — enforced),
`mission.get/approve/start/respond/stop`, `inbox.ack`; everything else (configure,
retry, plan/replan, all `capability.*`/`skill.*`/`trigger.*`) is workstation-only
(`missionCommand` gate + test). Pairing/revocation unchanged; a revoked device gets
401 (test). **Noted, by design:** a paired phone can create, approve, start,
allow-once and stop missions, i.e. grant real execution authority — this compounds
M1. Public-HTTPS/tunnel flow was not tested live; no acceptance is claimed for it.

## Test-quality assessment — Good

139 app/Host/mission tests are behaviour-oriented, not implementation snapshots, and
use the **real** TaskManager with fake *provider adapters* (the correct seam — the
delegated-approval and routing logic is real; only the external model process is
faked). Negative cases are present (out-of-envelope deny, budget exhaustion, expired
authorization, deny-before-side-effect, stop isolation, namespacing, unconfigured
connectors never succeed). Real resources are exercised (headless Chrome, git
worktree/merge/conflict, HTTP Host, Windows window list). Permission tests verify
**denial before side effect** (`runs.filter(filesystem.write).length === 0` after
deny). Migration is tested on a populated v2 DB, not just an empty one.

Gaps worth adding in M-A-1: a live provider mission (H1 would surface a write from a
read step); a stop-during-merge test (M3); a concurrency soak for the
`setImmediate`-finalization vs. tick surface; and a DNS-rebinding case for the browser
guard (M2).

## Known limitations that are not defects

- Provider-session actions are outside the Capability Bus (disclosed; inherited from
  the direct path).
- Planner is deterministic/heuristic; replanning re-runs the same planner.
- `BUNNY_MISSIONS` env overrides the Settings toggle (both directions) — documented.
- No model-assisted planning, no automatic skill repair, no candidate mission-planning
  policy, no dollar-cost accounting (nothing is invented — accounting reports only
  provider-reported tokens and real counts).
- Native WPF Island has no mission UI; the installed Host (PID 14188) still runs
  pre-M-A-0 code (not restarted).

## Missing live evidence reserved for M-A-1

- Any real Codex/Claude/Ollama mission child (none run; H1 would be demonstrated here).
- Computer Runtime action success paths on a real desktop.
- Production-build render of the mission UI (flag off by default).
- Public-HTTPS phone flow for missions.
- DNS-rebinding SSRF and stop-during-merge behaviours under live conditions.

## Recommended M-A-0 remediation set

1. **(H1)** Map `step.scope.access` → provider sandbox at launch: read steps launch
   Codex `--sandbox read-only` and Claude with `--allowedTools Read` (no
   Write/Edit/Bash/PowerShell); write/EXECUTE steps stay as today.
2. **(M1)** Add one line to the approval card: model steps run with the provider's own
   permissions, not the Bunny scope; consider workstation-only approval when the plan
   contains write/EXECUTE model steps.
3. **(M3)** On abort of `git.merge`, run `git merge --abort` in a `finally`.
4. **(L1)** Resolve absolute/relative `terminal.exec` commands and check the resolved
   path against approved roots/configured executables, not just the basename.
5. **(L2/L3)** Scope allow-once to a single `{action, params}`; validate direct `cwd`
   up front.
6. **(M2)** Plan DNS-pinning for the browser guard (can land in M-A-1).

## Final verdict

Legacy path intact and verified; migration additive, idempotent, downgrade-safe and
independently reproduced on live + backup copies; feature flag off preserves every
existing behaviour; authorization, Capability Bus, scheduler, recovery and skills are
sound and enforce what they claim — on the Capability Bus. The one serious gap (H1,
read-only steps are not read-only at the provider, with the consent-clarity M1) is
real, should be repaired before M-A-1 live acceptance, and does not change existing
behaviour or block a freeze.

**BUNNY_MA0_REVIEW_PASS_WITH_REMEDIATION**
