# MA3_BASELINE — M-A-3 Gate T0: Real Baseline

**Milestone:** M-A-3 — Agentic Operating Layer / Product Completion
**Gate:** T0 — establish the real baseline before any implementation
**Produced:** 2026-10-07 (America/New_York; UTC timestamps used throughout)
**Producing session:** Claude Code (model: GLM via OpenRouter), the implementation owner's session — this document is the builder's T0 gate record, **not** any operational or independent review verdict
**Branch:** `ma2-operational-hardening`
**HEAD at inspection:** `e0735d489d43c74955cf0370777c34b2339358a4` ("Complete MA2 R1.1 authorized activation and production acceptance")

## 0. How this baseline was established and what it may claim

- **Production identity is never inferred from Git HEAD.** It is taken from canonical primary sources on disk, cross-verified across four independent documents (install.json → operations/current.json → operations/identity-latest.json → MA2_FINAL_REMEDIATION_R1_1.md) and byte-verified release-directory material.
- `operations/identity-latest.json` (recordedAt 2026-10-07T18:56:14Z) is the **last live corroborated identity capture**. It is a snapshot, not live state: "Saved PID snapshots are audit evidence only" (MA2_INDEPENDENT_REVIEW_PACKET.md:8). §3 of this report records it as history; §4 records what was actually observed live at inspection time.
- No production process was started, stopped, restarted or mutated by this inspection. Nothing was committed or pushed. Everything written this session is additive documentation/evidence under the T0 gate.
- Evidence classifications used: **LIVE VERIFIED** (this session, on this machine), **STATIC VERIFIED** (read from disk/report with consistency checks), **FROM-REPORT** (recorded by an accepted prior document this session did not re-verify), **NOT TESTED** / **UNKNOWN** (never claimed).

---

## 1. Repository

| Item | Value | Class |
|---|---|---|
| Path | `C:\Users\allam\Documents\new\bun-router` | LIVE VERIFIED |
| Branch | `ma2-operational-hardening` | LIVE VERIFIED |
| HEAD | `e0735d489d43c74955cf0370777c34b2339358a4` | LIVE VERIFIED |
| Tracked tree status | clean (no modified/staged tracked paths) | LIVE VERIFIED |
| Untracked material | `BUNNY_OPENDOTS_ADOPTION_REPORT.md`, `MA1D_FINAL_INDEPENDENT_REVIEW.md`, `MA1_CLAUDE_FINAL_REVIEW.md`, `MA2_FINAL_INDEPENDENT_REVIEW.md`, `memory/` | LIVE VERIFIED |
| Project scaffold | `package.json` name `app-builder-workspace` — Bunny-A host/mission code layered on a Grok app-builder (TanStack Start/Vite) template; `AGENTS.md` from that template ("Export from Grok" `eae148b`) is **stale and non-operative** for Bunny-A host work (recorded as discrepancy D5) | STATIC VERIFIED |
| Fingerprint note | `MA2_FINAL_INDEPENDENT_REVIEW.md` hashes to `2ac061dda6f07d86236c1c648ec738d363cb9b701e148b17c7755d5653f57d3a` — exact match to the SHA cited by R1.1. Verified twice independently this session (Get-FileHash + sha256sum). The value is **not self-recorded inside that document**; the byte-identity claim is corroborated externally as of 2026-10-07. | LIVE VERIFIED |

Rule upheld: untracked user-authored review material was **not** committed, moved, or rewritten (MA2 preservation discipline; the FAIL review must remain byte-identical).

## 2. Git / remote topology (drives §27 reconciliation)

