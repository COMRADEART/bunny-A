# SPRINT 2 ACCEPTANCE — NATIVE NOTCH PERSISTENCE

**Product:** Bunny A by LOKAM
**Contract:** `docs/roadmap/SPRINT_2_NOTCH_PERSISTENCE.md` (executes Sprint 1 acceptance report §5 item 1)
**Base:** main `a6efd7e` (Merge PR #70, lint hygiene 0 errors / 20 warnings)
**Branch / worktree:** `ma5-s2-sprint2-notch-persistence` in `bun-router-sprint2` (clean checkout off updated main; owner's root-worktree edits untouched)
**Date:** 2026-10-31
**Execution mode:** fresh native evidence pass + unit locks. The real WPF island shell was driven
through a committed evidence harness (`scripts/notch-persist-harness.mjs`) against the committed
disposable fixture host (`test-results/ma3/t13/notch/fake-host.mjs`, ports 43800–43899 only) —
ten island launches, one per dock / keyboard / restart step. One mechanical source extraction
moved the island's startup preference-load loop into the existing pure rules file so its rules
became testable. No web `src/` file changed.

**Overall: PASS (agent scope)** — every contract criterion is met with fresh current-code
evidence and unit locks; every automated local gate is green. Outstanding before merge:
full `npm test` in CI (runs on this PR, ~24 m) and, after merge, the owner-attended physical
round (queued as `docs/roadmap/OWNER_LIVE_ROUNDS.md` round 4). Neither is claimable until it
runs; nothing is claimed on their behalf.

---

## 1. Verdict per contract criterion

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Save on dock: release on all four edges saves edge, along-edge offset, center position, monitor fingerprint to the Island preference file | **PASS** | Harness dock stage: 16 checks × 4 edges = **64 checks PASS** (receipts `dock-top/bottom/left/right*`), including read-back of the Island's own preference file (`edge`, numeric `edgeOffset`, `monitor.device`) and Settings dropdown sync. Release points are synthetic device coordinates invoking `Invoke-BunnyDockRelease` — the exact coverage contract of the M-A-3 T13 drag receipt, not a physical press-drag gesture. |
| 2 | Save on keyboard dock: chord body saves through the same Island save as a drag release | **PASS** | Harness keyboard stage on `top`: 8 checks PASS; then a cold restart restored it (12 more PASS → 20 keyboard-path checks total). Source locks: `Set-BunnyDockEdge` normalises + re-centres + saves; the Up/Down/Left/Right chord map is locked (`Test-BunnyDockKey` routes every arrow through the saving body, never a fallback). |
| 3 | Restore on restart: cold start applies everything before any input, taskbar-safe | **PASS** | Harness restore stage: 11 checks × 4 edges (+ 11 for the keyboard-restored restart) = **60 checks PASS**: edge, exactly-equal offset (1e-6), position, monitor device+fingerprint, orientation, indicator side, expansion direction, window fully inside the primary work area, per-edge screenshot of the restored state. The restore-run hook applies no input — it records what startup alone restored. |
| 4 | Restore-rule matrix at unit level (monitors/DPI) | **PASS** | New placement-suite locks: matched device+work-area-fingerprint chosen; DPI/resolution change → primary fallback; detached display → primary; no monitors → no monitor; fingerprint stable for drift smaller than half a DIP cell and distinguishes 1920×1040 vs 1536×816 (125%) vs 2560×1400-negative-left secondary. Screens/scale are this machine's; the matrix is locked against the pure rules instead. |
| 5 | Safe loading: only known keys; corrupt file never breaks the show; hostile values validated at placement | **PASS** | Extracted `Import-BunnyPreferences` / `Get-BunnyPreferenceKeys` in `install/Bunny-Island.Placement.ps1` (same semantics as the retired inline loop); source-locked + unit-locked: corrupt JSON → 0 applied, caller keeps defaults; unknown key (`fancy`) skipped; unknown edge → top, non-numeric offset → 0.5 at placement time. Preference round trip (12 keys, 20 saved-shape combinations incl. left/right position overrides and string `0.2`) lands on a footprint identical to direct placement. |
| 6 | Gates: lint 0 errors, typecheck clean, placement suite green; full `npm test` in CI | **PASS locally / CI pending** | Repo-wide `npm run lint`: **0 errors, 20 warnings** (the post-PR-#70 baseline). `npm run typecheck`: clean. `node --test scripts/island-placement.test.mjs`: **20/20 pass, 0 fail** (13 prior + 7 new). Full `npm test` runs in CI on this PR — verdict reported below when green; nothing is asserted on its behalf here. |

**Harness total: 132 checks recorded, 0 fail** (`test-results/sprint2-notch-persist-receipts.json`;
per-run logs `test-results/sprint2-notch-*.log`; ten island launches). Machine: Windows,
main desktop scale factor 1.0; fixture host on 127.0.0.1:43800 only — no production Host, no
43119, no 8084 was ever contacted.

## 2. What changed in this PR

`git diff --numstat` (code files only, against `a6efd7e`):

```
23    0  install/Bunny-Island.Placement.ps1       (+ extracted Import-BunnyPreferences / Get-BunnyPreferenceKeys)
 4    1  install/Bunny-Island.Visual.ps1          (startup load line now calls the extracted rule behind the same Test-Path guard; try/catch preserved)
252   0  scripts/island-placement.test.mjs        (+7 Sprint 2 tests: restore matrix, round trip, in-area, fingerprint, 3 source locks)
258   0  scripts/notch-persist-harness.mjs        (+ fresh evidence driver: verdicts recomputed outside the island)
 51   0  scripts/notch-persist-hook-dock.ps1      (+ in-island dock-step hook: synthetic release → snap → save → record)
 39   0  scripts/notch-persist-hook-keyboard.ps1  (+ in-island keyboard-step hook: chord body → save → record)
 39   0  scripts/notch-persist-hook-restore.ps1   (+ in-island restore-step hook: no input, records what startup restored)
 18   0  scripts/notch-persist-wrapper.ps1        (+ island launch wrapper, TestHook scriptblock pattern from T13)
```

Everything else is committed evidence (§4) and documents (§3, §5). The only native source
edits are the semantics-preserving extraction in §2; production behavior is unchanged — the
startup line runs the same loop, now as a named pure rule.

The seven new placement-suite tests (exact names as they appear in the suite log):

1. `Sprint 2: Select-BunnyMonitor restore matrix — matched device with the same work-area fingerprint is chosen, a DPI/resolution change or a detached display falls back to the primary, and an empty list returns no monitor at all`
2. `Sprint 2: preferences saved by a dock release (edge, along-edge offset, position, monitor) reload through the startup load rule and place the notch at the identical footprint`
3. `Sprint 2: the saved monitor footprint lies inside the chosen work area after restore (placement recomputed from the loaded values stays in the primary when the display changes)`
4. `Sprint 2: a work-area fingerprint is stable for drift smaller than half a DIP cell (rounding) and distinguishes every real geometry change (resolution, DPI, another display)`
5. `Sprint 2 source lock: a drag release saves edge, along-edge offset, centre position and the monitor fingerprint through the Island save, and routes the snap through the tested nearest-edge rule`
6. `Sprint 2 source lock: the keyboard chord body (Set-BunnyDockEdge) saves the edge through the same Island save as a drag release`
7. `Sprint 2 source lock: startup applies only known preference keys (extracted Import-BunnyPreferences behind a file-existence guard; corrupt files never break the show; unknown keys ignored)`

## 3. Scope discipline (contract §5 non-goals — all held)

- No web `src/` island changes (persistence is native-shell-owned; the web island stays
  edge-layout-complete and test-locked from Sprint 1).
- No voice-worker / Whisper / Android / DB-migration / dependency changes; no auth; no backend.
- Owner root worktree untouched; the sprint ran entirely in `bun-router-sprint2`.
- The masterplan is not edited (M2 wording update is an owner decision after merge).

## 4. Evidence inventory

| Artifact | Content |
|---|---|
| `test-results/sprint2-notch-persist-receipts.json` | The full 132-check receipts with per-check PASS/FAIL, milestone, coverage/fixture statements |
| `test-results/sprint2-notch-dock-{top,bottom,left,right}.log` | The 4 dock-step island launches (stdout+stderr, one file per launch) |
| `test-results/sprint2-notch-restore-{top,bottom,left,right}.log` + `sprint2-notch-restore-top-keyboard.log` | The 5 cold-restart island launches |
| `test-results/sprint2-notch-keyboard-top.log` | The keyboard chord-body island launch |
| `screenshots/sprint2-dock-{top,bottom,left,right}.png` | The docked notch after each edge's release |
| `screenshots/sprint2-restore-{top,bottom,left,right}.png` | The cold-restarted notch per edge (the `top` one documents the final keyboard-restored restart; both top restarts recorded as PASS in the receipts) |
| `screenshots/sprint2-keyboard-top.png` | The chord-body-docked notch |
| `docs/roadmap/SPRINT_2_NOTCH_PERSISTENCE.md` | This sprint's contract |
| `docs/sprint2/SPRINT_2_ACCEPTANCE_REPORT.md` | This report |
| `docs/roadmap/OWNER_LIVE_ROUNDS.md` | The queued owner-attended rounds (incl. the new physical drag round) |

Reproducibility commands (all run in `bun-router-sprint2`):

```
node scripts/notch-persist-harness.mjs        # replay of the 132-check evidence pass
node --test scripts/island-placement.test.mjs # 20/20 unit locks
npm run lint                                  # 0 errors, 20 house warnings
npm run typecheck                             # clean
```

## 5. Open items handed off (owner decisions / other lanes)

1. **CI full regression:** full `npm test` (~24 m) runs on this PR. On green, this report
   gains the CI-verdict line; on red it is fixed before the PR leaves draft.
2. **Owner live-session rounds:** the three Sprint-1 rounds are still open, and this sprint
   adds a fourth — the physical drag round (press-drag-release on all four edges, real
   Ctrl+Alt+Arrow chords, and drag-with-no-move canceling). All four are queued step-by-step
   in `docs/roadmap/OWNER_LIVE_ROUNDS.md`; none was executed by the agent.
3. 3. **Security lanes - status CORRECTED 2026-10-31 (carry-over bullet was stale):** the two
   lanes carried from Sprint 1 5.3 are already MERGED into main - PR #54 (better-auth ->
   1.7.14, commit `68951b5`) and PR #62 (seroval -> 1.7.3, commit `0e49c7b`);
   both advisories no longer appear in `npm audit` on main `b58611b`. The
   residual audit findings are dev-toolchain-only (eslint/minimatch chain) and are queued
   as lane `sec/minimatch-toolchain-override`. No ad hoc patching happened in
   this sprint.
4. **Masterplan §5:** after the owner reviews and merges this PR, the M2 wording can be
   bumped to record drag/keyboard/restart persistence as locked + evidenced; left to the owner.

## 6. Sprint exit per contract §3.6

Draft PR → CI gates (static security; typecheck/builds; full `npm test` ~24 m) → owner
review. **No merge on agent authority; waiting on owner approval.**
