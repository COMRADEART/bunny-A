# Baseline and CI

## Integrated source

| Item | Value |
| --- | --- |
| Repository | https://github.com/COMRADEART/bunny-A |
| PR | [#39](https://github.com/COMRADEART/bunny-A/pull/39) merged |
| Merge commit | `22b55a400b47a5047b614ca0769a056bef6677dc` |
| PR head | `e9eb8fb6be636a2dd97e7fbe2175a539375e8024` |
| Tree difference | `git diff e9eb8fb 22b55a4` is empty. The merge adds no file changes. |
| Predecessor | `bc1c82df8f765e39b1bbb64191a08f3e09f00d95` (merge of PR #38) |

## Workflow `40154246502` (pull_request)

Final status: **success**.

| Job | Conclusion |
| --- | --- |
| static security checks | success |
| typecheck, MA4/routing/sandbox-contract tests, UI tests, builds | success |
| full MA3/MA4 regression (npm test) | success |

## Workflow `40154235384` (push to the merge)

Final status: **success**. This was still running when qualification started. It was recorded only after every job completed.

| Job | Conclusion |
| --- | --- |
| static security checks | success |
| typecheck, MA4/routing/sandbox-contract tests, UI tests, builds | success |
| full MA3/MA4 regression (npm test) | success |

Hosted CI excludes `scripts/voice-worker.test.mjs`. That file is a local gate. See `REGRESSION_RESULTS.md`.

## Active soak

Left running. Not stopped, and its directory was not used as a workspace.

- Driver PID 6840, started 2026-10-24 11:06 local, `scripts/ma4-s2t3r/soak.mjs --hours 24`. Still running at qualification close.
- Host was recorded as PID 37540. At close the process listening for that soak is PID 9076 on port 43192 (`soak-host.mjs` in the soak worktree). It was not stopped by this pass.
- Evidence directory: `C:\Users\allam\AppData\Local\Bunny-S2T3R1-Soak`
- Last sampled state before this work: `working: 0`, health `healthy`

## Held constant for the live sample

| Input | Value |
| --- | --- |
| Ollama | 0.40.9 |
| Model | `huihui_ai/qwen2.5-abliterate:7b` |
| Digest | `103482475c9b4d4032999dd5d7383478cad8b966ae6ae984d525daf7352c2219` |
| Quantization | Q4_K_M |
| Residency | cold call loads the model; later calls in the same script are warm; the script ends with `keep_alive: 0` |
