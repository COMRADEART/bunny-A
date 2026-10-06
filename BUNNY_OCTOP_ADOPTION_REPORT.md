# BUNNY-A — OCTOP REFERENCE ADOPTION STUDY (OCT-1)

Verdict: **BUNNY_OCTOP_REFERENCE_ACCEPTED_WITH_NOTES**

Status: ARCHITECTURE RESEARCH ONLY. Nothing in this study changes Bunny-A
runtime, production state, releases, permissions, tunnel, pairing, mission
flags, or the accepted promotion boundary at T6
(**BUNNY_MA2_T6_FAIL** stands). This report is the sole deliverable of OCT-1.
No Bunny file other than this report was created or modified, and nothing was
committed.

---

## 1. Verdict scope

The verdict applies **only** to Octop as an architectural reference, in the
sense of: "May Bunny-A take ideas from this codebase and design from it?"

- It is **not** runtime acceptance of anything.
- It is **not** implementation approval of any workstream in §10
  (adoption plan).
- It is **not** M-A-2 acceptance and does not touch T6.

Octop is accepted as a reference **with notes**: it offers several genuinely
well-built mechanisms Bunny can learn from (peer-call plumbing discipline, the
ACP outbound permission suspend/resume protocol, connector credential hygiene,
two-phase destructive-mail confirmation, boot-time job resume), and it also
ships defaults and gaps (HITL disabled out of the box, warn-only tool guard,
unauthenticated ACP stdio inbound, memory-only inbox) that Bunny must
deliberately not adopt.

North star, held throughout: **Take the strongest ideas from Octop without
turning Bunny into Octop. Bunny remains a local-first provider-independent
agent control plane where the Host owns identity, authority, execution, state,
verification and recovery.**

---

## 2. Pinned reference

