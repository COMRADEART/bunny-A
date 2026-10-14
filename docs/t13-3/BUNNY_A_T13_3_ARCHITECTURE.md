# Bunny A MA3 T13.3: architecture and gate record

Status: **in progress**. Gate A is complete and Gate B is implemented. Gates C–I have not started. No verdict is issued until Gate I.

## Gate A: baseline

| Fact | Observed (2026-10-13) |
|---|---|
| Branch | `claude/ma3-t9-phone-remote` |
| Checkout HEAD | `08e53df` — T13.2 evidence seal (docs/evidence only on top of the source) |
| Accepted T13.2 executable source | `2ea9bd497830334190c20fa2867363368d965ce4`, ancestor of HEAD (`git merge-base --is-ancestor` exit 0) |
| `2ea9bd4..08e53df` | 180 files, all under `test-results/ma3/t13-2/` plus the acceptance report: no executable change |
| User-owned work | Modified `.gitattributes`, `.gitignore`, `package.json` (session-evidence script); untracked `.claude/`, `docs/lokam/`, `tests/`, review notes, PKCE drafts. None of these is touched or included by T13.3, except that Gate B appends its two test files to the `test` script line in `package.json`; the user's own uncommitted lines there are left as they were and the file is committed only with that hunk |
| Prior acceptance | 2,364 distinct tests (scripts 440, library 1,501, Agent 58, UI 365), 485-file Windows manifest, 13 packaged Host checks. These are T13.2 results and are not counted as T13.3 evidence |

## Existing authority map (reused, not duplicated)

| Concern | Single owner in the source | T13.3 rule |
|---|---|---|
| Execution authority, admission, containment | Windows Host: `manager.server.ts` (TaskManager), `owned-process-group.server.ts`, `execution-scope` | Every new worker and harness dispatch goes through it |
| Workflow / Mission graph | `bunny-missions/manager.server.ts` (MissionManager), `machine.ts`, `planner.server.ts` | Personal Agents submit Missions here; no second MissionManager |
| Durable Agent continuity | `agent-runtime.server.ts`, `agent-store.server.ts`, checkpoints, recovery claims | A Personal Agent *owns* AgentRuntime Agents; it is not a new runtime |
| Model/resource eligibility | `router.ts` `bunnyRoute` + `orch/router.ts` (BunnyRouter), `routing.server.ts` | Session scheduler (Gate F) feeds facts into BunnyRouter; it never picks a route itself |
| Accounts, consent, billing pins | `connections.ts` / `connections.server.ts` (T13.2) | Unchanged; every failover re-validates the exact destination pin |
| Advice | `laya.server.ts`, `typesafe-jev.server.ts`, `intelligence.ts` (T13.1) | Advisory only; never grants permission |
| Team members / bounded roles | `bunny-missions/team.ts`, `team-coordination.server.ts` (T11) | Basis for Gate D dynamic workers; roles stay non-authoritative |
| Mission memory | `bunny-missions/memory.server.ts` (mission-scoped, verified-only context) | Lotus (Gate C) layers on top; provider conclusions stay unverified |
| Presentation | `personal-agents.ts` (four slots, Host-derived states), `character-model.ts`, `characters.tsx/css` | Styles (Gate H) are a presentation field only |
| Voice | `voice/*` (T10–T12 duplex, turn-taking, intents) | Foreground speaker selection must not touch Mission state |

## Identity model decision

T13 made the **slot** (1–4) the durable Personal Agent identity and the weapon its face ("a weapon is a face, not an assignment"; the Studio can swap faces). T13.3 keeps that contract so that no accepted T13 test is weakened:

- A Personal Agent = one slot. It is addressed by its current weapon name ("Gada") or display name.
- The slot's `agentId` stays the *focused* AgentRuntime Agent drawn in the Notch.
- **New in Gate B:** an ownership ledger lets one Personal Agent own any number of AgentRuntime Agents (each with its own Mission). An Agent has at most one owner (primary key on `agent_id`). Binding a slot's focus to an Agent records that slot as its owner (an explicit workstation action, journaled as a transfer if it had another owner).
- Swapping weapons between slots moves faces, not ownership, memory or conversation.

## Gap analysis against T13.3

| Requirement | Present at baseline | Gap |
|---|---|---|
| Four outward identities | Exactly four slots/weapons, validated | None |
| Multiple long-running Missions per Agent | One focused Agent per slot | Ownership ledger (Gate B) |
| Per-Agent personality, goals, preferences, conversation history | Name/description/purpose/interaction style only | Profile + bounded conversation store (Gate B) |
| Direct conversation using the Agent's own state | Voice answers about *all* agents | Per-Agent factual answers scoped to owned Missions (Gate B: text, and voice status for the foreground Agent); spoken addressing by weapon name not implemented |
| Foreground speaker vs ownership | Not modelled | Separate persisted foreground identity (Gate B) |
| Lotus layered memory, Agent/Project scoping, poisoning protection | Mission-scoped memory only | Lotus store, scoped recall, trust ceilings, correction, compaction, export/forget, scoped share (Gate C); no model prompt reads it yet |
| Dynamic bounded child workers with lifecycle | Fixed T11 role catalogue | Workers as child Missions with eligibility, budgets, Host-only verdicts, cancellation, catalogue and reviewed composed abilities (Gate D); model-backed abilities not run live; Part F planning additions not implemented |
| Harness Manager (detect/install/test) | T13.2 detection and native dispatch for Codex/Claude/Ollama only | Gate E |
| Active-session ledger, quota-aware failover | Provider usage windows, connection caps, reservations | Session dimension + failover protocol (Gate F) |
| Evaluation-gated routing changes | Policy candidate/promote, verified-only learning weights | Shadow test and versioned rollback (Gate G) |
| Five character styles | One art set, weapon-specific motion | Gate H |

