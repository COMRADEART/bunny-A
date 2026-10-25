# Security and regression

No security policy was relaxed so the conversation would feel continuous. Speech still cannot approve, grant a permission, or stop an agent by itself. The timeout line was tightened so it does not claim the model has stopped.

## Checks on this tree

| Check | Result |
| --- | --- |
| `tsc --noEmit` | Exit 0 on the final tree |
| `npm run test:ui` | 421 pass, 0 fail |
| `npm run build` | Exit 0. Production bundle. Not an installed package |
| Native voice worker tests | 24 pass, 1 skip (`whisper` runtime not staged) |
| CI-shaped scripts stage | 387 pass, 1 fail. `bunny-release.test.mjs` stopped because this worktree has no Node `LICENSE` beside `node.exe` and no `releases/installed/JEV-Windows-v1/runtime/LICENSE`. The system Node install was not modified |
| CI-shaped library stage | 1670 pass, 0 fail, 1 skip |
| CI-shaped agent stage | 58 pass, 0 fail |
| `npm run test:ma4` | 271 pass, 0 fail, 1 skip |
| Plain `npm test` | Stopped in the scripts stage: the license failure above, plus 7 failures in `scripts/voice-worker.test.mjs` because `native/voice/vendor` is not staged. Those 7 are the local whisper gate CI excludes from its scripts stage |

The license and whisper misses are missing local artifacts, not a change to voice authorization. They are still failures of a clean `npm test` on this worktree. Hosted CI is the check that has the staged runtime.

Installed Windows journey, Narrator, and a signed package were not run. Public beta remains NO-GO.
