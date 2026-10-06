# M-A-2 Gate T9

**VERDICT PENDING LIVE MATRIX** (2026-10-06 — automated gates complete; live A–J against the
staged candidate in progress). The bounded desktop approval batching gate: one
explicit approval — "Allow this small batch · N actions · <app> only · 2 min" — can now authorize a
small, predictable, low-risk desktop sequence inside ONE mission, and it can NEVER become standing
permission to control the computer. Every offer is computed by the Host from the mission's own
plan; every target binding, budget, TTL, risk ceiling, scope escape, restart wipe and privacy
redaction is enforced by the Host's existing permission machinery, and every escape fails closed.
On completion the verdict is exactly `BUNNY_MC_MA2_T9_PASS` or `BUNNY_MA2_T9_FAIL` (§81); the full-series operational verdict is NOT
issued (§82 — no BUNNY_MA2_OPERATIONAL_PASS claim); **NEXT = T10 (final adversarial operational
audit), not begun** (§83).

| T9 gate role | Statement |
| --- | --- |
| Gate | M-A-2 Gate T9 — Bounded Desktop Approval Batching / Approval UX Refinement |
| Question answered | "Can one explicit approval authorize a small, predictable, low-risk desktop sequence — materially reducing repeated prompts — while every scope-escape attempt still stops for approval and nothing ever becomes standing permission?" |
| Scope | One additive mechanism on the EXISTING permission engine (`decide()` → consult-gate → admission-gate → post-run review); no second engine; no new audit store; envelope/grant/direct/delegated surfaces untouched; T1–T8 preserved |
| Verdict | **PENDING LIVE MATRIX** — automated gates complete, 0 BLOCKER / 0 HIGH so far; verdict fixed only after the live A–J matrix on the staged candidate |

# Baseline

| Baseline fact | Value | Label |
| --- | --- | --- |
| Repository at gate start | branch `ma2-operational-hardening`, HEAD `abe993a` (T8 close), clean tree | STATIC VERIFIED — `baseline.json` |
| Production release | `Bunny-A-Windows-v17-T6` installed under `%LOCALAPPDATA%\Bunny-A`, source `cb005ef7…`, manifest `f5bf648c…` | STATIC VERIFIED (baseline; re-proven in LIVE) |
| Regression floor | 592 = 247 script + 311 application + 34 UI; rule: never delete tests, add focused T9 tests | STATIC VERIFIED — `baseline.json` |
| Prior gates | T1–T8 all PASS (T7 `c126e7f`, T8 `abe993a`) | STATIC VERIFIED |
| Production desktop-control history | empty (`desktopControlEverEnvelopeApproved: false`; zero computer-enabled envelopes, zero permission requests, zero desktop runs) | STATIC VERIFIED — `baseline.json` database inspection |
| Current approval model | recorded before any code change | STATIC VERIFIED — `current-approval-model.md` (§2; the brief also names this `approval-model-before.md` — same record) |

# Previous approval behavior

`current-approval-model.md` records the pre-T9 machinery exactly: `decide()`
(`authorization.server.ts`) returns allow/ask/deny from the per-mission AuthorizationEnvelope and
persistent `capability_grants`; every desktop EXECUTE action on a READ-class envelope asks
every time — the approval-fatigue mechanism T9 addresses and the exact behavior that must be
preserved whenever a batch does not apply. One invocation = `approvedOnce` set at respond and
cleared at completion/failure/retry; "Allow this skill run" = matching-action window of one skill
run; no allow-all; grant policy choices unchanged (§50).

# New bounded policy

`policy-design.md` is the design-of-record; the implemented summary:

- **Offer (§5, §18):** Host-computed from the mission's own planned/skill steps when ≥ 2 covered
  mutating executions exist (the asking execution counts once — never double-counted). The request
  card shows the three conservative choices in order — **Allow once** (primary, unchanged),
  **Allow this small batch · N actions · <app> only · 2 min** (secondary, only when computed),
  **Deny** — plus truthful lines: covered actions with counts, read-only riders, the
  never-covers sentence (shell/files/installs/payments/secrets/destructive). No capability JSON,
  no selectors, no pids beyond "pid N" (§19). Buttons render only on Host truth
  (`batch-labels.ts`, shared by Host and island).
