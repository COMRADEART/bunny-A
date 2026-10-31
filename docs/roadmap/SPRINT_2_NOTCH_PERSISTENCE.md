# SPRINT 2 — NATIVE NOTCH PERSISTENCE (contract)

**Product:** Bunny A by LOKAM
**Owner milestone:** M2 (Native UX Mastery), per `BUNNY_A_PRODUCT_MASTERPLAN.md` §5
**Status:** Executed in this PR. Acceptance: `docs/sprint2/SPRINT_2_ACCEPTANCE_REPORT.md`.
**Base:** main `a6efd7e` (after PR #70 lint hygiene merged)
**Branch / worktree:** `ma5-s2-sprint2-notch-persistence` in `bun-router-sprint2`
**Parent handoff:** Sprint 1 acceptance report §5 item 1 (criterion 5: drag + restart persistence
for the glass notch, native-shell-owned) and §5 item 2 (owner live-session rounds, queued here).

---

## 1. Objective (one sentence)

Prove with fresh, current-code evidence that the Windows glass notch keeps its docked
placement — edge, along-edge offset, center position and preferred monitor — across a
cold restart, and lock every claim with unit tests so the behavior cannot silently regress.

## 2. Scope

| Surface | Existing anchor | Sprint work |
|---|---|---|
| Dock save on release | `install/Bunny-Island.Visual.ps1` `Invoke-BunnyDockRelease` → preference file | fresh per-edge evidence + source locks |
| Keyboard docking | `Set-BunnyDockEdge` (the body the real Ctrl+Alt+Arrow chords call) | fresh evidence on the chord body + source locks |
| Cold-restart restore | `install/Bunny-Island.Visual.ps1` startup load → `Select-BunnyMonitor` / `Get-BunnyPlacement` | fresh restart evidence per edge |
| Restore rules | `install/Bunny-Island.Placement.ps1` (pure, unit-tested) | new unit locks: monitor-restore matrix, preference round trip, corrupt-file safety |
| Startup preference load | inline loop inside `Bunny-Island.Visual.ps1` | **one mechanical extraction** into the pure rules file (`Import-BunnyPreferences` / `Get-BunnyPreferenceKeys`) so the only-known-keys and corrupt-file rules become testable; `Visual.ps1` calls it behind the same `Test-Path` guard, same semantics, no behavior change |
| Owner-attended fidelity | physical island on the owner's desktop | rounds queued in `docs/roadmap/OWNER_LIVE_ROUNDS.md` |

## 3. Acceptance criteria

1. **Save on dock:** a release point on each of the four edges (synthetic device
   coordinates invoking `Invoke-BunnyDockRelease` — the same native snap/release path a
   real drag release takes) saves edge, along-edge offset, `center` position and the
   monitor binding (device name + work-area fingerprint) to the Island preference file.
2. **Save on keyboard dock:** the chord body `Set-BunnyDockEdge` saves the edge through
   the same Island save as a drag release; the key→edge mapping for Up/Down/Left/Right is
   locked in source.
3. **Restore on restart:** a cold start of the Island loads exactly what was saved —
   edge, along-edge offset, position, monitor, orientation, indicator side, expansion
   direction — applies it before any input, and keeps the window fully inside the primary
   work area (taskbar-safe).
4. **Restore-rule matrix at unit level:** matched device+fingerprint is chosen; a DPI /
   resolution change or a detached display falls back to the primary monitor; no monitors
   at all → no monitor; a work-area fingerprint distinguishes every real geometry change.
5. **Safe loading:** only known preference keys load; a corrupt or unreadable file
   returns zero applied keys and never breaks the show; hostile values (unknown edge,
   non-numeric offset) are validated at placement time, not trusted from the file.
6. **Gates:** repo-wide lint 0 errors / 20 house warnings, typecheck clean, placement
   suite 20/20 (13 prior + 7 new); full `npm test` runs in CI on this PR.

## 4. Coverage doctrine (no claim inflation)

- Native actions are driven by synthetic release coordinates and the keyboard chord
  **body**, exactly like the M-A-3 T13 drag receipt (`test-results/ma3/t13/notch/`).
  This is native snap/release + save/restore coverage — it is **not** a physical
  press-drag gesture, and no physical Ctrl+Alt+Arrow chords are pressed. Physical rounds
  stay owner-live (queued in `docs/roadmap/OWNER_LIVE_ROUNDS.md`, round 4).
- Every verdict in the receipts is recomputed by the driver from what the Island wrote,
  never passed through by the Island itself.
- Screens/scale are this machine's; the monitor/DPI fallback matrix is locked at unit
  level against the pure rules instead of countless physical monitors.

## 5. Non-goals

- No web `src/` island code changes (persistence is native-shell-owned; the web island
  is edge-layout-complete and test-locked from Sprint 1).
- No voice-worker / Whisper / Android / DB-migration changes; no new dependencies.
- No auth, no backend changes, no masterplan edit (masterplan M2 wording updates after
  the owner reviews this PR).
- Owner root worktree untouched; all work in the separate sprint worktree.
