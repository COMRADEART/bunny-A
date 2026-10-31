# SPRINT 1 — NATIVE UX / MISSION CONTROL VERTICAL SLICE (contract)

**Product:** Bunny A by LOKAM
**Owner milestone:** M2 (Native UX Mastery), per `BUNNY_A_PRODUCT_MASTERPLAN.md` §5
**Status:** Contract — not yet executed. Do not present as implemented.
**Base:** `main` (after PR #67 lands, rebase; voice line stays owned by its branch)

---

## 1. Objective (one sentence)

Prove, end-to-end against the real Host, that Mission Control in the island shows true
agent/Mission/approval state, that the glass notch moves/holds its position, and that all of
it is keyboard- and Narrator-usable — with tests locking each claim.

## 2. Scope (reuse, do not rebuild)

| Surface | Existing anchor | Sprint work |
|---|---|---|
| Mission list + details | `src/components/island/mission.tsx`, `mission-model.ts(+test)` | live-Host mapping tests; loading/empty/error states |
| Step/task breakdown | `ptasks.tsx`, `ptask-model.ts(+test)` | dependency-order rendering from real DAG; no invented percentages |
| Approvals | `approvals.tsx`, `approvals-model.ts(+test)` | approval provenance event only from real owner input (locked by test) |
| Agent roster/state | `workers.tsx`, `agent.tsx`, `agent-model.ts(+test)` | idle/planning/working/waiting/complete/failed/recovering mapping |
| Glass notch placement | `floating.tsx`, `island.tsx`, `glass.css` | edge assignment (top/bottom/left/right), drag, persistence, safe-area checks |
| Connection | `host-stream.ts`, `connection-model.ts(+test)` | stale/disconnected states visibly labeled |

**Hard non-goals:** no voice-worker/Whisper/FSM changes (S3R1 owns that line), no Android
code changes, no DB migration, no new dependencies, no theme-system changes, no merge of
S3R1 lanes.

## 3. Acceptance criteria (all must have test or logged evidence)

1. Every agent/activity byte rendered traces to a real Host event in the current session —
   mock/fixture paths exist **only** behind a visible `DEMO` label and are unreachable in
   production config.
2. No fabricated progress numbers: task progress renders only measured facts (event counts,
   produced artifacts, step completion), never interpolated percentages (locked in
   `mission-model` test).
3. Approval click → single approval event → idempotent on repeat (regression for T9R
   duplicate calculator doctrine).
4. A spoken phrase or agent narration emitted by the product itself produces **zero**
   approval events (test asserts approval-source storage is owner-input-only; align with C4).
5. Notch can be dragged to all four edges and position survives app restart (persistence
   model test + manual screenshot evidence at each edge).
6. Full keyboard flow: reachable, operable, and focus-visible for list → detail → approval.
   Narrator: accurate role/name/state spoken for at least the five verified AXTree states
   previously used at MA4-S2.
7. `npm run test:ui`, targeted `npm run typecheck`, `npm run lint` pass; full `npm test`
   unaffected (may point to existing suite result).
8. Browser smoke passes desktop + mobile; production-preview smoke shows no divergence.

## 4. Evidence capture

- Screenshots: `screenshots/sprint1-*.png` (desktop+mobile, each edge placement, approval flow).
- Test logs: `test-results/sprint1-*.log`.
- Report: `docs/sprint1/SPRINT_1_ACCEPTANCE_REPORT.md` with PASS/PARTIAL/FAIL/BLOCKED per
  criterion 1–8 and explicit remaining blockers (§5).

## 5. Known-risk register (do not silently widen scope)

- S3R1 (PR #67) is a live parallel line touching voice FSM + harness; any island file it
  also touches (e.g., `voice.tsx` states) must be coordinated, not rewritten.
- Uncommitted edits in the root worktree remain owner-owned; this sprint must run in a
  clean worktree off `main` (rebase after #67 merges).
- Notch edge persistence crosses into native WPF/UIA behavior; if a native-side change is
  required, stop and file it for the native line instead of patching UI code around it.
- Demo/mock switch: if one must be added for development, it is feature-flagged,
  hard-disabled outside dev mode, and visibly labeled — never default on.

## 6. Sprint exit

Draft PR → CI green → acceptance report → owner review. Merge only on owner approval.
