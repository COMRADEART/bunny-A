# MA4-S2R1 — Repository and baseline audit (R1-G1)

Performed 2026-10-23 before any S2R1 change.

## 1. PR #17 and the base

| Item | Expected (brief) | Verified |
|---|---|---|
| PR #17 head | `b5271b1` | `b5271b17afb1bafd409cf73d93b27609c968a21d` (branch `ma4-s2-adaptive-agent-intelligence`) |
| Last code-validated commit | `ecdf84e` | `ecdf84e` is the parent of `b5271b1` (docs-only commit on top) |
| PR #17 state | draft, open | **MERGED** by the repository owner at 2026-10-23 11:15:37 UTC into `ma4-s1r3-agent-reliability`, merge commit `8867df4` |
| Tree of `8867df4` vs `b5271b1` | — | identical (`git diff --stat b5271b1 8867df4` is empty) |

S2R1 therefore branches from `b5271b1` as instructed (`ma4-s2r1-memory-relevance`, worktree
`../bun-router-s2r1`). Because #17 is already merged, the new draft PR targets `ma4-s1r3-agent-reliability`, the base
that now contains #17; the diff is exactly the S2R1 commits. #17's history was not touched.

## 2. Hosted CI at the start

| Run | Ref | Result |
|---|---|---|
| 39918572857 / 39921533795 | #17 (`ecdf84e`, `b5271b1`) | green |
| **39921539119** | #17 `pull_request` | **failed**: `T12 native fixture: continuous input and actual synthesis/null playback operate concurrently inside F04 Job` — worker-event timeout (`VOICE_CI_ROOT_CAUSE.md`) |
| 39944836044 | `ma4-s1r3-agent-reliability` after the merge | failed: `F04 R1-BYPASS-1` python verification `ETIMEDOUT` — unrelated hosted intermittency, reported separately |

## 3. S2 evidence reviewed (left unchanged)

All 13 S2 documents in `docs/ma4-s2/` and `docs/ma4-s2/evidence/*` (discover, validate, qualify, held-out, role
evidence, release logs). S2 pre-registration (`6ceac42`): 12 held-out tasks × 2 trials; primary C ≥ A + 3, sign test
p ≤ 0.10. Result: A 14/24, B 14/24, C 10/24; C vs A 1 win / 5 losses, p = 0.98; verdict "functionally complete,
intelligence improvement UNPROVEN". The S2 held-out set is spent and is used in S2R1 only as deterministic retrieval
regressions.

## 4. Components inspected

| Component | File | Finding |
|---|---|---|
| LotusStore | `lotus.server.ts`, `lotus.ts` | scoped (`agent:n`, `project:…`), layered, trust ceiling (steering text from non-users → `untrusted`), revisioned, credential-refusing; `rank` is word overlap + layer + trust + recency |
| Memory adapter | `ma4/experience.server.ts` | off by default; Host-written experience/skill-pointer records with a metadata row (type, content hash, validation, expiry, sensitivity); `retrieve` = authorized scopes, verified, unexpired, Host/user trust, hash-checked, then Lotus ranking over tag words |
| Skill selection | `ma4/skills.ts` `selectSkills` | **single shared coarse tag qualifies** a skill (root cause, `RETRIEVAL_ROOT_CAUSE.md`); up to 3 skills, no threshold, no abstention |
| Guidance builder | `ma4/skill-learning.server.ts` `buildGuidance` | resolves the selection once per task and caches it in the closure — a later rollback would not reach a running task |
| Skill registry | `ma4/skills.server.ts` | lifecycle with evidence-gated transitions, owner-only approval/activation, quarantine after 4 failed uses, rollback to the previous owner-approved version |
| Grouped scheduler | `ma4/coordinator.ts` `planSchedule`, `gateCalls` | `grouped` when two 7B models do not fit 6 GiB together; one call in flight; model-switch accounting |
| Evaluation corpus | `%LOCALAPPDATA%\Bunny-A\ma4-s2-eval\eval.sqlite` | 9 skills: 4 `benchmark_qualified` (`parse-date-procedure` v1, `slugify` v1, `calculate-median` v1, `compute-median` v1), 5 `rejected`; 0 approved, 0 active; 40 experience/pointer metadata rows |

## 5. Preservation

Existing worktrees (`bun-router`, `-ci2`, `-deps`, `-s1r`, `-s1r2`, `-s1r3`, `-s1r4`, `-s2`, `-t14`, `bun-sec-main`)
and the main checkout's uncommitted changes were left untouched; S2R1 works only in `../bun-router-s2r1`. The S2
evaluation database is opened read-only; S2R1 uses its own evaluation database
(`%LOCALAPPDATA%\Bunny-A\ma4-s2r1-eval\eval.sqlite`). Build artefacts that the regression rebuilds
(`native/voice/bunny-voice-worker.exe`, `.json`, `routeTree.gen.ts`) are restored, never committed.
