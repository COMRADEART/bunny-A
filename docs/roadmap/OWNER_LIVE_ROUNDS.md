# BUNNY A — OWNER LIVE SESSION ROUNDS (queued checklist)

**Product:** Bunny A by LOKAM
**Purpose:** The acceptance items that need the owner at the running product. Queued by
Sprint 1 (§5 item 2 of `docs/sprint1/SPRINT_1_ACCEPTANCE_REPORT.md`) and Sprint 2 (§5 item 2
of `docs/sprint2/SPRINT_2_ACCEPTANCE_REPORT.md`). Nothing here was executed by the agent —
every round below is owner-attended by definition. An agent never starts these.
**How to use:** do one round per sitting, note ✅/❌ per step, drop screenshots into
`screenshots/` (name prefix `owner-round-<n>-…`) and paste a one-line result per round into
the sprint PR. Skip nothing silently — a ❌ is a finding, not a failure of the round.

---

## Round 1 — Mission Control on the live Host (Sprint 1 criterion 1 finish)

1. Start Bunny A normally (installed island or `scripts/start-bunny-island.ps1`) with the
   real Host online.
2. Start a real Mission and watch Mission Control in the notch: list → detail → step breakdown.
3. Expected: every rendered row traces to a real Host event (tasks, missions, approvals appear
   and disappear with the Host's own records; no invented progress, no percentages, no demo data).
4. Capture: 2–4 screenshots (list, detail, mid-Mission) → `owner-round-1-*.png`.
5. Done when: one full Mission showed only true state from start to completion.

## Round 2 — Keyboard + Narrator round with AXTree capture (Sprint 1 criterion 6 finish)

1. Same setup, Narrator running (`Win+Ctrl+Enter`).
2. Keyboard only: walk the notch — mission list → detail → approval target; open/close the
   expanded panel; change dock edge only by keyboard.
3. Expected: every control reachable and announced; no silent controls; dropdown changes echo
   what saved (its edge stays after reopening Bunny).
4. Capture: AXTree snapshot per the method in `docs/ma4-s2-final-fix/NARRATOR_LIVE_VERIFICATION.md`
   + 1–2 screenshots → `owner-round-2-*.png`.
5. Done when: the full keyboard flow works and Narrator named every state you passed through.

## Round 3 — Approval click-through (Sprint 1 criterion 3 visual demo)

1. Same setup; have an agent/Mission ask for exactly one approval (WAITING_FOR_USER).
2. Click the approval once; then click again on the same (already resolved) item if still shown.
3. Expected: exactly one approval event reaches the Host; the repeat click creates nothing;
   nothing else flips state; spoken phrases around the click create zero approvals (Round 4's
   voice rules already lock this model-side, this is the visual demo).
4. Capture: screenshot before/after → `owner-round-3-*.png`.
5. Done when: the Host record shows exactly one approval for the whole session.

## Round 4 — Physical drag round (Sprint 2 finish: press-drag-release, real chords)

Already locked by fresh evidence: the native save/restore path itself (synthetic release
points + the chord body) — `test-results/sprint2-notch-persist-receipts.json`, 132/132.
This round covers what only a real hand can prove:

1. Same setup, notch on any edge.
2. **Drag to each of the four edges** in turn: press on the notch body (not on a control),
   drag it to another edge, release. Expected: it snaps to the edge nearest the pointer,
   re-centres along that edge, the Settings dropdown follows; **restart Bunny** after each
   edge → the docked placement comes back exactly (edge, along-border position, orientation).
3. **Drag-cancel:** press, move a hair (< about 6 px), release without docking anywhere.
   Expected: nothing changes — the notch stays where it was (the move-threshold rule).
4. **Real chords:** press `Ctrl+Alt+Arrow` for each arrow. Expected: the notch docks to that
   edge at once and the change survives a restart.
5. **Second monitor (if you have one):** drag the notch onto the other monitor and release
   there. Restart → it comes back on that monitor. Then change that monitor's resolution (or
   unplug it) and restart → it comes back on the primary monitor instead, still fully on-screen.
6. Capture: one screenshot per edge after its drag → `owner-round-4-<edge>.png`; one per
   restart if anything differs from the pre-restart state.
7. Done when: every drag paste + restart shows the same placement, and the cancel/chord
   behaviors above never wrong-foot you.

---

**Evidence home for all rounds:** `screenshots/owner-round-*.png` + a per-round result line
in the sprint PR (✅ or ❌ + one sentence). A ❌ in any step opens a follow-up item instead of
a re-run of the round.