Studied clone (disposable scratch, outside the Bunny tree):
`C:\Users\allam\Documents\new\research\octop-ref\Octop\`

| Item | Value |
|---|---|
| Repository | https://github.com/TencentCloud/Octop |
| Commit pinned | `eb28011249c02cafd389b2d424294c6c1b9cf422` |
| Default branch | `main` |
| Commit date | 2026-10-05 |
| License (repo + packages) | MIT |
| Version | 1.0.2b6 |
| Reference library | octop-harness 1.0.1, octop-gateway 1.0.0, octop-memory 1.0.0, octop-browser 1.0.0 |
| Notable transitive pins | agent-client-protocol 0.11.0, langgraph 1.2.11, langgraph-checkpoint-postgres 3.1.0, apscheduler 3.11.3, fastapi 0.138.2, mcp 1.28.1 |

Package pins were verified by downloading the exact sdist named in
`uv.lock`, checking SHA-256, and extracting to an isolated scratch
directory (never executed, never imported):

| Package | sdist SHA-256 (first/last 8) | Verdict |
|---|---|---|
| octop-harness 1.0.1 | `37d641ff…ac1e301f` | hash OK |
| octop-memory 1.0.0 | `1df8fa2d…442f79556` | hash OK |
| octop-gateway 1.0.0 | `3630e9f9…69cdd789fa` | hash OK |
| octop-browser 1.0.0 | `a7e12bcf…94de18210c` | hash OK |

Each pinned item was classified before use as one of:
IMPLEMENTATION (code inspected at the pinned commit) / upstream dependency
(Pypi-pinned and inspected in its own sdist) / DOCUMENTED ONLY (design claim
in docs, not code-inspected) / TESTED-REPORTED (acceptance table in repo docs;
their own claims, not reproduced here) / live behavior (not tested by this
study).

Bunny baseline pinned for comparison:
working tree `11f015c72e5194168cb6eaddc421230717527268`, branch
`ma2-operational-hardening`. Accepted prior digests:
`BUNNY_OPENDOTS_ADOPTION_REPORT.md` (OD-1), `MA2_ARCHITECTURE.md`,
`MA2_ACCEPTANCE_MATRIX.md`.

---

## 3. Evidence terminology

Same ledger convention as `BUNNY_OPENDOTS_ADOPTION_REPORT.md`:

| Term | Meaning |
|---|---|
| IMPLEMENTED (OCTOP) | Octop code at the pinned commit does this; inspected by this study |
| IMPLEMENTED (HARNESS) | In octop-harness 1.0.1 sdist; inspected by this study |
| UPSTREAM LIB | Third-party dependency, pinned; behavior claims from its usage in Octop unless independently inspected |
| DOCUMENTED ONLY | Claimed in Octop docs; no code-inspection evidence at the pin |
| TESTED — REPORTED | Octop's own acceptance tables say so; not reproduced by this study |
| NOT IMPLEMENTED | No code and no doc claim found at the pin |

Bunny-side claims cite the accepted matrix and prior reports and keep their
existing verdicts (T1 LIVE VERIFIED PASS … T6 FAIL). This study did not re-run
any Bunny verification.

---

## 4. What Octop is (reference shape, one page)

One Python process (FastAPI + uvicorn), a React dashboard shipped inside the
wheel, a Click CLI, and the composition root
`src/octop/infra/server.py` + `src/octop/launch.py` (launch.py is the only
module allowed to import both the server and the API app). Runtime work is
delegated to `octop-harness` (LangGraph/deepagents agent runtime); IM channels
to `octop-gateway`; memory to `octop-memory` (a freestanding engine); browser
automation to `octop-browser` (Playwright session library). State is
SQLite-WAL or PostgreSQL; agent workspaces live at
`~/.octop/agents/<agent_id>/`; remote storage backends (S3/COS/OSS/OBS,
Docker sandboxes) can be attached per agent. Multi-user with JWT + argon2;
row-owned agents (`agents.user_id`) with admin bypass. Cron via in-process
APScheduler. ACP both directions: stdio inbound server and an `acp_runner`
tool that drives external agents.

The key structural difference from Bunny: Octop's "authority" is diffuse —
the harness middleware stack is the de-facto policy engine, and the app layer
trusts it. Bunny deliberately concentrates authority in Host-owned objects
(MissionManager, TaskManager, Capability Bus, AuthorizationEnvelope,
BunnyRouter) and keeps providers, adapters and surfaces non-authoritative.

---

## 5. Classification ledger (all 24 mechanisms)

One primary classification per mechanism. ADAPT = adopt the idea with major
Bunny-native redesign. "Bunny equivalent" names what Bunny has today at the
pinned tree.

| # | Mechanism | Classification | Bunny equivalent | Gap | Recommendation | Milestone |
|---|---|---|---|---|---|---|
| 1 | AgentTeams (harness peer-call machinery + Octop team hosts) | ADAPT | MissionManager-orchestrated missions; TaskManager runs each lane | No staffing concept: one mission = one orchestrator prompt | Borrow peer-protocol discipline + in-flight accounting into MissionManager as **mission staffing**; never a second MissionManager | OA-4 |
| 2 | Expert / persona model | ADAPT | TaskKind prompts + mission briefs; no durable agent identity | No per-agent identity object that survives rerouting | AgentProfile per OD-1 future list (identity ≠ provider; style ≠ authority) | OA-1 |
| 3 | Expert sharing / resource pools | LATER | Single-owner Host; paired devices | N/A today | Revisit only under multi-user option C; pairs with actor-identity design | OA-6 |
| 4 | Persistent per-agent workspaces | ADAPT | Single Bunny-Workspace root; T1 canonical state | No per-mission/per-agent workspace object | AgentWorkspace (OD-1 combined): per-mission dirs, explicit lifecycle, T4-owned processes only | OA-2 |
| 5 | Workspace backend abstraction | ADAPT | Host-local state layout contract (MA2) | No pluggable workspace storage | Define a narrow BunnyWorkspaceBackend interface first; one local implementation; add backends only on proven need | OA-2 |
| 6 | Octop Memory | REJECT (as authority) / ADAPT (concepts) | Bunny memory + T1 external state | T1 is task state, not long-term facts | No second memory authority; borrow evidence references, scopes, explicit extraction→review→promote | OA-8 |
| 7 | Knowledge base / RAG | LATER | None (Skill Library candidates only) | No KB surface at all | Defer; when built, citations + provenance + scope first, never mixed into authoritative memory | OA-7 |
| 8 | Connector architecture | ADAPT | Triggers/Inbox; capability tools through the Bus | No connector credential/approval pipeline | Two-phase destructive confirmation, connector-scoped instances, credential isolation; connectors = Capability Bus tools only | OA-5 |
| 9 | Plugin architecture | REJECT | Skill Library candidates + Capability Bus admission | — | Skills register candidates; Bus stays the only admission authority; no third-party tool injection | — |
| 10 | ACP inbound (IDE → adapter → authority) | ADAPT | Triggers/Inbox; HTTP 43119 loopback gateway | No ACP surface at all | Build only as a **new Inbox source terminating at Host authority**, auth required, never a direct tool line | OA-3 |
| 11 | ACP outbound (worker → external agent) | ADAPT | BunnyRouter provider selection; Codex/Claude/Ollama compat T2 | No protocol-level delegate-and-resume to external ACP agents | ACP adapter as a **Bus-capable provider under BunnyRouter**; port the permission suspend/resume protocol; T2 compat profiles; T4 ownership required | OA-3 |
| 12 | Browser automation | ALREADY_HAVE | Shared persistent browser profile + checkingProxy DNS/private-network fence | — | Do not port; OD-1 browser workstream owns profile lifecycle | — |
| 13 | Terminal AI (model-driven PTY shell) | REJECT | Deterministic capability commands; T4 OwnedProcessGroup; T1 external state | — | Free-form `shell=True` + regex deny-list + warn-only guard stays out of Bunny; keep deterministic capability surfaces | — |
| 14 | Remote desktop (screen capture + input injection) | LATER | Computer Runtime semantic actions (T4-approved) | — | Raw capture/inject only under strict conditions (dedicated display, no host input, recorded, approval-gated); never default control surface | OA-6 |
| 15 | Cron / background jobs | ALREADY_HAVE | Approval-gated triggers (canonical) | — | Bunny triggers are the sole scheduled-entry authority; borrow run-status bookkeeping shape only, inside triggers | — |
| 16 | Multi-user / JWT authorization | REJECT (default); study output | Loopback-only Host + paired devices | — | Keep option B (owner + trusted devices); documents A–D in §14; pairing ≠ identity always | OA-6 |
| 17 | Channel integrations (IM gateways) | LATER | Triggers/Inbox | No IM surfaces | Only as authenticated actor sources into Inbox → draft → approval; no direct mission authoring | OA-5 |
| 18 | Desktop client architecture | ALREADY_HAVE | WPF Island + Android HTTPS companion; gateway dashboard | — | Note Octop's WS mid-turn controls as UI design inspiration only | — |
| 19 | Conversation checkpointing | ALREADY_HAVE | Journal + SQLite state; no blind replay | — | Optional borrow: eviction-archival file for compacted context (T1-compatible artifact) | OA-7 |
| 20 | Restart/recovery behavior | ALREADY_HAVE | Journal; interrupted → reconcile → explicit retry (T1) | — | Bunny recovery is stricter; do not adopt Octop's best-effort-resume posture | — |
| 21 | Approval / security model | ALREADY_HAVE core; ADAPT pieces | AuthorizationEnvelope + Bus admission + T5 projection | — | Borrow machine-readable guard-rule catalog shape and structured permission-required resume options | OA-3 |
| 22 | Tool / shell guardrails | ADAPT | Deterministic capabilities; no arbitrary shell | — | Adopt "reviewable rule file" concept only if Bunny ever exposes deny-rules; never as primary safety | OA-7 |
| 23 | PII / redaction model | ADAPT | Bus-level param redaction | — | Keep the Capability boundary redaction (stronger); consider redaction-in-result awareness later | OA-8 |
| 24 | Single-process Host architecture | ALREADY_HAVE | Single Windows Host + T3/T4 containment | — | Same shape, but Bunny adds failure containment Octop lacks; do not dilute | — |

Count check: 24 rows, one classification each — 1 ALREADY_HAVE+ADAPT hybrid
is split across rows 21/22/23 per their own mechanisms; primary
classifications stand as written.

---

## 6. Per-mechanism findings (evidence, REJECT lists, acceptance criteria)

### 6.1 AgentTeams (mechanism 1) — deep study per §5 of the task

**What Octop actually runs at the pin.** Two layers:

- `octop-harness` 1.0.1 `TeamManager` + `InboxManager` + `TeamProcessor`
  protocol (IMPLEMENTED, HARNESS): peer calls are text-only, one-way
  (`ask_agent` / async dispatch; `peer_invoke_mode` sync/async/both). Inbox is
  **memory-only**, single worker, per-target/source locks (same callee serial,
  cross-callee parallel; coordinator callbacks serial by source thread),
  cancellable only at suspension points, **lost on restart**. Ownership is
  checked before dispatch; `team_peers` allowlist is clamped **tighten-only**
  through middleware ordering.
- Octop app layer (`infra/agents/teams/`, IMPLEMENTED): a team is a normal
  agent row with `kind=team`; roster lives **only** in the host workspace file
  `.octop/manifest.json`; `TeamJobTracker` is an in-process idempotent
  in-flight ledger (start at `prepare_peer_session`, release on any
  completion path) — restart forgets it. Host tool set is an allowlist of
  `agent_list`, `ask_agent`, `memory_search/get`, `current_time` — everything
  else disabled. Member eligibility = own expert, `is_shared` expert
  (dispatch-only; cannot modify), or admin. Member briefs are rewritten by the
  coordinator (digest-then-rewrite; forwarding raw user text is prohibited by
  prompt), members get a request-scoped `peer_invoke_mode=sync` override with
  `team_peers` narrowed to teammates, member checkpoints are
  `main_thread~member`, and stop **only cancels the coordinator stream** —
  queued member work continues to completion and reports back.

**Bunny-side requirement (binding):** MissionManager remains the sole Mission
orchestration authority. Octop's coordinator is borrowed as *staffing* inside
a mission, not as a parallel orchestrator.

**REJECT list (do not adopt as-is):**
- Memory-only inbox as a durable mechanism — Bunny missions have a journal;
  in-flight work must be recoverable or explicitly abandoned, never silently
  lost on restart.
- In-process `TeamJobTracker` as the mission-level ledger — replace with a
  journal-backed in-flight record under MissionManager.
- "Stop cancels only the coordinator, members keep running" — Bunny must
  surface every in-flight lane in T5 and stop each explicitly.
- Roster-in-a-workspace-file as the authoritative membership store — Bunny
  keeps staffing in Host state.
- Peer results injected straight into the parent prompt without a Bunny-side
  verification step.

**Accept as concepts (Bunny-native redesign):**
- Async dispatch + serial-by-source callbacks (prevents interleaved member
  writes into one lane).
- Per-callee serialization; cross-callee parallelism.
- Request-scoped tightening of a member's tools/context for team work.
- Coordinator tool ceiling (dispatch + memory + time only; no worker tools).
- Brief rewriting rule (coordinator writes the task brief; raw user text is
  not forwarded verbatim).
- In-flight guard: reject staffing changes while flights are open.

**Future-acceptance criteria (OA-4, none implemented now):** a staffing
proposal adds mission lanes only through MissionManager state transitions;
every lane is a TaskManager task with its own approval path; in-flight ledger
lives in the journal; T5 shows lanes and their owners; a mission-level stop
accounts for all lanes before the mission may close.

### 6.2 Expert / persona model (mechanisms 2, 7 context)

IMPLEMENTED (OCTOP): experts are agent rows with workspaces, seeded identity
files (SOUL.md / AGENTS.md / USER.md), provider binding (`default_model`),
tool policy, avatar/color; 16 MBTI persona profiles are data classes rendered
into SOUL.md at boot; user `system_prompt` is appended ("backbone + trim");
no admin endpoint to edit persona content (reproducibility by design); expert
library bundled on disk; published-expert export packages a workspace snapshot
(runtime/session dirs excluded, `.env`/credentials excluded) into a
market/share item.

Bunny mapping: this validates the OD-1 direction — an AgentProfile object that
survives provider rerouting (identity ≠ provider), holding: display identity,
style/prompt persona, tool preferences, capability ceilings, mission
affinities. Octop's persona system proves style can sit **below** authority:
they render style into prompts and keep tool policy in separate middleware.

REJECT: MBTI-as-identity (16 fixed codes as the whole persona system), and
octop's "persona is just a system prompt" shallowness — Bunny needs persona
bound to behavior constraints (grants), not vibes alone.
Borrow: persona-as-data + rendered-into-prompt + no-runtime-persona-editing
(reproducibility), profile → workspace identity files seeding.

### 6.3 Expert sharing / resource pools (mechanism 3)

IMPLEMENTED (OCTOP): `is_shared` flag on agents (shared experts are
dispatch-eligible by team hosts but not configurable by them), published
expert repo with slug uniqueness and creator/admin mutation rights, teams may
include shared experts.

Verdict LATER for Bunny: today's Host is single-owner; sharing only makes
sense under multi-user option C (§14) and must ride the same actor-identity
design. Nothing borrowed now; the *shape* (dispatch allowed, configuration
not) is noted for the option-C design file.

### 6.4 Persistent per-agent workspaces + backend abstraction (mechanisms 4, 5)

IMPLEMENTED (OCTOP + HARNESS): per-agent workspace root `~/.octop/agents/
<agent_id>/`, created and seeded at agent creation; `BackendWorkspace` is a
facade over a resolved backend; the `agent-backend-file-io.md` doc records an
enforced campaign: **all content-file I/O goes through the backend protocol**
(no `Path.write_text` anywhere for content files), an explicit memory/
checkpoint/sessions exemption stays host-local, backups go through
`export_workspace_zip(backend)`. Harness ships 12 backend types
(filesystem/local_shell/composite/s3/postgres/cos/oss/obs/docker/
opensandbox/state/store). The docker backend: same-path-in-container, not
bind-mounted; `allow_network=false` default; agent/user/fixed scoping;
`close` does not destroy, explicit `destroy()` does. The Linux execute jail
routes through bubblewrap **only** when `virtual_mode` + non-host `root_dir`
+ bwrap present; degraded provisioning never blocks boot.

Bunny mapping (combines with OD-1 AgentWorkspace, no cwd-as-sandbox, no Job
Objects as filesystem isolation):

- Adopt: a narrow `BunnyWorkspaceBackend` read/write/list/glob interface so
  Bunny can later attach storage without changing tool code; per-mission
  workspace directories seeded with mission brief + artifacts pointers;
  content-I/O through the interface as a **lint-enforced rule** (their
  campaign doc is a good checklist Bunny should copy for its own audits).
- REJECT: 12 backends on day one; docker-sandbox-as-workspace; treating a
  storage backend as an execution boundary (Octop's own doc shows the seams:
  memory exemption, terminal PTY cwd stays local, compaction files land
  in-container when the workspace is remote). Execution isolation remains
  T4's job (OwnedProcessGroup / Job Objects), filesystem isolation is a
  workspace concern — the two must never be confused, which Octop handles by
  explicit exemption tables but Bunny must handle by design.

Future-acceptance criteria (OA-2): interface lands with one local backend and
a conformance test suite; every workspace write inside Bunny routes through
it (audited by lint); remote backends only after the exemption table (what
stays Host-local) is written down in the state-layout contract.

### 6.5 Octop Memory (mechanism 6) — and knowledge/RAG (7)

IMPLEMENTED (UPSTREAM LIB, sdist inspected): octop-memory is a standalone
engine — zero-dependency core, SQLite/FTS5 lexical recall, optional
PostgreSQL, optional model-assisted extraction/promotion, canonical `AtomCard`
facts with **evidence references**, entity pages, a namespace scope model,
recall with dedup + token budgets, portable export/import packages, adapters
(bridge, CLI, dashboard) so *other* hosts can share the same store.

Octop wires it as a service plus agent middleware; agent memory DDL is owned
by the package (not app migrations).

**Binding constraint (task §10):** no second memory authority. Bunny's
existing memory + T1 state stays sovereign.

REJECT as authority; accept as concepts:
- Evidence references attached to stored facts (provenance per atom).
- Explicit extraction → candidate review → promotion pipeline (facts are
  created deliberately, not silently).
- Recall token budgets and dedup (retrieval hygiene).
- Namespaced scopes separating stores.
- A portable export format as a *future feature of Bunny Memory itself*
  (not as a dependency).

Knowledge base / RAG (mechanism 7) at the pin: `infra/knowledge/` with
chunk/embed/index/retrieve/ocr/jobs, capability gating (requires a working
embedding provider before enabling), boot-time resume of pending index jobs,
and **machine-readable citation payloads** embedded in tool results
(`<octop-kb-citations>` marker; one citation per doc in retrieval order,
stripped from model context and shown in UI). Classification LATER: Bunny
has no KB surface; when one is proposed (OA-7) the citation-payload pattern
is the strongest single idea on this axis: retrieval never mixes unverifiable
content into authoritative state — results carry pointers, not trust.

### 6.6 Connector architecture (mechanism 8)

IMPLEMENTED (OCTOP): connector catalog (mostly Tencent-ecosystem services),
Fernet-encrypted credentials stored via `SecretRepo`, connection probing, a
custom-MCP gateway with tool caching. The Agently Mail connector doc is the
best-written piece of security design in the reference and worth reading as a
pattern source:

- Official CLI owns OAuth; Octop never holds or displays tokens.
- Per-connector-instance isolated workspaces (config + keychain namespace).
- **Two-phase confirmation** for destructive ops: first call runs dry-run and
  returns a confirmation token bound to instance+tool+args, 5-minute TTL,
  single-use; second call routes through HITL approval; only then does the
  gateway consume the token and execute.
- Cron and new-mail-triggered tasks are **forbidden** from send/delete tools
  regardless of model behavior.
- All upstream content (mail bodies, headers, attachment names) is wrapped in
  an explicit untrusted-data envelope.
- Quarantine staging files live outside the agent workspace.
- Watch triggers pass validated mail IDs only, never bodies-as-instructions.
- The CLI version is pinned (1.0.18).

Bunny mapping: connectors become capability-backed tools through the Bus with
per-connector grants + approval policy; credentials live in Bunny's
`credentials/` dir (stronger isolation than Fernet-in-DB); inbound connector
events enter as actor messages through Inbox → draft → approval. Borrow the
two-phase confirmation token design for future destructive connector actions
directly.

### 6.7 ACP, both directions (mechanisms 10, 11) — deep study per §12 of the task

**Inbound (docs/acp.md + harness ACP server, IMPLEMENTED HARNESS; app glue in
`api/routers/acp.py`, IMPLEMENTED).** Octop exposes an in-process ACP server
on stdio for IDE adapters: no authentication (stdio transport is assumed
private), session id → cwd is recorded but **not used** for execution (the
agent's own workspace is used), `load_session` restores thread checkpoints,
errors are returned as JSON-tagged text. The app layer only stores runner
config and toggles the `acp_runner` tool per agent. The `trusted` flag is
declared in the harness, **defaulted `true` in Octop's runner defaults**, and
**never read** by harness code at the pin — decorative safety theatre as
shipped.

**Outbound (`acp_runner` tool, IMPLEMENTED HARNESS).** This is the strongest
single subsystem in the reference:

- Per-runner turn lock; sessions tracked with pid + exit watcher.
- `permission_required` from the external agent **suspends the harness turn**
  (parked Future) and re-raises it as a HITL prompt; the human selection
  resumes with the exact option id; timeout leaves the session open.
- Hard-deny list in the ACP path: `rm -rf`, `//`, `mkfs`, `dd`, and paths
  outside cwd.
