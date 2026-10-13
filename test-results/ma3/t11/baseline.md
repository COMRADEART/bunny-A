# M-A-3 T11 baseline (recorded before any T11 code change)

Recorded 2026-10-11 (UTC 18:22–18:37) on branch `claude/ma3-t9-phone-remote`.

## Source and evidence pins (verified, not reconstructed)

| Item | Value | How verified |
|---|---|---|
| T10 report | `MA3_T10_LIVE_VOICE_ACCEPTANCE.md` | read; verdict line `BUNNY_MA3_T10_PASS_WITH_LIMITATIONS` |
| T10 source pin | `2d5646d5c5a95ab040239b20b034e2c6b0828365` | report header "Source pin: `2d5646d`"; `git rev-parse 2d5646d` |
| T10 evidence commit | `bde8186d7fed7643edb6322502177a7f341086a4` (HEAD at T11 start) | `git rev-parse HEAD` |
| Evidence-only descendant | `git diff --name-only 2d5646d bde8186` touches only `test-results/ma3/t10/**` and `MA3_T10_LIVE_VOICE_ACCEPTANCE.md` (158 files) | command output |
| F04 source ancestry | `git merge-base --is-ancestor 43ffee8 2d5646d` → yes | command exit 0 |
| T10 pin ancestry | `git merge-base --is-ancestor 2d5646d HEAD` → yes | command exit 0 |

## Working tree at start

Tracked files: clean. Untracked and protected (never staged, never modified by T11):
`BUNNY_OPENDOTS_ADOPTION_REPORT.md`, `MA1D_FINAL_INDEPENDENT_REVIEW.md`, `MA1_CLAUDE_FINAL_REVIEW.md`,
`MA2_FINAL_INDEPENDENT_REVIEW.md`, `a.txt`, `memory/`.
`test-results/` is gitignored; sealed historical evidence is force-tracked and was restored with
`git checkout -- test-results/ma3/{t5,t6,t7,t9r}` after the baseline run rewrote it (known T5/T6/T7/T9R test behaviour).

## Baseline regression on `bde8186` (= source `2d5646d` + evidence)

Runner: `test-results/ma3/t11/baseline/run-regression.sh` (same split as T10). Logs in `baseline/`.

| Part | Result | Seconds |
|---|---|---|
| pretest (owned-process + voice worker build) | exit 0 | 2 |
| scripts suite | **353 / 353** pass, 0 fail, 0 skipped, 0 cancelled | 265 |
| library suite | **1,133 / 1,133** pass, 0 fail, 0 skipped, 0 cancelled | 486 |
| agent suite | **24 / 24** pass | 24 |
| UI suite | **184 / 184** pass | 1 |
| typecheck | exit 0 | 9 |
| lint | exit 0 — 0 errors, 22 pre-existing warnings | 26 |
| desktop build | exit 0 | 38 |

**Total: 1,694 / 1,694 distinct tests passing** — matches the T10 floor exactly (scripts 353, library 1,133, agent 24, UI 184).

## Machine facts relevant to T11

- GPU: NVIDIA GeForce RTX 4050 Laptop, 6,141 MiB VRAM; 22 logical CPUs.
- Ollama (shared with production, read-only listing): `huihui_ai/qwen2.5-abliterate:7b` (4.7 GB), `qwen2.5-coder:7b` (4.7 GB),
  `huihui_ai/Qwen3.8-abliterated:27b` (17.7 GB), `huihui_ai/qwen3-abliterated:30b` (18.6 GB), `deepseek-v4.1-flash:cloud` (hosted tag).
  No model loaded at the time of the listing.
- Production `Bunny-A-Windows-v26-MA2-R1` (Host 43119, gateway 8084) is not touched; see `production-before.json`.