| Item | Value | Class |
|---|---|---|
| Remote `origin` | `https://github.com/COMRADEART/router_agent.git` | LIVE VERIFIED |
| `origin/main` | `15881638935d58a3e7b3abee81bbef5bebc26319` (advanced mid-session by merge of PR #2 from `ma0` = `b04f4795c78a5d0bf87ccfec85800a2f598252f8`); `refs/pull/1/head` = `33723ee0d3992203bc4951cee76d32ff6df3935a` | LIVE VERIFIED (post-fetch) |
| Local `main` | `ea0e803`-lineage; **11 behind** `origin/main`, 0 ahead → clean fast-forward is possible | LIVE VERIFIED |
| Merge base of HEAD vs origin/main | `ea0e803` | LIVE VERIFIED |
| Unpushed commits | **`origin/main..HEAD` = 103** on `ma2-operational-hardening` (contains all of MA1 + MA2 and both v26 production pins `8001d51`, `0d3f96d`) | LIVE VERIFIED |
| `ma1-live-acceptance` | local-only branch, 15 commits ahead of origin/main, **not on remote** | LIVE VERIFIED |
| Commits since the FAIL-review freeze | The immutable independent review froze HEAD `deb83e80443759fb02abd351d72033aa982a7303`; current tip is **6 commits ahead** (`8001d51` IR-H1 fix → `0d3f96d` v26 tooling pin → `8762a02` → `4a4f410` → `1b5c9c3` → `e0735d4`) — the review documents a historical snapshot, not current HEAD | STATIC VERIFIED |
| Pushes | **None performed.** §27 synchronization plan lives in `MA3_GIT_RECONCILIATION.md` and requires separate authorization | — |

## 3. Production release identity (canonical; NOT from Git HEAD)

Release **Bunny-A-Windows-v26-MA2-R1**, version **26.0.0-MA2-R1** — selected/installed/activated 2026-10-07 under R1.1 with implementer acceptance (`BUNNY_MA2_FINAL_REMEDIATION_R1_1_PASS`, implementer-only; fresh independent operational review **still outstanding** — §43 honored).

| Fact | Value | Primary sources cross-verified |
|---|---|---|
| Source commit | `8001d51d871f12c15b8de03005a40e9d4c3fd8c2` | install.json · operations/current.json · current-ops procedure · R1.1 report · git log (`8001d51` is a real commit on this branch) | LIVE/STATIC VERIFIED |
| Tooling commit | `0d3f96db093b2106ebab90e0249ae7b1e711aee9` | same four sources · git log (`0d3f96d` is a real commit on this branch) | LIVE/STATIC VERIFIED |
| Manifest SHA-256 | `06836b4847824edcbfa4c1628b4e0106c5ccded24a8d9361355003f467339e54` | install.json · current.json · R1.1 | LIVE/STATIC VERIFIED |
| ZIP SHA-256 | `3e68faed3e1d9ae75d1d3f2140c831e8843fc914ea7dc179e78c81445f7fbac3` | install.json · current.json · R1.1 | LIVE/STATIC VERIFIED |
| Release folder | `C:\Users\allam\AppData\Local\Bunny-A\releases\Bunny-A-Windows-v26-MA2-R1` (exists on disk) | LIVE VERIFIED |
| Host HTTP port | **43119** (loopback-enforced in source) | install.json · source | LIVE/STATIC VERIFIED |
| Candidate bytes | `candidateBytesUnchanged: true`; external-ownership corroboration commit `1b5c9c3d6c90e04d09cc0a8dbb3da484d82f0962`; installed guarded installer/preflight/manager/process-tree SHA256s recorded in `operations/current.json`; all pre-R1.1 rollback guides/controllers marked **HISTORICAL — NOT VALID** (retained, never rewritten) | STATIC VERIFIED |
| Previous releases retained | v16, v17-T1, T3, T5, T6 (T6 = `cb005ef7…` source, `90a6e8da…` tooling, manifest `f5bf648c…`) + rollback dir `20261007-131105-18e676d2` | install.json (FROM-REPORT/LIVE) |
| Startup | `Startup\Bunny-A.lnk` shortcut (native selection) | install.json (STATIC VERIFIED) |

**Last live-corroborated identity** (`%LOCALAPPDATA%\Bunny-A\state\operations\identity-latest.json`, recordedAt **2026-10-07T18:56:14Z** = 14:56:14 local): healthy 5-role set — **Host PID 41876** instance `63418ecd-1aa9-40f1-ad79-e56c995f38bf`, gateway PID 22256, application (Bunny Island) PID 29976, tunnel-worker PID 24772, cloudflared PID 17440 (`tunnel --no-autoupdate --url http://127.0.0.1:8084`), plus 4 corroborated conhost children (console-lineage rule: held handles, current births, System32 image — identity output is **never Stop authority**).

## 4. Live production state at inspection — **SELECTED BUT NOT RUNNING**

Inspection window: **~15:45–15:55 local (≈19:45–19:55Z), 2026-10-07** — immediately after the last healthy capture above.

- **Zero production-role processes or listeners found.** No Host, no gateway, no Island app, no tunnel worker, no cloudflared; **nothing listening on 43119 or 8084**. `Get-Process -Id 41876` returns nothing. No process in any scan carries a path inside `%LOCALAPPDATA%\Bunny-A\releases\`.
- Event-timeline reconstruction from the production DB (read-only census; exact rows below):

| When (UTC / local) | Record | Source |
|---|---|---|
| 18:21:48.870Z / 14:21:48 | `audit.command` + `mission.configured` + `mission.stopped` + **`host.operation_failed`** | events tail (census) |
| 18:20 local | last `release-launch.log` entry (Host launch logging) | release-launch.log |
| 18:56:14.545Z / 14:56:14 | healthy identity capture (5 roles corroboration) | identity-latest.json |
| 19:20:48.050–19:21:20.586Z / 15:20–15:21 | `provider.status_changed` ×~4 (opencode, cline, cursor) + provider `probed_at` rows | census |
| 19:30:53.232–19:31:55.092Z / 15:30–15:31 | `provider.status_changed` + probes (codex, claude, ollama) | census |
| 19:31:55.470Z / 15:31:55 | **Last event in the production DB** (`provider.status_changed`); `host.sqlite-wal` mtime 15:31 local | census |
| ≈19:45–19:55Z / 15:45–15:55 | **No production processes found** | process inventory |

**Conclusion:** something with production-DB access (best hypothesis: the production Host itself) was alive and probing providers at 19:20–19:31Z (~25 min *after* the last healthy identity capture) and had **exited before my scan** — with **no shutdown record in release-launch.log, no failure-ledger entry beyond 14:21, and no surviving log**. The exit was a hard stop by an actor **UNKNOWN**; the 15:20–15:31 local probe writes are **unexplained** (they may simply be the same Host's routine registry probes, but their writer identity and the exit are NOT ESTABLISHED).

**Dispositions taken this session (recorded honestly):**
- Production was **not** restarted, touched or otherwise mutated — restarting the production Host is a production operation requiring explicit authorization (§42; MA2 discipline).
- Impact assessment (current census only — no capability grants, no permission requests pending, no triggers, no workspace locks, Missions OFF): the probe writes are provider metadata/status telemetry; no authority-bearing state changed. Classified here as telemetry-only **on the implementer's read, subject to the fresh independent review**.
- The anomaly is logged as discrepancy D2/D3 and carried into the fresh independent re-review packet (§43 obligation stands).

## 5. Canonical state

| Item | Value | Class |
|---|---|---|
| Root | `C:\Users\allam\AppData\Local\Bunny-A\state` | LIVE VERIFIED |
| Layout marker | `state-layout.json` — schema **`bunny-state/2`** (`BUNNY_STATE_LAYOUT=2`), databaseUserVersion **3**, databaseSchemaSha256 `7904d40adbb3942820f76d8c59be06f71f41949ca28e90f4c7cfe057fce9515c` | LIVE/STATIC VERIFIED |
| Database | `host.sqlite` (+WAL/SHM), opened **read-only via a disposable temp copy** this session — production DB untouched | LIVE VERIFIED |
| Migrations applied | `ma0.missions.v1`, `ma2.approval-batches.v1`; PRAGMA `user_version` 3 | LIVE VERIFIED |
| Workspace | `C:\Users\allam\Bunny-Workspace` (outside repo and app root; named by install.json) | LIVE/STATIC VERIFIED |
| Dev state root | `%LOCALAPPDATA%\Bunny-A\state\development\` — separate dev-Host state (source development Host writes here) | LIVE VERIFIED |

**Full-table census (2026-10-07T19:51:30.830Z):** tasks **62** · missions **25** · mission_steps 61 · mission_authorizations 27 · mission_dependencies 34 · mission_memory 65 · mission_artifacts 1 · approval_batches **19** · capability_runs **55** · capability_grants **0** · events **3653** · inbox_events 136 · outcomes 46 · permission_requests 34 · policies 1 · settings 19 · skills 12 · skill_versions 12 · triggers **0** · workspace_locks **0** · devices 18 (1 active) · providers 6 · projects 13.

- **Devices: 18 rows, 1 active** ("Phone companion"); 17 revoked — matches the R1.1 report's protected-device count exactly.
- **Projects: 13 — all disposable M2/M3 validation fixtures; no real user project exists yet** (carried as an M-A-3 product fact: the Projects redesign, §13, starts from an empty real slate).
- **Providers (DB rows):** `claude` ("Claude Code"), `codex`, `ollama`, `opencode`, `cursor` ("Cursor Agent"), `cline` — with probed_at 19:20:48–19:31:55Z (see §4). Configured paths per settings.
- **Settings:** `active_policy`, `missions_config` + 17 `computer.target:*` Calculator execution-identity rows (historical T9R validation identities — **never grants**).
- **Skills Library (12):** project.test/build/typecheck/lint, git.snapshot, git.worktree, screen.capture, web.capture_page, web.download, archive.extract, app.open, project.open.
- **Live Ollama inventory (queried this session):** server running on 127.0.0.1:11434; 5 models — `deepseek-v4.1-flash:cloud`, `huihui_ai/qwen2.5-abliterate:7b`, `huihui_ai/Qwen3.8-abliterated:27b` (17 GB), `huihui_ai/qwen3-abliterated:30b` (18 GB), `qwen2.5-coder:7b`. This is machine inventory only — **no availability or fitness claim is made** (§7: never invent availability; UNKNOWN stays UNKNOWN until each model is actually probed in its gate).

## 6. Running-process census at inspection (non-production)

From `test-results/ma3-baseline/process-inventory.txt` (names/PIDs/creation only; **command lines deliberately not persisted** — §37 privacy):

- **Dev Host (source development):** PID chain cmd 54044 → node **20936** (`npm run host` → `scripts/bunny-host.mjs`), created 2026-10-06 11:06 local, listening `127.0.0.1:43139`, instance `86a8abb0-f9c1-40a9-9f2d-90a1289f150a`, writing its own separate development state. This is the same dev Host the immutable MA2 review recorded as L-DEV-HOST ("purpose/launcher authorization NOT ESTABLISHED") — **that finding is carried forward unresolved**.
- **Stale Vite dev server:** node 51060 on `0.0.0.0:8080` (from 2026-10-06; app-builder-template dev server, unrelated to production).
- **Provider CLIs (machine-owner context, not Bunny processes):** claude.exe ×18 (Claude Code sessions incl. this one), codex.exe ×2 + codex-computer-use-swift + codex-windows-sandbox-service, ollama server + tray, bun on 127.0.0.1:37777 (claude-mem live-activity server).
- **Bunny-path command-line sweep:** zero processes referencing Bunny release paths or production roles.

## 7. Reports, adoption studies and code map (seven structured digests, session-verified)

Digest of digestors (fan-out read this session; full structured digests retained in the T0 evidence set):

1. **MA2_FINAL_INDEPENDENT_REVIEW.md** (immutable, byte-verified): Decision **FAIL**, token `BUNNY_MA2_OPERATIONAL_FAIL`. Frozen HEAD `deb83e8` (6 commits behind current tip). Minimum blockers: **B1** close IR-H1 (stale-snapshot `taskkill /PID /F` branch in `TaskManager.stop` — resolved in v26 via `8001d51`, fail-closed inspection + held-identity termination) outside that review; **B2** establish the *operating* release's complete guarantees (per-delivery SSE revocation, authenticated read-only canonical rollback quiescence, restart approval invalidation, T9 batching / T9R lifecycle) under separate human authorization, then fresh review. Production grades FAIL on owned-process cleanup, revocation, rollback, desktop target lifecycle, Stop **as of v17-T6** — those findings motivated, and were repaired by, v26-MA2-R1; they have **not been independently re-graded against v26**.
2. **MA2_INDEPENDENT_REVIEW_PACKET.md** (R1.1 handoff): fresh independent reviewer alone issues the M-A-2 operational verdict; must verify against production-identity.json, final-production.json, final-verdict.json and the hashed evidence index, resolving all identities freshly; prohibitions (never rerun the bounded v17→v26 controller; staged proof ≠ operating bytes; snapshots ≠ authority; saved-PID rules). The reviewer must also assess the retained transient-descendant refusal and the installed IR-H1 fail-closed behavior.
3. **MA2_ACCEPTANCE_MATRIX.md**: full gate chronology T1→T10 → R1(FAIL) → R1.1; regression floor **664 = 254 scripts + 373 app + 37 UI**, zero failures/skips; typecheck/lint/build pass; **no BUNNY_MA2_OPERATIONAL_PASS ever issued**; T11/T12 do not exist; PASS_WITH_LIMITATIONS never used (gradations are "MIXED" classifications).
4. **BUNNY_OPENDOTS_ADOPTION_REPORT.md (OD-1, 2026-10-04)**: `BUNNY_OPENDOTS_REFERENCE_ACCEPTED_WITH_NOTES`; ledger **1 ADOPT / 6 ADAPT / 2 ALREADY HAVE / 1 LATER**; the one ADOPT = derived per-agent credentials; preservation-boundary table for future milestones; "separate later proposals, ordered by dependency"; UI/event semantics must remain **projections only over the single journal**; takeover-barrier lesson for T5-class work. Does not mention M-A-3/T0; its constraints are carried forward into M-A-3 as adopted guidance, not as new authority.
5. **BUNNY_OCTOP_ADOPTION_REPORT.md (OCT-1, 2026-10-05-era)**: `BUNNY_OCTOP_REFERENCE_ACCEPTED_WITH_NOTES`; 24 mechanisms; **all adoption IDEAS_ONLY, SAFE_TO_PORT none**; future plan **OA-1 AgentProfile → OA-2 AgentWorkspace/Backend → (OA-3 ACP, OA-4 mission staffing) → OA-5 connectors → OA-6/7/8** with per-workstream acceptance; nine binding notes (MissionManager sole orchestration; no second memory/scheduler/permission system; ACP terminates at Host authority; connectors/channels never grant authority; plugins rejected; deterministic capability execution; browser keeps its network fence; Bunny defaults stay approval-on/deny-by-default; IDEAS_ONLY). Now-committed (c `68e74d5`) despite its original uncommitted framing.
6. **MA1_CLAUDE_FINAL_REVIEW.md + MA1D_FINAL_INDEPENDENT_REVIEW.md (2026-10-03)**: MA1 rejected (`BUNNY_MA1_PROMOTION_REJECTED`) solely on the dev-worktree production Host blocker; MA1D (v16 pinned deployment, `BUNNY_MA1D_PROMOTION_APPROVED_WITH_LIMITATIONS`) closed it; MA1D's carried-forward M-A-2 notes (junction-located state/cloudflared, Codex version gate, unhandled-rejection hardening, dashboard promotion pass, health-identity endpoint, etc.) remain the backlog as recorded.
7. **Code-map digest (static structure)**: confirmed absence of any M-A-3 surface: zero matches for AgentProfile/agentic/model-inventory identifiers in `src/**` or `scripts/**`; reports explicitly state no M-A-3 work was begun. Live architecture: TaskManager `src/lib/bunny-host/manager.server.ts`; MissionManager `src/lib/bunny-missions/manager.server.ts`; routing split across `src/lib/orch/router.ts` (scoring) + `src/lib/bunny-host/router.ts` (eligibility/constraints) — "BunnyRouter" is a concept, not one module; CapabilityBus `src/lib/bunny-missions/capabilities/bus.server.ts` with adapters; permission engine `authorization.server.ts`; ProviderRegistry `registry.server.ts` (probe order ollama→codex→claude→opencode→cline→cursor); canonical event journal in `persistence.server.ts` (node:sqlite WAL, user_version 3); single dashboard route `/` over Island components; device pairing via `/api/bunny-pair` → Host `/pair`; tunnel via `scripts/bunny-tunnel*.mjs`; **T3-era gateway scripts are retired stubs that throw**.

## 8. Binding constraints carried into M-A-3

From the MA2 boundary (§1 of the master prompt) and the adoption reports above, these hold for every M-A-3 gate: one Host authority; no second MissionManager/TaskManager/scheduler/permission engine/event store/memory/skill authority; BunnyRouter remains the sole provider selector; Capability Bus remains the deterministic-work path; installed releases immutable; process ownership/IR-H1 fail-closed rules and T9/T9R semantics preserved; provider/model **availability is never invented — UNKNOWN stays UNKNOWN** (§7); no global Ask/Auto/Full authority modes (§6: mission-scoped envelope only); "borrow semantics, not authority" for OpenDots/OpenBot/Octop; staged-first release discipline (§42); fresh independent review remains outstanding for M-A-2 (§43); privacy exclusions (§37) — honored here by never persisting command lines, transcripts, credentials or token material.

## 9. Discrepancy ledger (recorded, not hidden)

| # | Discrepancy | Class / status |
|---|---|---|
| D1 | **GitHub origin is far behind production Git**: 103 unpushed commits on `ma2-operational-hardening` (incl. both v26 pins); `ma1-live-acceptance` local-only; `origin/main` also *advanced* mid-session (PR #2 from ma0). A person cloning origin cannot see the shipped system. Sync plan: `MA3_GIT_RECONCILIATION.md` (no push authorized yet) | LIVE VERIFIED / plan produced |
| D2 | **Production was SELECTED but NOT RUNNING at inspection** (~19:45–19:55Z) after a healthy 5-role capture at 18:56:14Z; exit left **no log**: launch log ends 18:20Z, failure ledger's event horizon is 18:21:48Z `host.operation_failed` | LIVE VERIFIED / OPEN — cause NOT TESTED |
| D3 | **Unexplained production-DB writes** at 19:20:48–19:21:20Z and 19:30:53–19:31:55Z (provider probes/status) — writer identity NOT ESTABLISHED; last production event 19:31:55.470Z; WAL mtime consistent. Best hypothesis: the production Host outlived its last identity capture and exited unlogged (hard stop) between 19:31:55Z and ~19:45Z; **actor UNKNOWN**. Telemetry-only impact per current census (no authority-bearing rows changed); not cleared by this baseline — carried as an open item for the fresh independent re-review | LIVE VERIFIED / OPEN |
| D4 | **Session memory was stale**: prior memory claimed production = v17-T6 / port 35792 (T8-era); disk + reports prove v26-MA2-R1 / 43119. Memory corrected by this gate | resolved (memory updated) |
| D5 | **Repo-local `AGENTS.md` / app-builder scaffold noise**: the repo is the Grok app-builder template with Bunny code layered on top; `AGENTS.md` ("Export from Grok"), `.grok/`, and template remnant modules (JEV/Quorum/JeV simulator unmounted, multiplayer p2p) are non-operative for Bunny-A host work | STATIC VERIFIED / recorded |
| D6 | **All 13 projects in the DB are disposable validation fixtures** — no real user project exists; M-A-3 §13 (Projects redesign) starts from an empty real slate | LIVE VERIFIED / recorded |
| D7 | The immutable FAIL review froze `deb83e8`; runtime history since includes the v26 repair commits — the review documents a historical snapshot and does not re-grade current HEAD | STATIC VERIFIED / recorded |
| D8 | Vocabulary: "DISPOSABLE LIVE VERIFIED" is not a literal label in the re-review packet (it exists as prose distinctions and in prior practice); classification mapping recorded in §0 | STATIC VERIFIED / recorded |
| D9 | Historical-only: MA1→MA1D Host identity transition (41264 dev-tree → 9984 v16) is never narrated between the two 2026-10-03 filings | FROM-REPORT / recorded |

## 10. NOT TESTED / unknowns at T0 (explicitly not claimed)

Cause of the production-Host stop and writer of the 19:20–19:31Z probes (D2/D3); whether the dev Host on 43139 is user- or agent-launched (carried L-DEV-HOST, NOT ESTABLISHED); current public-tunnel and phone reachability (tunnel down at inspection; quick-tunnel URLs are temporary); provenance of the T6 phone-render.json SHA mutation (NOT ESTABLISHED, carried); physical Android and reboot acceptance (carried NOT TESTED); the M-A-2 operational verdict itself (a fresh independent reviewer's task — **this gate does not substitute for it**); per-model provider availability (§7 — UNKNOWN until actually probed in its own gate).

## 11. Evidence set and hashes

Evidence directory: `test-results/ma3-baseline/` — `git-status.txt`, `git-branch.txt`, `git-log-60.txt`, `git-remotes.txt`, `git-ls-remote.txt`, `git-rev-counts.txt`, `canonical-install.json`, `canonical-state-layout.json`, `canonical-operations-current.json`, `canonical-identity-latest.json`, `db-census.json`, `process-inventory.txt` — hashed in `test-results/ma3-baseline/INDEX.md`. Gate record: `test-results/ma3/t0/INDEX.md`.

Report fingerprints (LIVE VERIFIED 2026-10-07): `MA2_FINAL_INDEPENDENT_REVIEW.md` = `2ac061dda6f07d86236c1c648ec738d363cb9b701e148b17c7755d5653f57d3a` (exact R1.1 match, externally corroborated — the value is not self-recorded in the document); remaining hashes in `test-results/ma3-baseline/INDEX.md`. The user-authored untracked reports remain uncommitted, byte-preserved.

## 12. Gate record

**Verdict: `BUNNY_MA3_T0_PASS`**

Scope of what this verdict means: the baseline the master prompt demands was established from live and canonical primary sources; the discrepancy ledger and unknowns are recorded rather than hidden; the Git reconciliation plan was produced (§27); evidence is hashed and indexed; no production operation, commit, or push was performed.

What it does **not** mean: production is not validated as running (it factually is not, per §4); no M-A-2 operational verdict is issued or implied; the unexplained writes/stop remain open; nothing in this gate authorizes production restart, rollback, promotion, or any M-A-2/M-A-3 operational action.

**NEXT (not begun without a go):** T1 — live provider/model discovery + normalized ModelCapability registry (§7–§8), with two user decisions queued: (a) whether to authorize the standard native Startup restart of the production Host (it is currently stopped and its exit is unlogged), and (b) whether to execute the §27 Git synchronization plan.