# Sprint 3 acceptance report — agent-visual truthfulness lock (notch active row)

**Branch:** `ma5-s3-sprint1-agent-visuals` · **Base/verdict date:** main `8685c59` · 2026-11-01
**Contract:** `docs/sprint3/SPRINT_3_AGENT_PILL_TRUTH.md`

## What shipped

- `src/components/island/agent-pill-model.ts` — new pure truth model for the notch's active row:
  - label = Host `truthState` **verbatim**, else the canonical `taskStatus()` label;
  - **removed the invented "Working" fallback** (the one fabrication in the row);
  - reconciliation-required tasks surface the honest reconciliation label, not a guess;
  - approval states (`waiting_for_approval`, `waiting_for_agent_approval`, truth `Awaiting approval`) render the approval tone — the notch now shows when it needs you; `waiting_for_input` renders "Waiting for user";
  - row keeps the 3-pill cap but reports overflow (`+N`, total announced) instead of silently hiding;
  - `agentRowLayout()` locks the notch axis rule (center = horizontal; left/right = vertical column, agents above the status region) mirroring `install/Bunny-Island.Placement.ps1` — and fixes the untested right-dock layout bug.
- `src/components/island/floating.tsx` — pill row now consumes the model (label, tone, overflow, layout); aria label corrected to "Active tasks: N" (the row shows task-state truth; agent identity art remains in WeaponStrip/native systems, out of this slice's scope).
- `src/components/island/agent-pill-model.test.ts` — **10 truth locks**, node:test, pure (no DOM): verbatim TruthState pass-through (all 12), canonical-label matrix (all 9 active states), reconciliation label, "Working only when true", approval tone with/without truthState, detail format, shipped color continuity, cap+overflow math, no-`%`/-ETA invention guard, axis matrix.

## Gates (local receipts, `test-results/sprint3-agent-visuals/`)

| Gate | Result |
|---|---|
| agent-pill truth locks | **PASS** — 10/10 (`node --test`, first run and after fixes) |
| `npm run test:ui` (whole island suite incl. the new locks) | **PASS** — exit 0 |
| `npm run lint` | **PASS** — 0 errors / 20 warnings (identical to the PR #70 baseline) |
| `npm run typecheck` | **PASS** — exit 0 (after fixing two strictness findings: no-overlap comparison; readonly-array cast; test fixtures typed/complete) |
| `npm run build` (production) | **PASS** — exit 0 |
| CI on this PR | static security · typecheck/builds/UI · full `npm test` (~25 m) |

## Verdict

**PASS (agent scope).** Remaining human confirmation: Owner Rounds 1–2/4 in `docs/roadmap/OWNER_LIVE_ROUNDS.md` (visual + keyboard/TalkBack re-qualification) — not re-qualified here.

## Scope guards honored

No native shell change · no voice, store, or mission-engine change · no fabricated progress anywhere · no security check disabled; CI full regression and gates unchanged.