- Tool results capped (50 MiB stdio), protected env keys withheld, psutil
  tree-kill on cleanup.

**Bunny mapping (binding requirements, task §12):** Bunny's ACP story has two
shapes:

1. **Inbound** — a Bunny ACP adapter is a **new Inbox source**. It terminates
   at Host authority: authenticated actor → Inbox entry → mission or reply
   draft → approval path. It never yields a direct tool/execution line, never
   bypasses the Capability Bus, never reaches T4-owned process creation
   except through a Mission.
2. **Outbound** — an ACP adapter is a **capable provider behind BunnyRouter**:
   just another provider candidate with a T2 compatibility profile (which
   ACP verbs it supports), wrapped as a Task action. Every call carries its
   AuthorizationEnvelope; a `permission_required` from the external agent
   surfaces as a Bunny approval request on that task; the adapter's process
   is T4-owned (Job Object) with hard close; nothing in the ACP path may edit
   workspace files outside the task's workspace or run outside T4 ownership.

Non-bypass list (mandatory, restated): BunnyRouter stays the only provider
selector; compatibility policy is checked before first use; permission/
approval flow goes through the Host; workspace access stays inside the task's
AgentWorkspace; process ownership stays T4; outcomes are verified before a
task may close; every stop reconciles externally-running sessions (see 6.11).

