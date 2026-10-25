# Final gate matrix

Candidate SHA for the installed product: `97d188e86ba733dcb94525ac08a5a2639012d857`.
Zip SHA-256: `d53679f5d4458db6c6cb52071ea7b1aa8d0ddca8bba07ff1c4835e6a4f284961` (183109673 bytes).
Manifest SHA-256: `42ebbfd08abb6c817e32a008fd5977cdd24c9ffb5a38bb22356f8f6fef8bdbe3`.
Merge CI: https://github.com/COMRADEART/bunny-A/actions/runs/40142924080 conclusion **failure**.
Closure-head hosted CI: **BLOCKED** until this branch is pushed and a run exists.

| Gate | Result | Evidence |
| --- | --- | --- |
| PR #36 merged at `97d188e` | PASS | PR 36 MERGED, merge oid matches |
| Merge-commit hosted CI, typecheck / MA4 / UI / builds | PASS | job success on run 40142924080 |
| Merge-commit hosted CI, static security | PASS | job success on the same run |
| Merge-commit hosted CI, full regression | FAIL | `T4-ANDROID-1` expected true, actual false |
| Closure-head hosted CI | BLOCKED | branch not on the host yet |
| Local natural-exit chain | PASS | stages 0–3 exit 0; 387, 1656, 58, 260 pass; 1 opt-in skip |
| `scripts/voice-worker.test.mjs` | NOT TESTED | omitted from the CI-shaped stage 0 list |
| Eight agent suites without `--test-force-exit` | PASS | stage 2 58/58 plus `agent-store` inside stage 1; dedicated log 67/67 |
| `--test-force-exit` removed from `npm test` | PASS | `package.json` diff; removal is after the natural chain, and that chain is the proof |
| Shutdown leaves the row running and does not write user Stop | PASS | resource probe: `stopReason` null, task `running`, timers 0 |
| Live runtime deadline still armed while open | PASS | `armRuntimeLimit` unchanged; shutdown returns before the stop |
| Mobile `npm run build` | PASS | exit 0 on the closure tree |
| Desktop `JEV_DESKTOP_BUILD=1 npm run build` | PASS | exit 0 on the closure tree |
| Installed Windows package identity | PASS | archive commit `97d188e`, hashes above |
| Ten-stage onboarding persisted | PASS | `guided_onboarding_v1` done at `first-safe-workflow`, survived Host replacement |
| Ollama readiness and local model selection | PASS | Ollama ready; cloud tag ineligible; local 7b ran |
| Onboarding model applied as the task pin | PARTIAL | stored `qwen2.5-coder:7b`; router ran `huihui_ai/qwen2.5-abliterate:7b` |
| Background execution opt-in | PASS | stored true |
| First approved task completion | PASS | `95b798e2-3fdf-42ff-a326-815665e491a7` completed |
| Independent verification of that task | PARTIAL | UI: verification was not established |
| Goal created | PASS | Active, 0 of 1 criteria |
| Monitor created | PASS | `mon-8d042f4e-9d16-42ee-ab17-1c35acc2f5f3` ACTIVE |
| Approval Center | PASS | badge 1 while waiting; empty after completion |
| Feedback preview, save, restart, export, delete | PASS | hashes in `GOLDEN_JOURNEYS.md` |
| Diagnostics health panel | PARTIAL | UI: `Host health is unavailable.` |
| Device list / revoked status | NOT TESTED | no paired device |
| Windows in-app monitor notice, no duplicate | PASS | one FAIL notice, later checks unchanged |
| Windows foreground OS toast | NOT TESTED | permission granted; no toast observed |
| Windows background toast | FAIL as a capability | product copy: no background Windows toast in this build. Left unsupported. |
| Android static allowlist on the closure tree | PASS | local stage 0 includes the updated `T4-ANDROID-1` |
| Android allowlist on merge CI / installed archive | FAIL | old internet-only assertion |
| Android hardware | NOT TESTED | no ADB, no phone, no emulator used as evidence |
| Journey A | PARTIAL | completion yes, independent verification not established |
| Journey B in-app | PASS | one notice |
| Journey C | NOT TESTED | no Android client |
| Journey D | PASS | redaction, persistence, export, delete |
| Journey E | PASS | SIGTERM while running; restart-walk failure; `stopReason` null |
| Default-deny / local-only | PASS | cloud candidates rejected |
| Hard pin of the served model | PASS | served name matched the approved local model |
| Onboarding preference as a hard pin | PARTIAL | preference stored, router did not use it |
| No unauthorized cloud inference on these tasks | PASS | 1 local, 0 other |
| No-blind-replay copy on the failed task | PASS | gaps not inferred; session not resumed |
| Secret redaction in feedback | PASS | redacted before storage; no upload flag |
| Revocation | NOT TESTED | no paired device |
| Production signing | BLOCKED | `UNSIGNED` or `TEST_SIGNED`; release gate BLOCKED |
| First-install rollback to a prior release | PARTIAL | refused: no pinned prior install configuration |
| Isolated uninstall | PASS | only the S3T0R1 roots and watch folder; real Startup shortcut unchanged |
| New models, new agents, or Lotus Memory | not in this milestone | none added |

Public beta remains **NO-GO**. The installed candidate is unsigned, background Windows toasts are unsupported, Android hardware was not tested, merge CI fails `T4-ANDROID-1`, and independent verification was not established for the first chat task.
