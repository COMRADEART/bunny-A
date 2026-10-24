# MA4-S3-T0R baseline and errata

Parent: `dca8d06` (`origin/ma4-s3-t0-unified-foundation`).  
Worktree used: the S3 integration tree, including the commits after `5e6c7e9`.  
The dirty `bun-router` checkout on `ma4-s1-model-intelligence` and the soak worktrees were not modified.

## What the integrated tree actually contained

| Advertised capability | Policy | Production caller before this change | Host | UI | OS | Persistence | Authorization | Tests | Verdict now |
|---|---|---|---|---|---|---|---|---|---|
| Native notifications | `evaluateNativeNotification` | `use-island.ts` browser `Notification`, session `Set`, revision hardcoded to 1 | Events exist | Session banner | None | Dedup died with the page | Browser permission OR-ed with prefs | `ma4-s2t5.test.ts` | Superseded. See WINDOWS and ANDROID docs. |
| 10-stage onboarding | `resolveGuidedOnboardingState` | None. UI used 7-step `ONBOARDING_STEPS` in `localStorage` | None | 7-step | n/a | Browser only | Skip did not grant rights | Policy test plus 7-step UI test | Superseded. UI now uses the 10 stages. |
| Beta feedback | `LocalBetaFeedbackStore` | HTTP actions and a diagnostics file (S3 commit `f557738`) | Yes | No screen | n/a | File when `filePath` is set | Workstation only | `ma4-s2t7.test.ts` | Extended with delete. UI added. Not upload. |
| Device diagnostics | `projectDeviceDiagnostics` | Tests only | Revoked rows were omitted from the snapshot | Name, paired, last seen, expiry, revoke | n/a | Device table | Revoke already cuts off auth | `ma4-s2t5.test.ts` T5-E | Snapshot now keeps revoked rows. UI shows authority vs observed. |
| Runtime deadline ownership | `setTimeout` plus `.unref()` in `manager.server.ts` | The timer fired `stopInBackground` | Timer was not owned by `dispose` | n/a | n/a | n/a | n/a | Suites needed `--test-force-exit` in `npm test` | Timers are registered and cleared. `.unref` stays supplemental. |

`docs/ma4-s3-t0/*` stays as the historical S3 record. This folder supersedes its PASS-shaped readings where the table above says so. Those files were not rewritten.
