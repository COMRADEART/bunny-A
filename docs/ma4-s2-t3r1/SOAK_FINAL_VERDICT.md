# MA4-S2-T3R1 — Real-clock soak verdicts (gate R1-G2, input to R1-G3 / R1-G11)

Two soaks, never merged into one result.

| Soak | Code | Started (UTC) | Purpose |
|---|---|---|---|
| **A — original T3R soak** | `e6b6645` (pre-dates 13 PR #27 commits) | 2026-10-24 01:32:17 | adjudicate the T3R pre-registration as written |
| **B — T3R1 candidate soak** | `448ca6b` (T3R1 candidate Host) | see §2 | reliability evidence for the beta candidate itself |

## 1. Pre-registration for soak B (frozen before it started; nothing changed afterwards)

Soak B reuses, unchanged, the T3R harness (`scripts/ma4-s2t3r/soak.mjs`, `soak-host.mjs`, `soak-report.mjs`) and the T3R
criteria S1–S12 with their thresholds (`docs/ma4-s2-t3r/REAL_CLOCK_SOAK.md` §2), including S5 (Host private-memory
least-squares slope per Host life after its first hour ≤ 50 MB / 24 h). No criterion is added, removed or relaxed, even
though soak A's interim data showed S5 failing: soak B tests whether the candidate passes the **same** bar.

- Frozen worktree `bun-router-soak-r1` detached at `448ca6b`; isolated data `%LOCALAPPDATA%\Bunny-S2T3R1-Soak`; Host port
  43192; synthetic project `Documents\new\bunny-soak-r1-project`; no heap probe or other preload (the measured process is
  the product Host alone; `NODE_OPTIONS` cleared).
- Same timeline: restarts at 6 h, 12 h, 21 h; offline 12 min at 9 h; crash at 15 h; background off 18–19.2 h.
- Verdict rule as in T3R: IN PROGRESS until 24 h of real time and the driver finished; then PASS only if S1–S12 all hold.
- Other processes on the PC during soak B (disclosed, not controlled): soak A until ~01:32 UTC 10-25, the 6 h heap
  reproduction until ~19:39 UTC 10-24, the isolated installed TEST release, Ollama.

## 2. Results

_Filled from `soak-report.mjs` output for each soak._