REJECT: unauthenticated stdio inbound as a Bunny surface; the decorative
`trusted` flag as a safety mechanism; a timeout that leaves external sessions
alive and un-accounted (Bunny's stop/reconcile contract is stricter).

### 6.8 Browser automation (mechanism 12)

IMPLEMENTED (UPSTREAM LIB, sdist inspected): octop-browser 1.0.0 is a
Playwright session library with record/replay, persistent profile handling,
idle management, an MCP server surface, CLI, and action modules
(navigate/interact/capture/js_eval); Octop's `infra/browser/` is thin glue.

Verdict **ALREADY_HAVE** with a boundary note: Bunny's browser runtime
already exists and — unlike Octop's — sits behind a network fence
(checkingProxy with DNS resolution + private-network rejection on a single
shared persistent profile). Nothing to adopt into the runtime. The only
Octop idea worth keeping on a list Bunny already has: per-session profile
lifecycle design lives in the OD-1 future list (Bunny deliberately shares one
profile today; if per-session or per-profile isolation is ever proposed, the
fence must be re-proven per profile, not inherited).

### 6.9 Terminal AI (mechanism 13) and remote desktop (14)

**Terminal.** IMPLEMENTED (OCTOP): per-agent PTY (`api/routers/terminal.py`)
with cwd pinned to the agent workspace; harness shell runs commands via
`subprocess(shell=True)` under a YAML regex deny-list (block/warn/
require_approval modes), timeout as exit 124, stdio caps. The default shipped
policy is warn-only (see §8). Verdict **REJECT** as a Bunny mechanism: Bunny's
canonical execution surface is deterministic capability commands inside T4
ownership with T1 external state. A free-form model shell with a deny-list +
warn posture is strictly weaker than Bunny's capability model and is the
reference's weakest edge. (An operator-facing PTY console, humans only, no
agent authority — would be LATER, not now, and not the mechanism as defined.)

