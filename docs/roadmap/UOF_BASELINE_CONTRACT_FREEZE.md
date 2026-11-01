# UOF Baseline & Contract Freeze (MA6 lane start)

**Lane:** contracts (runs before the three engineering lanes)
**Date:** 2026-11-01
**Authority:** `Bunny_A_Unified_Orchestration_Master_Prompt.md` (owner-provided)
**Derived roadmap already in repo:** `docs/roadmap/BUNNY_A_PRODUCT_MASTERPLAN.md`
(M1 voice closure merged as PR #67; M2 native UX sprints merged as PRs #69/#71/#74;
security cycle closed — full `npm audit` returns 0 findings post PR #72/#73.)

## 1. Verified repository state (captured 2026-11-01, this machine)

| Item | Value | Evidence |
|---|---|---|
| Target repo | `https://github.com/COMRADEART/bunny-A.git` (remote `bunny-a`) | `git remote -v` |
| Base of record | upstream `bunny-a/main` = `a9a79fe` (PR #78 spoken-approval exclusion merge) | `git rev-parse bunny-a/main` |
| Local `main` (mirror checkout) | `ea0e803`, **545 commits behind** upstream | `git rev-list --count main..bunny-a/main` |
| Checkout branch | `sec/resolve-better-auth-advisory` (already merged; masterplan §1.2 confirms) | local tree |
| Dirty mirror files | `native/voice/bunny-voice-worker.json`, `src/lib/bunny-host/voice/voice-session.server.ts`, `startup.sh`; untracked `scripts/ma5-s1r1-installer.test.mjs`, `android/.../NativeCompanionActivity.java`, `.claude-flow/` | `git status` |
| Dirty-file ownership | **Undecided by owner** (masterplan §6 item 4) — preserved untouched; all UOF lanes branch from `a9a79fe`, which does not include them | this doc |
| CI | `typecheck` + `test:ma4` + routing/UI tests + shared+desktop builds; separate full-regression `npm test` job (windows-latest) | `.github/workflows/ci.yml` |
| gh credentials | authed as `COMRADEART` (repo scope); draft PRs opened, never self-merged | `gh auth status` |

## 2. Languages, frameworks, test inventory

- **Stack (unchanged, per masterplan §1.4):** React 19 + TanStack Start/Router, Tailwind v4, zod 4.6.7, better-auth 1.7.14, pg/Kysely (+pglite), Nitro server functions. Native Windows WPF shell + UIA notch_tree + owned voice worker (whisper pin `45f64172`) + NSIS. Android companion `com.routeragent.jev`. Local inference via Ollama (qwen2.5-coder:7b / deepseek-r1:7b qualified); cloud fallback disabled at MA4-S2.
- **Test inventory:** 196 `src/**/*.test.ts` + 30 `scripts/*.test.mjs`; suites `npm test` (full regression), `npm run test:ma4`, `npm run test:ui`, `typecheck`, `lint`; CI runs deterministic gates only (live/hardware/physical gates run locally, never faked in CI).
- **Orchestration seams that already exist (UOF builds here, no parallel engine):** `src/lib/orch/` (router, machine, types, exec/server, telemetry, local-inference), `src/lib/bunny-host/` (agent machine/store/replay, routing+learning, harnesses, workers, remote-device, lotus, ma4 dag-cache/memory-fairness/reliability), `src/lib/bunny-missions/scheduler.ts`.

## 3. Existing auth / provider paths (verified by presence, not rewritten)

OAuth+PKCE connector flows (`src/lib/bunny-host/oauth-pkce.test.ts`), connector registry + browser security broker (MA4-S2-T6), DPAPI credential protection, provider process containment (`MA3_T9R_F04`), provider `Availability`/`AuthState`/`UsageWindow`/`ObservedUsage` vocabulary (`src/lib/orch/types.ts`), approval batching + spoken-phrase approval exclusion (PRs MA2-T9R, #78).

## 4. Proposed integration boundary (Rust decision deferred with a measurement path)

No big-bang rewrite. UOF components are TypeScript modules in the existing Host seams. The Rust question (scheduler/durability/transport in a native crate) is **deferred to an ADR owned by the core lane**, with required evidence: p50/p95 host event-loop stall under concurrent voice+agents, durable-queue fsync costs, and Android cross-compile surface. Absent measured wins, TypeScript stays (master prompt §0.3 permits exactly this when reasons are explicit).

## 5. Contracts (this PR)

- `src/lib/orch/contracts.ts` — **uof.v1**, 20 entities (Task, Subtask, Dependency, ExecutionPlan, ExecutionEvent, AgentAdapter, Connector, AccountEntitlement, Capability, ExecutionHarness, DeviceNode, ModelArtifact, QuotaSignal, UsageEstimate, PolicyDecision, ApprovalRequest, ResultArtifact, VerificationEvidence, Lease, CoordinatorEpoch) as zod schemas + types + cross-entity invariant checker (`validateBundle`) + secret-hygiene guard (`assertNoSecretKeys`).
- Fixture `src/lib/orch/fixtures/uof.v1.gold.json` + `contracts.fixtures.test.ts` (10 cases: parse, monotonic event seq, dangling refs, DAG cycle, lease/epoch fencing, approval state consistency, unknown-cost-is-not-zero, version pinning, secret-key ban).
- Rules worth restating: unknown cost ≠ zero; capability status tri-state (verified/reported/unavailable); events append-only with monotonic `seq`; approvals reference `taskRef` and are never spoken-phrase-resolvable; leases carry epoch fences.

## 6. Branch / worktree allocation (from this base `a9a79fe`)

| Lane | Branch | Worktree | Scope (slice) |
|---|---|---|---|
| contracts | `unify/contracts` | `bun-router-unify-contracts` | this doc + uof.v1 |
| W1 core | `unify/core-route-ledger` | `bun-router-unify-core` | route-decision ledger: reason + alternatives + outcome per decision, calibration-ready (master prompt W1.5) |
| W2 providers | `unify/providers-capability-probes` | `bun-router-unify-providers` | honest tri-state capability surface + quota-signal ingestion (W2 acceptance "supported/limited/unavailable honestly", W1.4 quota signals) |
| W3 fabric | `unify/fabric-coordinator-lease` | `bun-router-unify-fabric` | coordinator epoch/lease fencing for Windows/server split-brain (W3.4) |

Sequencing: lanes start after this PR is on main (or lane branches rebase on `unify/contracts`); UI redesign (master prompt W4) and independent verification (W5) remain **not started**, per order rules. Concurrency for delegated lanes ≤2 per machine.

## 7. Risks

1. Upstream `bunny-a/main` moves faster than local mirror — lanes must rebase before integration; the integration gate (master prompt §4) runs against fresh upstream.
2. Dirty mirror files have no owner decision yet; they can silently diverge from lanes that touch host code.
3. Lane-local checks ran against a junctioned `node_modules` from the mirror checkout (same dep ranges); CI on clean `npm ci` remains the authority.
4. Device/signing/physical gates stay owner-blocked (EV cert, Android keystore, physical phone) — lanes must report them as BLOCKED, never skipped silently.
5. Upstream sprint cadence (M2/M3 rows) continues; UOF lanes must not touch island/notch/voice files they don't own.