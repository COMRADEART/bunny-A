# MA4-S2-T3R1 — Baseline audit (gate R1-G1)

Verified 2026-10-24 13:28–13:50 UTC.

| Item | Verified value |
|---|---|
| PR #27 | `OPEN` at 13:28 UTC (`ma4-s2-t3r-product-qualification` → `ma4-s1r3-agent-reliability`, head `10993bd897936b3e6478f81aed9a3b522bfc5b51`); subsequently merged at `1f36d951a380783d4cbfcf70ead72891d88c55b4` (`git diff 10993bd..1f36d95` is empty — 0 changed files) |
| PR #28 | `ma4-s1r3-agent-reliability` → `main`, merged at `0fce711` with all 6 hosted CI checks `SUCCESS` |
| PR #27 head | `10993bd897936b3e6478f81aed9a3b522bfc5b51` (matches the brief; tree-identical to `1f36d951a380783d4cbfcf70ead72891d88c55b4`) |
| Hosted CI on that head | run `40061898956` (pull_request): static security checks, typecheck/MA4/UI/builds, full npm test — all **success**; run `40061882594` (push) also success |
| T3R worktree | `bun-router-s2t3r` at `10993bd`, clean |
| T3R1 branch | `ma4-s2-t3r1-beta-closure`, worktree `bun-router-s2t3r1`, stacked on `10993bd` (preserved without rebase so frozen candidate SHA `448ca6b` matches Soak B and installed-candidate evidence) |
| Integration branch | `ma4-s1r3-agent-reliability` (PR #27's base); nothing is merged by this milestone |
| Running soak | driver pid 32948 + Host, worktree `bun-router-soak` detached at `e6b6645`, clean; data `%LOCALAPPDATA%\Bunny-S2T3R-Soak`; started 2026-10-24 01:32:17 UTC |
| Other worktrees | 18 earlier worktrees preserved, none modified |
| Other writers | a Codex app-server daemon process is resident (since 10-23 22:10 local) but no commit or file change from it on the T3R/T3R1 branches since the owner stopped it (T3R `REPOSITORY_AUDIT.md`); checked again before every commit |
| Main checkout | `bun-router` on `ma4-s1-model-intelligence` has pre-existing unrelated modified test-result JSON and untracked files; untouched |

## Finding that shapes the release decision

The soak's frozen commit `e6b6645` **predates 13 commits of PR #27** (`d593bdd` … `10993bd`), including Host changes in
`proactive.server.ts` (+85 lines), `proactive.ts`, `task-commands.server.ts`, `task-executors.server.ts`,
`task-runtime.server.ts` and `http.server.ts` (31 files, +1,511 / −42 under `src/` and `scripts/`). Whatever the original
soak's verdict, it describes the `e6b6645` Host, not the T3R final head and not the T3R1 candidate. A reliability claim for
the beta candidate needs a soak of the candidate itself (`SOAK_FINAL_VERDICT.md`).

## Installed and physical-device evidence at baseline

- Installed Windows: T3R's 18/18 ran on the isolated TEST install `S2T3R4-TEST` built from `8802e0c`; that install was
  removed afterwards (`docs/ma4-s2-t3r/evidence/installed/cleanup.json`). Nothing is installed now.
- Physical Android: Samsung SM-S948U, app `com.routeragent.jev` 2.1 (3). At this audit the phone is **not attached**
  (`adb devices` lists nothing) and no tunnel process is running (no `cloudflared`, `ngrok` or `tailscale` process).
