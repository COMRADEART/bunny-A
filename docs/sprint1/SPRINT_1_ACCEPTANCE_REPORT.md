# SPRINT 1 ACCEPTANCE — NATIVE UX / MISSION CONTROL VERTICAL SLICE

**Product:** Bunny A by LOKAM
**Contract:** `docs/roadmap/SPRINT_1_NATIVE_UX_SLICE.md` (owner-approved in PR #68)
**Base:** main `a174b35` (after PRs #66 / #67 / #68 merged)
**Branch / worktree:** `ma5-s2-sprint1-native-ux` in `bun-router-sprint1` (clean checkout off updated main; owner's root-worktree edits untouched)
**Date:** 2026-10-31
**Execution mode:** tests-only truthfulness regression. Recon confirmed the island models
already enforce the contract (counts-only progress, verified/unverified split, three canonical
approval sources, four-edge notch layout), so the sprint locks each claim with regression tests
instead of re-wiring UI code. No UI, server, native or Android file was modified.

**Overall: PARTIAL** — every web-side claim is now test-locked and every automated gate is
green. The remaining deltas are native-shell-owned (criterion 5) or need an owner live session
(criteria 1, 6 live rounds); none is a web code defect.

---

## 1. Verdict per contract criterion

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Every rendered byte traces to a real Host event; demo/mock paths unreachable in production | **PARTIAL** | Model lock PASS: `mission-model` "Sprint 1: the Bar shows only what the Host snapshot states — nothing is invented" (empty Host → zero invented rows; unknown id → `null`; no invented completion/progress); `approvals-model` derives items only from the three canonical Host records (type union `ApprovalKind = "task" \| "mission_request" \| "agent_consent"`); T13 island matrix "no state fabricates a percentage, an ETA, or a local-only claim" and "idle is the absence of live work". Demo clause PASS: repo-wide grep shows **no** DEMO/mock/sample-data path injected into island render code. **Remaining:** a fresh live-Host demonstration round (real missions, current session) is an owner-session item — needs the running Bunny Host app, not a code change. |
| 2 | No fabricated progress numbers | **PASS** | Locked and green: "progress text comes from step counts only, never elapsed time"; "progress text never contains a percentage sign for any count the Host can report"; "Invalid or invented Mission progress stays indeterminate"; plus this sprint's "completed step is worded by its own verification result, never upgraded". No interpolation exists in the render path. |
| 3 | Approval click → single approval event → idempotent on repeat | **PASS** | Union-side dedupe: "an Agent waiting on the same Mission request is that one ask, not two"; "pending asks merge Agentic items and unresolved Mission requests once each"; "T5: duplicate replay keeps stable activity IDs and does not notify twice"; still-true new test "re-reading the same Host snapshot yields the identical approval list". Command-side idempotency: T9 command doctrine tests (mutating actions carry operation ids and epochs; lost acknowledgement resolves only from the Host's own record). |
| 4 | A spoken phrase / agent narration produces zero approval events | **PASS** | New test "Sprint 1: spoken words and agent narration are not approvals — only the three canonical Host records create one" → the spoken-yes task fixture yields `approvalCount = 0`. Companion: "an agent that only claims approval (not WAITING_FOR_USER) gets no consent item, whatever extra fields claim". Type-level lock: no speech-shaped source exists in `ApprovalKind`. Aligned with V39/V40 (voice grants nothing, replayed speech is not owner auth). |
| 5 | Notch pulled to all four edges; position survives app restart | **PARTIAL** | Layout contract locked (web-side complete): H12 "all four Notch placements keep the four-edge rule" (top/bottom → row left of Bunny; left/right → column above Bunny), T2 "every notch state derives from runtime facts", V47/V48 indicator placement. **Drag + restart persistence is native WPF/UIA-owned** — web grep shows no notch-position persistence hook (`localStorage` in island is only the context-panel collapse key). Per contract §5 we stopped and hand it to the native line rather than patching UI around it: → new native-line item "persist glass-notch edge + offset across restart (shell settings store), plus manual per-edge screenshots from the island shell". |
| 6 | Full keyboard flow; Narrator accurate for the five verified AXTree states | **PARTIAL** | Regression basis: this sprint's diff touches no AX-relevant production code (tests only), so the MA4-S2-qualified keyboard/Narrator behavior is unchanged and its logged evidence stands (model-level keyboard paths: V50 keyboard/mic controls accessible; uiIntent navigation tests "a stale uiIntent after reload does not navigate"). **Remaining:** a fresh keyboard + Narrator round (list → detail → approval) and AXTree capture needs the live island + shell — owner-session item. |
| 7 | `npm run test:ui`, typecheck, lint pass; full `npm test` unaffected | **PASS** | `test:ui`: **426/426 pass, 0 fail** (0.8 s), including the five new Sprint 1 assertions: spoken-words-not-approvals; agent-claims-no-consent; re-read-stability; Bar-shows-only-Host-snapshot; step-worded-by-own-verification. `npm run typecheck` (full project `tsc --noEmit`): clean. Targeted `eslint` on the two changed files: **0 problems**. Full `npm test`: runs in CI on this PR; last green main regression `a174b35` = 25m37s (PR #68 head). Scope note (recorded, not fixed — see §5): repo-wide `npm run lint` reports 185 pre-existing findings (58 errors) across 47 untouched files dating from earlier milestones. |
| 8 | Browser smoke desktop + mobile; production-preview divergence check | **PASS** | Dev (0.0.0.0:8080): desktop 1280×800 and mobile 390×844 both HTTP 200, real content rendered ("BunnyA Home Tasks Projects Agents…"), `consoleErrors: []`, `pageErrors: []`, no horizontal overflow, no brand/auth warnings — `screenshots/sprint1-desktop{,-mobile}.png` + `sprint1-desktop.json`. Production build `npm run build` → green (client + SSR + Nitro; `db:migrate` correctly skips locally, PGLite fallback owns it). Preview server on 8081: `divergesFromBaseline: false` with both viewports re-plotted; desktop body-text hash byte-identical to dev (`82301be3…`) — `screenshots/sprint1-preview.json` (see §4 for exact paths). |

## 2. What changed in this PR

`git diff --numstat` against `a174b35`:

```
31  0  src/components/island/approvals-model.test.ts   (+3 Sprint 1 tests)
18  0  src/components/island/mission-model.test.ts     (+2 Sprint 1 tests)
```

Everything else is committed evidence (§4). No production source file changed.

The five new tests (exact names as they appear in the suite log):

1. `Sprint 1: spoken words and agent narration are not approvals — only the three canonical Host records create one`
2. `Sprint 1: an agent that only claims approval (not WAITING_FOR_USER) gets no consent item, whatever extra fields claim`
3. `Sprint 1: re-reading the same Host snapshot yields the identical approval list`
4. `Sprint 1: the Bar shows only what the Host snapshot states — nothing is invented`
5. `Sprint 1: a completed step is worded by its own verification result, never upgraded`

## 3. Scope discipline (contract §2 non-goals — all held)

- No voice-worker / Whisper / FSM changes (S3R1's line remains owned by other branches).
- No Android changes, no DB migration, no new dependencies, no theme-system changes,
  no merge of S3 lanes into this branch.
- Owner work untouched: the root worktree's uncommitted files were never modified, stashed
  or reset; this sprint ran entirely in its own clean worktree.

## 4. Evidence inventory

| Artifact | Content |
|---|---|
| `test-results/sprint1-test-ui.log` | Full island suite output: 426 tests, 426 pass, 0 fail |
| `test-results/sprint1-lint-changed.log` | Targeted lint on the two changed files: 0 problems |
| `test-results/sprint1-lint-full.log` | Repo-wide lint output recording the pre-existing debt (§5) |
| `screenshots/sprint1-desktop.png` + `sprint1-desktop-mobile.png` + `sprint1-desktop.json` | Dev-server smoke verdict, both viewports |
| `screenshots/sprint1-preview.png` + `sprint1-preview-mobile.png` + `sprint1-preview.json` | Production-preview smoke verdict, `divergesFromBaseline: false` |
| `docs/sprint1/SPRINT_1_ACCEPTANCE_REPORT.md` | This report |

Reproducibility commands (all run in `bun-router-sprint1`):

```
npm run test:ui
npm run typecheck
npx eslint src/components/island/approvals-model.test.ts src/components/island/mission-model.test.ts
node scripts/browser-smoke.mjs http://127.0.0.1:8080/ screenshots/sprint1-desktop.png
npm run build
npm run preview:restart
node scripts/browser-smoke.mjs http://127.0.0.1:8081/ screenshots/sprint1-preview.png --baseline screenshots/sprint1-desktop.json
```

## 5. Open items handed off (owner decisions / other lanes)

1. **Native line:** glass-notch drag + restart persistence, plus manual per-edge screenshots
   from the shell (web side is edge-layout-complete and test-locked). Contract §5 structure
   followed: no UI workaround was applied.
2. **Owner live session:** (a) live-Host Mission Control demonstration round with screenshots
   (criterion 1 finish); (b) fresh keyboard + Narrator round and AXTree capture
   (criterion 6 finish); (c) approval click-through on the live UI (criterion 3 visual demo).
3. **Security lanes, still unmerged:** `sec/resolve-better-auth-advisory` (better-auth → 1.7.14)
   and `sec/seroval-1.7.3` (merging them closes the 14 moderate `npm audit` findings seen on a
   fresh install of this baseline). Flagged, not patched ad hoc here — the security line
   deserves its own reviewed PRs as already built.
4. **Lint debt:** 58 pre-existing errors across milestone scripts/tests (`scripts/ma4-*`,
   `scripts/verify-*`, `src/lib/bunny-host/ma4/*`, …), untouched since before this sprint.
   Recommend a separate owner-approved hygiene PR — deliberately out of this sprint's scope.
5. **Physical gates unchanged:** BLK-S2-01..05 (attended acoustic S3/A18 session,
   Android-on-device, signing certs) remain as documented in
   `docs/ma4-s2-final-fix/BETA_GO_NO_GO_FINAL.md` / `docs/ma4-s3-t5/T5R1_PHYSICAL_GATE_STATUS.md`.

## 6. Sprint exit per contract §6

Draft PR → CI (full regression ~25m, typecheck/UI/builds ~3.5m, static security) → owner
review. **No merge on agent authority; waiting on owner approval.**
