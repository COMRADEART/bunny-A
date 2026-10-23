# M-A-3 T14 — Known limitations

None of these is a failed safety gate. Each is recorded with its evidence.

## Not tested live

| Id | Limitation | Why it is not a safety failure / evidence |
| --- | --- | --- |
| L-LIVE | **No real provider inference.** Every T14 model call is a scripted stand-in (SIMULATED). | The Host code paths are real. The live receipts from T11 and T13 remain the evidence for real inference. |
| L-VOICE | **No real microphone or speaker.** T14-H drives the real contained voice worker with typed input and null output. Whisper is not staged in the development worktree, so recognition falls back to SAPI there. | The clean regression links the staged whisper runtime, and the whisper suites pass there. |
| L-PHONE | **No physical phone device.** Phone restrictions are proven against a real pairing over HTTP (T14-J, packaged P06). | — |
| L-ENDURANCE | **No multi-hour run.** T14-L moves the start time back to exercise the runtime limit (accelerated clock). It is not an endurance test. | — |

## Owner configuration

| Id | Limitation | Detail |
| --- | --- | --- |
| L-CONCURRENCY | **Raising default caps is an owner setting.** | Defaults are 2 live steps per Agent, 4 shared, 4 active Missions. Four parents plus their workers, or three overlapping workers for one Agent, need the owner to raise `maxActiveMissions` or the per-Agent cap (T14-B, perf harness). Without that, the extra workers wait for the owner rather than failing. |

## Design boundaries

| Id | Limitation | Detail |
| --- | --- | --- |
| L-PKG-NPM | **`npm` steps in the packaged runtime ask for approval.** | The packaged Host resolves `npm` to a different executable identity at run time than at plan time, and fail-closed asks the owner. This is carried from T13.3. The log is `e2e/package-t14-e2e-npm-identity-attempt.log`, and the T14 packaged e2e uses git capability steps instead. |
| L-AGENTIC-WORKERS | **Some parents cannot hand down authority.** | A parent under T5 Agentic consent, or approved from a paired device, never derives authority: its workers wait for the owner. |
| L-DELEGATION | **Workers are proposed through the workstation command `worker.propose`.** | In-plan role decomposition is the T11 Team Mission. No fourth step-executor kind was added. |
| L-COOWNER | **No co-owned Mission.** | Two Agents collaborate through a shared Project with explicit `lotus.share` (T14-K). |
| R3-MEDIUM | **A worker step already running when its parent enters reconciliation runs to its end.** | Accepted by design: the parent's own in-flight steps follow the same rule. New worker admissions are held, as the "T14 review F6" test shows. |
| R3-LOW | **Not every lock release wakes a waiting step.** | A workspace lock released without a live-to-non-live step transition does not wake a waiter. This is the same pattern as `admissionHolds`. |

## UI carried from Widget Studio

| Id | Limitation |
| --- | --- |
| W-1 | The native Notch does not render widgets. |
| W-2 | "Personal Agents" is one widget with four rows. |
| W-3 | The phone is read-only for widgets. |
| W-7 | Each widget subscribes to the whole store, so it re-renders broadly. This is a performance limitation. |
| W-5 | Drag-resize is pointer-only. |
| T-1 | The theme restore can hide the shell for up to 1.5 s on slow hydration. A timeout always reveals it. |

## Baseline gaps

| Id | Limitation |
| --- | --- |
| L-BASELINE-PERF | There is no comparable "before" measurement for the new paths, because they did not exist. |
