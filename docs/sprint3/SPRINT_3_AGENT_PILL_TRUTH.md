# M2 Sprint 3 contract — agent-visual truthfulness lock (notch active row)

**Branch:** `ma5-s3-sprint1-agent-visuals` · **Base:** main `8685c59`
**Rule book:** master directive §13–§15; masterplan `docs/roadmap/BUNNY_A_PRODUCT_MASTERPLAN.md` §2 (obligation 1: truthfulness), §5 M2 ("agent-visual truthfulness lock + re-run `test:ui`, browser smoke, UIA notch tree").

## Audit → contract (why this slice)

Recon before coding (one merged worktree, read-only):

- The horizontal notch already renders an active-agent row (`floating.tsx`, `.island-active-agents`), fed by provider tasks (`activeTasks(store.tasks)`), capped at 3 with **no overflow indicator** and **no truthful fallback**: missing `truthState` rendered a literal **"Working"** — fabricated state.
- Row layout was keyed to `position === "left"` only; a **right-docked** notch was laid out horizontally, contradicting the native rule that left/right docks are vertical (`install/Bunny-Island.Placement.ps1`, mirrored by `character-style-model.ts` `notchLayout()`).
- The repo already owns canonical, honest state words: `TruthState` (`src/lib/orch/types.ts`) and `taskStatus()` labels (`src/lib/bunny-host/presentation.ts`). No new vocabulary needed.

## Contract

1. **No invented labels.** A pill shows the Host's own words only: `truthState` verbatim, else the canonical `taskStatus` label for the task's state. `Working` is truthful only when truth state says so. Reconciliation-required tasks are honest (`outcome uncertain — reconciliation required`), never guessed.
2. **Approval visible in the notch.** `waiting_for_approval` / `waiting_for_agent_approval` / truth `Awaiting approval` render an approval-tone pill; `waiting_for_input` renders "Waiting for user".
3. **Capped rows stay visible.** The row still shows at most 3 pills, but overflow is reported ("+N", title names the count; aria announces the total). No silent hiding.
4. **Axis rule locked.** center = horizontal row; left/right = vertical column with agent indicators placed above the status region — mirroring the native placement doctrine and fixing the right-dock layout.
5. **Visual continuity.** The two shipped tones (testing blue, reviewing purple) keep their exact colors; neutral stays; approval/paused tones are additive.
6. **Scope guard.** No native shell changes, no voice changes, no store changes; the slice is the pill row only. Personal-agent identity art remains in `WeaponStrip`/native systems (separate lanes), so the pill row is re-labeled truthfully as "Active tasks".

## Files

- `src/components/island/agent-pill-model.ts` (+`agent-pill-model.test.ts`): pure truth model (`taskPill`, `activeAgentPills`, `agentRowLayout`, tone map, known-label guard).
- `src/components/island/floating.tsx`: consumes the model (label/tone/overflow/layout); aria label `Active tasks: N`.

## Test locks (10, node:test, pure — no DOM)

Verbatim TruthState pass-through for all 12 values · canonical-label matrix for all 9 active states · reconciliation label · Working only when true · approval tone with/without truthState · detail format · tone-color continuity · cap+overflow math · no `%`/ETA invention · axis matrix.

## Gates

`npm run test:ui` (whole island suite), `npm run lint` (baseline: 0 errors / 20 warnings), `npm run typecheck`, then CI (static security; typecheck/builds/UI; full `npm test` ~25 m). Evidence receipts under `test-results/sprint3-agent-visuals/`. Owner physical re-check of the notch belongs to Rounds 1–2/4 of `OWNER_LIVE_ROUNDS.md`.
