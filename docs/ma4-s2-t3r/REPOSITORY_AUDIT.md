# MA4-S2-T3R — Repository audit (Phase 0)

## Baseline

| Item | Value |
|---|---|
| Base | `e2225b4` — merge of PR #26 (MA4-S2-T3 proactive companion) into `ma4-s1r3-agent-reliability` |
| Branch | `ma4-s2-t3r-product-qualification`, worktree `bun-router-s2t3r` |
| Hosted CI on the base | run 40048602114 at `e2225b4`: **success** (full regression, typecheck/UI/builds, static security) |
| PR #26 history | merged by the owner before its PR runs finished; the PR run 40047777466 and push run 40047750090 were red on two flakes (below) |

## Flakes found at the base

| Test | Cause | Action |
|---|---|---|
| `remote-device.test.ts` F19/F20/F23 — "The agent already completed; nothing to stop" | race: the device Stop could arrive after the second agent finished | fixed deterministically in `9dc9864` (the device waits for a pending approval before Stop; the fixture file must survive) |
| `provider-containment.test.ts` F04 R1-BYPASS-1 — python `ETIMEDOUT` | hosted Python cold start exceeds the product's 10 s verification timeout | **not changed** — the product timeout is a safety bound; recorded, watched in final-head CI |

## Fresh-worktree prerequisites (git-ignored, never committed)

Staged from the owner's main checkout before any test: `native/voice/vendor/` (pinned whisper runtime, hash-checked by
`stage-whisper.mjs`/packaging) and `releases/installed/JEV-Windows-v1/runtime/LICENSE` (Node runtime notice). `pretest`
rebuilds `native/voice/bunny-voice-worker.exe/.json`; they are restored with `git checkout --` after every run.

## What S2-T1/T2/T3 already provided (reused, not rebuilt)

Persistent task runtime (leases, fencing, exactly-once ledger, UNCERTAIN), the permission broker with payload-hash action
approvals and receipts, and the proactive engine (goals, schedules, monitors, `decide()`, occurrence primary key as the
duplicate guard). What was missing for a product: creation UIs, previews, an Approval Center that explains context, and
qualification on an installed build, a physical phone, real elapsed time and a real model.

## Concurrent writer (disclosed)

Between 22:27 and 23:16 local on 2026-10-23 a Codex desktop session worked in the same worktree and branch (commits
`6992dee`, `f1bbf85`, `8802e0c`, plus uncommitted evidence). The owner stopped it; its commits were reviewed and their tests
re-run (state marker 4/4, release 6/6); its evidence was committed separately with review notes (`ad44212`).