- **Grant (§4):** `respond {decision:"allow_batch"}` revalidates request open + mission live +
  envelope alive + offer present, then creates the batch FROM THE STORED OFFER. Clients may only
  SHRINK (`maxActions` clamped to ≥ 1 and the offer's value; `ttlMs` clamped to
  [1 s, 120 s] and the offer's value). A standing `ask_every_time` grant suppresses the offer,
  blocks the consult and rejects `allow_batch` — batching never overrides a standing user rule.
- **Consult (§3):** in the bus decision path, for base "ask" only: envelope alive + not revoked +
  not expired + `computer.enabled` + capability listed + no `ask_every_time` grant + own planned
  step (delegated child steps never match) + active batch of the current Host boot epoch. Match ⇒
  allow with a truthful reason ("Allowed by the small approval batch for Calculator: 3 of 10 …").
  Consult never converts a deny, never applies to non-mission work (§29/§30 structural).
- **Admission (§21–§23, §69, §70):** consumption happens ONLY at admission of a mutating covered
  action, in one compare-and-set `UPDATE` that re-checks status, epoch, expiry and
  `used_count` itself and rewrites the record JSON with the same increment (column and JSON can
  never diverge — the canonical count is read-identical everywhere). A lost race or lapsed guard
  executes NOTHING and reports honestly. READ actions ride free; UI/decisions never consume.
  Budget exhausted ⇒ batch ends `exhausted` + event; nothing more admits without a fresh
  approval (no off-by-one — the guard denies the max+1-th attempt).
- **Target binding (§10–§12, §72):** tiers `process` > `app` only (no window-title tier). Explicit
  pids ⇒ strict pid equality pre-execution. `open_app` starts an app-tier batch (a launcher pid is
  NOT window identity); the first window-bearing execution pins the owning pid from the Computer
  Runtime's structured output, and `open_app`'s launcher pid never pins. Title-filtered requests
  run as verified hypotheses: post-run review compares the observed owner pid to the pin and ends
  the batch immediately (`scope_mismatch`) on any drift — fail closed forward (a completed run is
  not reversible; nothing further runs without fresh approval). This is the documented honest
  bound of what Windows observation allows; exact window isolation is NOT claimed (§72).
- **Eligibility ceiling (§7, §8, §14):** family `computer` only; manifest `implemented`, not
  `sensitive`, not `hardApproval`; escalation-aware risk ≤ EXECUTE (`riskOf` with parameter
  escalation). Sensitive-target refusal for type/invoke on password/secret/token/credential/pin/
  card/cvv/ssn/api-key-shaped control identities. Destructive, git, filesystem, shell, browser,
  connector actions are structurally outside the family.
- **Endings (§13, §36–§45):** mission_ended (stop/replan), exhausted, expired (Host clock),
  revoked (UI or remote), scope_mismatch, host_restart. `recover()` sweeps every active batch of
  every previous state AND each row carries the boot epoch — double fail-closed; batch grants
  never survive a Host restart (§39). UI reconnect approves nothing new; stale/duplicate responses
  are refused; `mission.revoke_batch` is workstation- or paired-device-reachable and shrinks
  nothing (it only ends) (§40–§42).
- **Journal (§46, §47):** `approval.batch_started/consumed/exhausted/expired/ended/
  scope_mismatch` through `TaskManager.emit` into the existing events table — no typed values, no
  secrets, no selectors; params keep the existing `[N characters]` redaction.

# Security invariants

| Invariant | Statement | Evidence |
| --- | --- | --- |
| §6 | No allow-all/always-allow/trust-forever option exists; preferences untouched | STATIC VERIFIED (no `capability_grants` policy or UI surface added); `focused-tests.log` (offer only when computable) |
| §8/§14 | Never batch destructive/credential/secret/install/elevation/payment/external/publish/account/permission-change/pairing/clipboard/private-upload; risk > EXECUTE uncroverable | STATIC VERIFIED — structural family/flags/risk rules; `focused-tests.log` (sensitive, shell, browser, git, filesystem escape probes) |
| §16/§17 | No model self-expansion; no natural-language approval; only `mission.respond` from an authorized actor on a Host-computed offer | STATIC VERIFIED — no code path reads model output into batch parameters; LIVE pending |
| §26 | Sensitive input never inherits ordinary typing approval | `focused-tests.log` (password control asks; secret never typed) + LIVE pending |
| §49 | Truthful language: records say "allowed within its bounded scope", never "safe"; UI states bounds verbatim | STATIC VERIFIED (labels + reasons audited); policy-design §11 |
| §48 | Verification independence unchanged | STATIC VERIFIED — zero diff in verification surfaces; verification suite green |
| §47 | Journals/UI never store typed secrets | `privacy.json` (automated + LIVE) |

# IMPLEMENTED

Additive change set (exact source; no existing behavior removed — `decide()` branch order
preserved; the consult gate runs after the base decision and only for ordinary asks):

| Area | File(s) | What |
| --- | --- | --- |
| Types + decision envelope | `src/lib/bunny-missions/types.ts` | `PermissionDecision.batch?`, `resolution:"allow_batch"`, `PermissionBatchOffer`, `ApprovalBatch`, `BatchView`, `MissionView.batch` |
| Offer/binding/consult core | `src/lib/bunny-missions/batches.server.ts` (NEW) | `batchOffer` (plan → eligibility weights, counts, min(2×mutating, 12), 2-min TTL, target tier/label), `consultBatch` (step binding, pid/app/title rules, sensitivity, risk ceiling), `targetLabelOf`, `currentBatchEpoch`/`rotateBatchEpochForTest`, `riskAtMost` |
| Admission + canonical count | `src/lib/bunny-missions/store.server.ts` | `approval_batches` table + migration `ma2.approval-batches.v1`; `consumeBatch` guarded compare-and-set (status+epoch+expiry+budget in one UPDATE, record JSON rewritten with the column); `batchesActive`; `endBatch`; `endMissionBatches`; `endAllActiveBatches`; batch rows inside `view()` |
| Grant + lifecycle | `src/lib/bunny-missions/manager.server.ts` | `batchOfferFor` (dedupe: the asking execution counts once), `createBatchFromOffer` (revalidates; only-shrink knobs), `respond("allow_batch")`, `revokeBatch`, stop/replan ends batches, `recover()` host_restart sweep, view wiring |
| Decision consult + post-run review | `src/lib/bunny-missions/capabilities/bus.server.ts` | consult gate after `decide()` (never converts deny; `ask_every_time` respected), admission gate before execution, `approval.batch_*` events, `reviewBatchObserved` (launcher-pid no-pin rule; first window-bearing execution pins; drift ⇒ `scope_mismatch`) |
| Remote surface | `src/lib/bunny-missions/commands.server.ts` | `allow_batch` decision validation; only-shrink knobs; `mission.revoke_batch` (workstation + paired device) |
| Truthful display | `src/lib/bunny-missions/batch-labels.ts` (NEW) + `src/components/island/mission-model.ts` + `mission.tsx` + `mission.css` + `src/store/use-island.ts` | offer lines/button/status labels (one import surface), batch offer block, batch block in the mission panel with Revoke; no raw policy |
| Journal + state marker | `src/lib/bunny-host/state-paths.server.ts` + `http.server.ts` | `refreshStateMarker`: after a Host applies its own additive schema, the installed-state marker reconciles (schema fingerprint + user_version) so the second boot validates a healthy database; quick_check must pass or nothing changes; damaged/wrong-version databases stay refused (defect 4) |

# STATIC VERIFIED

| Check | Result | Evidence |
| --- | --- | --- |
| Focused T9 suite (18 tests, areas of §66) | 18 pass, 0 fail | `focused-tests.log` — approval-batches.test.ts (15) + state-marker.test.ts (3). Areas: single-action unchanged; explicit batch (offer shape/counts/ordering); batch denied; app binding; Task binding (delegated child steps); Mission binding; count exhaustion (boundary 2/2, no off-by-one); expiration (lazy flip + guarded denial + UI truth); risk escalation (`riskAtMost` lattice + requestBatchable); unexpected target (foreign pid, lookalike window, capture/sensitive probes, shell, browser, files, git); sensitive input; shell exclusion; Browser exclusion; Stop; Host restart (epoch + recover sweep); UI reconnect (`view()` canonical + stale-response refusals); remote approval (paired phone grant/revoke, clamped knobs, canonical counts); ask_every_time non-batching; secret redaction (automated privacy scan); journal events (ordering + truth); verification independence (area unchanged — zero diff); provider reroute (structural: consult input carries no provider identity; existing retarget suite unchanged) |
| Full suite | **613 total** = 247 script + 329 application + 37 UI, 0 fail (floor 592, +21 additive, none deleted) | `full-tests.log`, `ui-tests.log` |
| Typecheck | exit 0 | `typecheck.log` |
| Lint | exit 0 (0 errors; 13 pre-existing warnings, unchanged) | `lint.log` |
| Build | exit 0 (normal Vite/Nitro build) | `build.log` |
| Dev render QA (desktop 1280×800 + mobile 390×844, system Chrome) | real content, zero console/page errors, no horizontal overflow; screenshots visually inspected | `dev-render-verdict.json`, `screenshots/app-builder-preview*.png` |

## Defects the focused suite caught (each fixed and re-proven)

1. `createBatchFromOffer` re-read a request already resolved by `respond()` and rejected every
   `allow_batch` ("This request was already answered.") — the resolvedAt re-check inside
   `createBatchFromOffer` was removed; `respond()`'s entry check is the double-answer protection.
2. `consumeBatch` updated only the `used_count` column, leaving the record JSON stale — every
   JSON read path (and view/endBatch spreads) saw count 0. Fixed with the compare-and-set UPDATE
   that rewrites the record with the same increment (canonical-count invariant).
3. `batchOfferFor` counted the asking execution in the plan (double-count) — single-action plans
   could incorrectly produce offers. Fixed by excluding the asking step for capability asks and
   splicing the matched duplicate for skill asks.
4. The second boot after any T9-class activation would refuse a healthy database: the
   installed-state marker's `databaseSchemaSha256` describes the pre-migration schema while the
   Host applies its own additive `approval_batches` schema at boot (caught during staged-runtime
   preparation; `state-marker.test.ts` reproduces the refusal first, then proves the heal + the
   second-boot validation pass). Fixed with `refreshStateMarker` — additive reconciliation only;
   `quick_check` must pass, damaged databases stay refused.
5. The `approval.batch_started` journal copy printed the TTL as `Math.round(ttlMs/1000)` labelled
   "min" — the 120-second default rendered "within 120 min" (seconds mislabeled as minutes, a
   60× overstatement inside a security-relevant record). Caught re-reading the source before the
   live matrix; fixed to share the truthful duration wording (`within 2 min` / `within 5 s`),
   pinned by a new assertion in the canonical-count focused test. The offer card and `BatchView`
   always carried the truth (batch-labels' `ttlPhrase` was already correct); only the event copy
   was wrong.

# LIVE VERIFIED

_Live section is completed in the live records below (candidate `Bunny-A-Windows-v17-T9`
installed from exact source with a disposable copy of the production database; production
preserved untouched)._

# SIMULATED

| Check | Result |
| --- | --- |
| Provider reroute (§38) | No live provider reroute was exercised: batch consult input is structurally provider-independent (no provider field exists on the consult path), and the existing retarget suite passes unchanged. |
| Revoked remote device (§41) | Covered by the unchanged T6 device-auth refusal before dispatch plus the T9 respond revalidation; no new code path exists to revoke a device for T9. |
| Vision/external-model fallback (§74/§75) | No live vision fallback was exercised: fallbacks gain no new authority structurally — every covered action still passes the same consult gate; fallback use remains separately observable by the unchanged adapter events. |

# NOT TESTED

| Item | Reason |
| --- | --- |
| T10 final operational audit | NEXT (§83) — out of scope for this run |
| Persistent per-app preference (§52) | Deliberately NOT IMPLEMENTED (future milestone) |
| Production activation of v17-T9 | Requires explicit user authorization (§64); candidate left staged |
| Multiple monitors / multi-window Store-app edge cases beyond the documented tier contract | Documented bound (§72); covered by the post-run drift termination rather than pre-execution claims |

# BLOCKED

None.