**Remote desktop.** IMPLEMENTED (OCTOP): `infra/desktop/` — mss screen
capture + pynput input injection, in-process session registry capped at 3
concurrent streams with per-user supersede, Linux X-session scripts. Verdict
**LATER**: Bunny's canonical path for controlling the machine is the Computer
Runtime with semantic, approval-gated, T4-owned actions. Raw capture/inject
would only ever be a special-purpose capability with a dedicated session
surface, recording, and explicit approval — and never the default control
plane.

### 6.10 Cron / background jobs (mechanism 15)

IMPLEMENTED (OCTOP): `CronManager` wraps APScheduler; jobs are DB rows
(name, prompt, target agent + session key, fresh-thread flag, model override,
enabled) with a delivery service decoupling scheduling from execution; run
outcomes are written back as status + audit events (`cron.run_ok/run_failed`
with error text); manual run-now; system jobs (TLS renewal) survive
restore-reloads; mail-watch triggers attach connector events to tasks.

Verdict **ALREADY_HAVE**: Bunny's approval-gated triggers already cover the
scheduling entry point with the correct authority shape (Octop's cron has **no
approval gate** at creation — anyone logged in schedules an agent that runs
with its full toolset; Bunny's triggers require approval).

Borrow-list (small): run-status bookkeeping written back to the row + audit,
"fresh thread vs continue session" choice, timezone-explicit schedules. All
fit inside Bunny triggers as observability additions, not a new scheduler.

### 6.11 Conversation checkpointing + restart/recovery (mechanisms 19, 20)

IMPLEMENTED (OCTOP): LangGraph checkpoints per thread (Postgres or SQLite),
auto-compaction archives evicted originals to
`conversation_history/<session>.md`; at boot: cron reloaded from DB, pending
knowledge index jobs resumed, bridge connections auto-resumed, stale logs
purged. Conversely: the peer inbox is memory-only (restart loses queued
member work), `TeamJobTracker` resets, and a mid-turn process death leaves
the turn lost — the session resumes from last checkpoint.

Verdict **ALREADY_HAVE** (both): Bunny's journal-based canonical state, the
no-blind-replay rule, interrupted → inspect/reconcile → explicit retry, and
T3's classification-driven recovery are stricter and stay.

The single borrowable idea: eviction-archival on compaction — when Bunny
 ever compacts long task contexts, the evicted original becomes a T1-class
artifact file, never a lossy overwrite. Recorded for OA-7.

### 6.12 Approval / security model + guardrails + PII (mechanisms 21, 22, 23)

IMPLEMENTED (HARNESS, with app glue): a `SecurityPolicy` object persisted in
the settings table; middleware tool guard with YAML rule files (bundled
catalog + validation + on-disk store under `~/.octop/security/tool_guard/`);
filesystem guard (glob-deny); PII middleware at the model boundary; a HITL
interrupt pipeline (`permission_required` → dashboard → resume with exact
option ids via the one SSE endpoint kept for this purpose); per-thread HITL
bypass (ask / allow_all / allow_tools — Codex-style; `ask_user_question` is
never skipped).

Verdicts: 21 → ALREADY_HAVE core (Bunny's per-mission AuthorizationEnvelope
+ Bus admission + T5 private-reasoning-withholding are stronger and
mission-scoped), ADAPT two shapes: the **machine-readable rule catalog with
validation** (if Bunny ever exposes deny-rules as data, an auditable catalog
with a validator is the right shape) and **structured permission-required
resume with option ids** (maps directly onto Bunny approval options).
22 → ADAPT (concept only; see row 22 in the ledger). 23 → ADAPT: Octop
redacts at the model boundary; Bunny redacts at the capability boundary.
Keep the capability boundary; the reference's lesson is *defense in depth*
— if results flow to surfaces, result-level redaction awareness is a later
hardening item, not a replacement.

### 6.13 Multi-user / JWT authorization (mechanism 16)

IMPLEMENTED (OCTOP, deep): JWT + argon2; `agents.user_id` row ownership with
admin bypass enforced in the global registry; per-user session keys;
login captcha options; LDAP, OAuth, OIDC login routers; invites; user roles;
first-run wizard seeds an admin (password auto-generated to a file when
unset); default deployment binds `0.0.0.0` (their hardening doc puts the
burden on the operator). Channel identity is per-platform user id per
adapter, **separate** from Octop user identity.

Per task §20, Bunny studies this **without** automatically recommending it.
Options:

| Option | Shape | Assessment for Bunny |
|---|---|---|
| A | Single user (current) | Canonical today; zero change |
| B | Owner + trusted devices (current pairing model) | Canonical and sufficient; keep **paired-device ≠ identity** so option C can land later without re-pairing semantics |
| C | Household profiles (few known actors, capability ceilings) | Plausible future; requires per-actor identity at Inbox, per-actor grants, T5 rendering per viewer; only after OA-2/OA-3 exist |
| D | Full tenancy (Octop's shape: row ownership + admin bypass + JWT) | REJECT for Bunny: it converts the Host from "one owner's local control plane" into a multi-operator server — a different product with different threat model (Octop's own SECURITY.md assigns host exposure to the operator) |

The reference's lesson taken in full: whatever identity exists (even just
actor labels for paired devices), session/channel identity must resolve to it
server-side, ownership must be a single enforced choke-point (Bunny's Host),
and admin/debug powers must be explicit, not ambient.

### 6.14 Channels + desktop client (mechanisms 17, 18) and single-process Host (24)

**Channels.** IMPLEMENTED (OCTOP, upstream lib octop-gateway + adapters:
feishu/wecom CLI adapters, qq_mail, plus a documented Discord adapter):
per-channel allowlists, server-channel responses gated on explicit @-mention,
webhook/bot messages ignored, per-channel/thread session isolation, restart
without duplicate replies, proxy support, attachment caps. Verdict **LATER**:
Bunny's eventual IM surfaces enter only as **authenticated actor sources**
into Inbox → draft → approval (never direct mission authoring), which is
exactly the pattern Octop's allowlist/mention rules already implement — a
good borrow at design time.

**Desktop client.** ALREADY_HAVE: Bunny ships the WPF Island and Android
companion; Octop ships the built SPA + CLI + WS chat with mid-turn controls.
Design note only: Octop's WS contract lets the client send slash/compact
mid-turn — relevant later to Island UX, zero mechanism content.

**Single-process Host.** ALREADY_HAVE: Octop's ADR-001 "one process, no
external queue" matches Bunny's Host topology; Bunny strengthens it with T3
containment and T4 ownership (Octop has neither: a runaway member thread
holds the process; child shells outlive scope unless psutil kill runs). Keep
Bunny's containment; the shared lesson is avoid external infra as a
correctness dependency.

---

## 7. Security comparison (task §21) — where Bunny is stronger, weaker, different

| Axis | Bunny-A (pinned) | Octop (pinned) | Call |
|---|---|---|---|
| Execution authority | Deterministic capability commands; T4 OwnedProcessGroup/Job Objects; hard stop | Model-driven shell via `shell=True` + middleware; PTY per agent | **Bunny stronger** |
| Stop semantics | T4 kill via job close, no pid/name kills; every stop reconciles | Coordinator-only cancel; member work continues; ACP timeout leaves sessions open | **Bunny stronger** |
| Recovery of interrupted work | Journal; interrupted → reconcile → explicit retry | Best-effort boot resume; inbox lost | **Bunny stronger** |
| Approval default | Approval-gated by design (envelope + Bus) | HITL **disabled** out of box; tool guard default **warn**; per-thread bypass available | **Bunny stronger** |
| Network posture for agent-controlled browsing | checkingProxy DNS + private-network fence | Playwright direct (profile lib provides no fence) | **Bunny stronger** |
| Credential storage | `credentials/` host dir, host-scoped | Fernet-in-DB (SQLite/Postgres) | **Different** (Bunny's is tighter-scoped; Octop's survives DB restore better) |
| Two-phase destructive confirmation | Not yet (none needed yet) | Mail connector token-bound dry-run+confirm, single-use, TTL | **Octop idea to borrow** |
| Structured approval resume | Bunny approval options (UI-level) | Protocol-level option ids, parked-future resume | **Octop idea to borrow** |
| Identity/authN | Loopback + pairing (device-attested) | JWT+argon2, LDAP/OAuth/OIDC, row ownership; **binds 0.0.0.0 by default** | **Different** (Octop's is richer for tenancy; Bunny's is the right shape for a local control plane) |
| State/provenance | T1 canonical external state | Checkpoints + memory w/ evidence refs + KB citations | **Different** — Octop has the better *provenance* ideas, Bunny has the better *state machine* |
| Guardrail expressiveness | Capability design (no arbitrary shell) | YAML rule catalog + validation, FS glob-deny | Different tools, same goal; the rule-file shape is borrowable |

Honest Octop strengths acknowledged: the mail connector hardening doc, the
ACP outbound suspend/resume protocol, boot-resume of pending background jobs,
the backend-strictness campaign doc, and the evidence-reference memory
schema. Honest Octop weaknesses Bunny must not copy: warn-only default guard,
HITL-off default, decorative `trusted` flag, unauthenticated inbound ACP,
memory-only inbox, and `0.0.0.0` bind defaults.

---

## 8. Restart/recovery comparison (task §22)

| Aspect | Bunny-A | Octop | Borrow? |
|---|---|---|---|
| Canonical state | Journal + SQLite (T1) | LangGraph checkpoints + control-plane DB | No (Bunny's is explicit) |
| Unknown external effects | Inspect world-state → reconcile → explicit retry | Not modeled; last checkpoint only | No |
| Scheduled work | Approval-gated triggers | Cron rows + audit + status write-back | Status bookkeeping only |
| Queued peer work | Mission lanes (journal) | Memory-only inbox, lost on restart | No — do exactly the opposite |
| Compaction | Not implemented yet | Evicted originals archived to a file | Yes (as T1-compatible artifact, later) |

---

## 9. Code reuse assessment (task §23)

License posture: repository and all four pinned packages ship MIT license
texts. Every reuse class below carries: **source file, pinned commit,
license, required modification.**

| Class | Verdict |
|---|---|
| IDEAS_ONLY (do not port; document the idea, reimplement Bunny-native) | Nearly everything — Bunny is TypeScript/Node on a different composition model; ideas are listed per-mechanism above |
| PORT_WITH_MAJOR_ADAPTATION (port algorithm/schema with rewrites) | None required today. If OA-3 (ACP) proceeds: follow the **agent-client-protocol 0.11.0 wire spec** (the library Bunny would use), not Octop code; the only algorithmic content worth translating is the permission-required suspend/resume flow (harness acp_runner behavior spec, MIT) |
| SAFE_TO_PORT | None. Even small artifacts (the citation marker format, guard-rule YAML schema, `.hmpkg` container) are data formats where copying would couple Bunny's formats to an upstream that may change them without notice; Bunny should define its own shapes, informed by these |
| DO_NOT_PORT | All execution-path code: harness shell/PTY/backends, gateway adapters, desktop capture/inject, memory engine, teams runtime — wrong language, wrong authority model, wrong containment expectations |

Per-idea provenance (source → pinned commit `eb28011`…, MIT, file):

- Peer dispatch/callback discipline — `src/octop_harness/teams/` +
  `docs/expert-teams.md`, MIT — reimplement in MissionManager.
- In-flight ledger concept — `src/octop/infra/agents/teams/jobs.py`,
  MIT — journal-backed redesign mandatory.
- Permission suspend/resume — octop-harness acp_runner, MIT — spec
  translation into Bunny approval flow if OA-3 proceeds.
- Two-phase confirmation tokens — connector Agently Mail design
  (`docs/connectors-agently-mail.md`), MIT — Bunny-native token store in
  state, required for any future destructive connector tool.
- Boot resume of background jobs — `src/octop/infra/server.py`, MIT — Bunny
  equivalent is trigger/mission journal reconciliation (mostly already
  there).
- Eviction archival — harness compaction behavior, MIT — future, inside
  Bunny memory/task artifacts.
- Citation payload marker — `src/octop/infra/knowledge/citations.py`, MIT —
  future KB (OA-7) format inspiration, Bunny-defined schema.

The "required modifications" column is in every case: reimplement Bunny-native
under Host authority; no upstream imports; formats Bunny-defined.

---

## 10. Adoption plan (task §25) — workstreams OA-1 … OA-8

Task asked for OM-1…OM-8-style workstreams **grouped by evidence**; grouped
into four groups. Names adjusted where evidence supports a different shape
than the brief assumed. All are future work; **none is authorized by this
report** — each needs its own proposal + acceptance, and none may start from
an M-A-2 turn.

**Group 1 — identity & workspace foundation** (prerequisite for most of the
rest)

- **OA-1 AgentProfile** (from mechanisms 2, 3): identity object surviving
  rerouting; style/persona as data; capability ceilings per profile;
  no runtime persona editing without state write. Acceptance: a mission can
  name a profile; provider rerouting preserves the profile verbatim.
- **OA-2 AgentWorkspace + BunnyWorkspaceBackend** (mechanisms 4, 5, parts of
  8): per-mission workspace directories seeded by the mission; narrow backend
  interface with one local implementation and conformance tests; content-I/O
  through the interface enforced by lint; exemption table (what stays
  Host-local) written into the state-layout contract. Acceptance: all
  workspace audits pass with zero direct file writes outside the interface.

**Group 2 — authority-preserving surfaces**

- **OA-3 ACP adapters, both directions** (mechanisms 10, 11): inbound =
  authenticated Inbox source terminating at Host authority; outbound = a
  BunnyRouter provider behind T2 compat profiles, Task-scoped, T4-owned
  process, permission-required surfaced as Bunny approvals, stop reconciles
  external sessions. Acceptance must include: an ACP session cannot create a
  task, spend a grant, or touch a workspace outside its mission.
- **OA-4 Mission staffing** (mechanism 1): coordinator-style dispatch as a
  MissionManager state concept; lanes as TaskManager tasks; journal-backed
  in-flight ledger; mission-stop accounts all lanes. Explicitly not a second
  orchestrator: MissionManager composes the coordinator, the coordinator has
  NO state authority.

**Group 3 — reachability**

- **OA-5 Connector/channel posture** (mechanisms 8, 17): connector tools
  through the Bus with per-instance grants; two-phase destructive
  confirmation; channels as authenticated actor sources into Inbox;
  credentials isolated per connector. Acceptance: no connector path yields
  tool authority without a grant; destructive mail/file actions require the
  token-confirm-approve triple.
- **OA-6 Platform boundary study** (mechanisms 3, 14, 16): the A–D analysis
  recorded; remote-desktop LATER conditions written down; sharing/tenancy
  designs kept out of code until an option is chosen. Acceptance: a design
  document, no code.

**Group 4 — knowledge & hygiene**

- **OA-7 Knowledge, citations, guard-rule catalog, eviction archival**
  (mechanisms 7, 19, 22): Bunny-defined citation schema, gate before enable,
  provenance-first retrieval; optional guard-rule data-file shape with
  validator; eviction archival inside memory/task artifacts.
- **OA-8 Memory concepts review** (mechanisms 6, 23): inside Bunny's existing
  memory (no second engine): evidence references on facts, scope names,
  extraction→review→promote pipeline, recall budgets; capability-boundary
  redaction retained with result-level redaction noted as future hardening.

Dependency order if adopted someday: OA-1 → OA-2 → (OA-3, OA-4) → OA-5 →
OA-6/OA-7/OA-8. OA-6 has no code dependency and can be written any time as a
doc.

---

## 11. M-A-2 preservation (task §26)

This study modified nothing. Explicitly preserved, verified by the pin and by
no-op execution:

- T6 record unchanged: **BUNNY_MA2_T6_FAIL**; no reclassification.
- No runtime change, no release activated, no production state touched, no DB
 /schema change (no new migration, no state-layout edit), no permission/
  tunnel/pairing change, no Mission flag change.
- No second MissionManager, TaskManager, scheduler, permission engine, or
  event journal exists in Bunny because of this study.
- octop-harness (or any Octop package) was **not installed** into Bunny; all
  Octop artifacts live outside the repo in the disposable research scratch.
- BunnyRouter and the Capability Bus untouched; T1–T5 guarantees untouched.
- Working tree after study: only this new report file, plus the three
  previously-untracked reports that predate OCT-1.

---

## 12. Final verdict (task §27)

**BUNNY_OCTOP_REFERENCE_ACCEPTED_WITH_NOTES**

Meaning (exactly): Octop at pinned commit `eb28011249…` is an accepted
architectural reference for Bunny-A. The notes are the binding constraints
already stated above and repeated as one list:

1. MissionManager stays the sole Mission orchestration authority.
2. No second memory authority; no second scheduler; no second permission
   system.
3. ACP — any direction — terminates at Host authority; never bypasses
   BunnyRouter, compatibility, permissions, workspace, approval, process
   ownership, or verification.
4. Connectors/channels never grant agent authority directly.
5. Plugins are not adopted; Skill Library + Bus remain the extension
   surface.
6. Execution stays deterministic-capability + T4-owned; no `shell=True`
   surface, no model-driven PTY authority.
7. Browser keeps its network fence; do not import Octop browser posture.
8. Out-of-box Bunny defaults stay approval-on and deny-by-default where
   Octop ships warn-only/off.
9. All adoption is IDEAS_ONLY; no upstream code, formats, or packages enter
   Bunny.

This verdict is not runtime acceptance, not implementation approval, and not
M-A-2 acceptance. T6 remains FAIL.