## Gate plan (in order; a gate is complete only with executed evidence)

A baseline/contracts → B persistent Agents → C Lotus → D delegation → E harnesses → F session routing → G feedback → H styles → I end-to-end, full regression, Windows package, independent review, production preservation.

## Gate B contract (implemented)

Source: `src/lib/bunny-host/personal-agent-context.ts` (pure) and `personal-agent-context.server.ts` (store). Additive tables `personal_agent_ownership`, `personal_agent_profiles`, `personal_agent_turns`, settings key `personal_agent_foreground`, migrations key `bunny-a.personal-agent-context.v1`. No existing table, row or `user_version` changes.

Workstation-only Host commands (paired devices are default-denied and the context projection is stripped from device snapshots):

| Action | Effect | Never does |
|---|---|---|
| `personal_agent.delegate` `{slot, objective, …agent.create fields}` | Creates the Agent/Mission through the existing `agent.create` admission, then records the slot as owner; focuses it when the slot had no focus | Start, approve or route work |
| `personal_agent.assign` `{slot, agentId}` | Records/transfers ownership of an existing user-facing Agent | Touch the Agent or Mission row |
| `personal_agent.profile` `{slot, personality, goals, preferences, expectRevision}` | Saves explicit, user-authored context; refuses credential-shaped text and stale revisions | Store inferred facts |
| `personal_agent.foreground` `{identity: "bunny" \| 1–4}` | Chooses who answers | Pause, stop, transfer or cancel anything |
| `personal_agent.converse` `{slot, text}` | Records the user turn and a reply built only from that slot's owned Agents/Missions (Host facts, never a model guess) | Read another slot's context; claim progress that is not recorded |

Restart: ownership, profiles, turns and the foreground identity persist in the Host SQLite file; Agent/Mission states come from the existing AgentRuntime recovery walk, which never marks interrupted work complete.

Studio rebinding (`personal_agents.configure`) records the new focused Agent as owned by that slot, so focus and ownership never disagree; moving an Agent to another slot is an explicit, evented transfer.

Voice: when a Personal Agent is the foreground speaker, the voice "status" intent answers from that Agent's own Missions (same `answerFromOwnFacts` text) through an optional `personalStatus` port; with Bunny in the foreground the T12 answer is unchanged. Spoken addressing by weapon name ("Gada, …") is not implemented; choosing the speaker is done in the Studio.

Surfaces: Studio "Talk to your Agents" (speaker choice, per-Agent history, message box; a working count only for PLANNING, RUNNING, VERIFYING or WAITING_FOR_DEPENDENCY). Recent Missions and the Studio "Other agents" list read the ownership ledger, so an owned Mission shows its Personal Agent even when it is not the slot's focused Agent; only the focused Agent's Mission borrows the slot's live presentation state.

Limitation (explicit): Gate B replies are deterministic Host-fact answers, not model-generated persona dialogue. Personality text is stored and projected for later model-backed conversation (with Lotus retrieval, Gate C); it does not yet alter wording.

## Gate C contract (implemented)

Full contract: `LOTUS_AGENT_MEMORY_CONTRACT.md`. Source: `lotus.ts` (pure rules), `lotus.server.ts` (`LotusStore`; additive tables `lotus_memories`, `lotus_revisions`), Host wiring in `http.server.ts`, Studio panel `memory.tsx`.

- Scopes come from the ownership ledger: an Agent reads `agent:<slot>` plus `project:<id>` for Projects where it owns a Mission. With a `projectId`, recall returns that Project only — the slice Gate D workers will receive.
- Verified Mission facts and user decisions are read in place from the existing Mission memory as inner-petal sources; Lotus never copies or owns them.
- Trust ceilings (user/host → central, model → outer, untrusted → bud), steering-text downgrade, user-only promotion of model or outside text, credential refusal, user-correction precedence in ranking.
- Gate B's `appendTurn` now returns the turns it drops; the Host folds them into a versioned `Earlier conversation` summary (`host:summary`, sources = turn ids).
- `personal_agent.converse` appends up to three rendered memories under "From memory:". Replies stay Host facts.
- Workstation-only `lotus.remember / correct / promote / forget / export / share / recall`; devices are refused and the memory projection is stripped from device snapshots.
