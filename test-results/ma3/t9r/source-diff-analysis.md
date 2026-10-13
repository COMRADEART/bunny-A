# Focused source comparison and repair scope

## Native path (X53)

The T8 executable (`987afea`) and the accepted T9 executable (`0a5988c`) are byte-identical for `computer.server.ts`, `calculator-targets.server.ts`, the original `cross-app-live.test.ts` and `cross-app-host-worker.mjs`. The X53 failure is therefore a pre-existing native readiness defect exposed by workstation state, not a T9 source regression (see `root-cause-analysis.md`). No T9 security change was reverted to repair it.

## Final executable delta, `0a5988c` → `395d1c0`

`git diff --stat 0a5988c 395d1c0 -- src package.json scripts`: 9 files, +768 / −24.

| Commit | Layer | Change |
|---|---|---|
| e895fdf | `computer.server.ts` | Signed native frame identity (HWND/owner PID/frame lifetime/session/executable/class, native AppUserModelID vs installed signed Appx manifest) before readiness. Bounded fresh-UIA readiness: 100 ms polls, ≤ 8 s per phase, also bounded by consent expiry and the operation timeout. Only an admitted open operation may restore a minimized window; preparation probes never restore, launch or invoke. |
| e895fdf | `commands.server.ts` | A paired device's `mission.respond` rejects Agent/Mission/Project binding fields and other unsupported keys; the binding comes only from the canonical request id. |
| 341aeaa | `computer.server.ts` | The first acquisition's restoration evidence is no longer overwritten by a later `restored:false` validation. |
| ea48c40 | `computer.server.ts` | Exact semantic UIA focus on the freshly verified target, with a 2 s condition deadline; native HWND foreground equality stays mandatory before any arithmetic invocation. No input synthesis, foreign input-queue attachment or foreground-lock change. |
| b345aa3 | remote layer | First review fix set. F-01 and T-01 were reverted in 0904132 because they broke accepted MA0R tests; see `t9r-adversarial-matrix.json`. |
| 0904132 | `bunny-host/manager.server.ts` | **DEV-01 reroute guard.** Direct tasks approved by a device are recorded; launch-time and recovery reroutes of those tasks admit only exact local tool-free models. Reproduced on b345aa3 (`review/t9r-01-prefix-probe.log`). |
| 0904132 | `bunny-missions/manager.server.ts` | **F-03 (narrowed).** Once a Mission has been replanned, a device approval must name the reviewed `planReference`. `allow_batch` without an offer is a refusal (`REFUSED`), not an uncertain `FAILED`. |
| 0904132 | `http.server.ts` | **F-02.** Workstation revocation of a device revokes the envelopes of active *and failed* plain Missions that device approved, and stops the active ones, so a later Retry cannot revive them. Self sign-out keeps the user's approvals, unchanged by design. |
| 395d1c0 | `device-authority.server.ts`, callers | `deviceMayLaunch` also refuses tags the Ollama probe reported as remote (`remoteModels`) and empty models. The direct-approve gate, Mission `provider.execute` verdict and reroute filter pass the probe data. A refused duplicate approve keeps the device marker. The revocation sweep re-reads Mission state before stopping. |
| e895fdf, b345aa3–395d1c0 | tests | `calculator-readiness.test.ts` (13 tests) and `remote-remediation.test.ts` (14 tests) are new; `package.json` registers the latter. |

## What was not changed

No existing test file or assertion changed. `git diff --name-only 0a5988c 395d1c0 -- '*.test.ts' '*.test.mjs'` lists only the two new T9R files.

Canonical authorization, process ownership, Calculator target serialization, the launch uncertainty guard, grants, device principal identity, SSE sequencing/redaction and restart invalidation remain in their existing layers. The paired-device role, the MA0R remote-approval contract and the T9 command envelope are intact.
