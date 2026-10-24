# MA4-S2 Final Fix — Baseline Failure Matrix

**Date:** 2026-10-24  
**Repository:** `https://github.com/COMRADEART/bunny-A`  
**Remediation Worktree:** `C:\Users\allam\Documents\new\bun-router-s2-remediation`  
**Remediation Branch:** `ma4-s2-final-gate-remediation` (created from `ma4-s2-t8-release-candidate` @ `ea84f803dcf6987555a5438dc28d54794c3038be`)

---

## 1. Stacked Pull Request & CI Forensics Baseline

| PR | Branch | Head SHA | Base Branch | Hosted CI: Static Security | Hosted CI: Typecheck / MA4 / UI / Builds | Hosted CI: Full MA3/MA4 Regression (`npm test`) | Confirmed Failure / Status |
|---|---|---|---|---|---|---|---|
| **#29** | `ma4-s2-t3r1-beta-closure` | `aa255cd83232d886ae273d546be0b0d0f6b77a26` | `ma4-s2-autonomous-agent-platform` | PASS | PASS | PASS | All 3 jobs PASS (runs `40123523482`, `40123526684`) |
| **#30** | `ma4-s2-t4-release-packaging` | `c8a55a10fc1e4fc634f1e20ccb8992e6de02afac` | `ma4-s2-t3r1-beta-closure` | PASS | PASS | **FAIL** (run `40123966574`, job `120960868899`) | 1. `src/lib/bunny-host/execution-scope.test.ts:225` (`MA0R2: read replan revokes old approval and new approval spawns the same Codex isolation` — `0 !== 1`)<br>2. `src/lib/bunny-host/failure.test.ts:932` (`T3: real source entry contains process rejection and exception without a test global handler` — `EPERM: permission denied, rmSync`) |
| **#31** | `ma4-s2-t5-native-experience` | `fa07f5d56b00aa5165d9758bd6d27d254324942c` | `ma4-s2-t4-release-packaging` | PASS | PASS | PASS | All 3 jobs PASS (runs `40124372318`, `40124375890`) |
| **#32** | `ma4-s2-t6-provider-integrations` | `823487df490daf14f4f96bb659908e1e1b5548d6` | `ma4-s2-t5-native-experience` | PASS | **FAIL** (runs `40124825718`, `40124829914`) | PASS | `src/lib/bunny-host/ma4-s2t6.test.ts` lines 103, 113, 117, 127: `TS2554: Expected 3 arguments, got 2` (`mailSend.run` and `docsWrite.run` missing `prepared: Prepared \| null`) |
| **#33** | `ma4-s2-t7-operations-reliability` | `e3e88ea754a6c6895f05b96306c042d74918332b` | `ma4-s2-t6-provider-integrations` | PASS | **FAIL** (runs `40125146936`, `40125150841`) | PASS | Inherited from PR #32: `src/lib/bunny-host/ma4-s2t6.test.ts` lines 103, 113, 117, 127 (`TS2554: Expected 3 arguments, got 2`) |
| **#34** | `ma4-s2-t8-release-candidate` | `ea84f803dcf6987555a5438dc28d54794c3038be` | `ma4-s2-t7-operations-reliability` | PASS | PASS (synthetic `{}` cast used in `7c81bd0`) | PASS | `7c81bd0` passed `const sig = {} as never` as 3rd argument in `ma4-s2t6.test.ts` instead of real `Prepared` context from `connector.prepare()`, violating §4 contract requirements |

---

## 2. Shared Commit Ancestry Across Stacked Branches

- `aa255cd83232d886ae273d546be0b0d0f6b77a26` (`ma4-s2-t3r1-beta-closure`, PR #29): Base for all subsequent S2 branches.
- `c8a55a10fc1e4fc634f1e20ccb8992e6de02afac` (`ma4-s2-t4-release-packaging`, PR #30): Adds T4 packaging, SBOM, rollback, and store readiness (`aa255cd..c8a55a1`).
- `fa07f5d56b00aa5165d9758bd6d27d254324942c` (`ma4-s2-t5-native-experience`, PR #31): Adds T5 Windows glass-notch UX, accessibility, and Android supervision (`c8a55a1..fa07f5d`).
- `823487df490daf14f4f96bb659908e1e1b5548d6` (`ma4-s2-t6-provider-integrations`, PR #32): Adds T6 connected services, `services.server.ts`, and `ma4-s2t6.test.ts` (`fa07f5d..823487d`).
- `e3e88ea754a6c6895f05b96306c042d74918332b` (`ma4-s2-t7-operations-reliability`, PR #33): Adds T7 operations, reliability, observability, privacy, and `ma4-s2t7.test.ts` (`823487d..e3e88ea`).
- `ea84f803dcf6987555a5438dc28d54794c3038be` (`ma4-s2-t8-release-candidate`, PR #34): Adds T8 release candidate docs and `7c81bd0` (`e3e88ea..ea84f80`).

---

## 3. Reproducible Failure & Blocker Matrix

| ID | Category | Surface / File | Failure / Defect | Root Cause | Status at Baseline |
|---|---|---|---|---|---|
| **FIX-A1** | Hosted CI Regression (PR #30) | `src/lib/bunny-host/execution-scope.test.ts:225`<br>`src/lib/bunny-host/owned-process-group.server.ts:138`<br>`src/lib/bunny-host/adapters.server.ts:532` | `MA0R2: read replan revokes old approval and new approval spawns the same Codex isolation` failed with `0 !== 1` (`env.launches.length === 0`) after initial child task failed | 1. In `outputPipe()` (`owned-process-group.server.ts:138-150`), when a fast child (`argv.mjs`) writes to the Windows named pipe and exits with code 1, `containedSession` polls `group.inspect()` in the libuv timers phase (before the libuv I/O poll phase processes the named pipe `connection`/`data` IOCP packets) and immediately calls `closePipes()` -> `server.close()`. When `sockets.size === 0` (connection not yet accepted by libuv), `server.close()` closes the listening pipe server immediately, dropping the child's stdout line (`env.launches.length === 0`) while the process exit code `1` still fails the task/mission.<br>2. `CodexAdapter.launch` (`adapters.server.ts:532`) omitted `containment` on Mission sessions, causing `TaskManager.watchSurvivors` to spawn `powershell.exe Get-CimInstance Win32_Process` (15s timeout) on every completed/failed Codex Mission task.<br>3. `MissionManager.launchModel` called `markRunning` after `approveDelegated`, and `missionScopeCheck` did not bind-check `task.approval.authorizationId === envelope.id`. | **OPEN (Code Defect)** |
| **FIX-A2** | Hosted CI Regression (PR #30) | `src/lib/bunny-host/failure.test.ts:932` | `T3: real source entry contains process rejection and exception without a test global handler` threw `EPERM: permission denied, rmSync` | `runHostEntry` in `failure.test.ts:901` ran full provider discovery (`manager.discover()` spawning CLI probes) and telemetry (`sampleHost()` spawning `powershell.exe` / `nvidia-smi`), and `failure.test.ts:932` called `rmSync(directory, { recursive: true, force: true })` immediately on child `exit` without bounded retry/verification while Windows kernel/child handles on `host.sqlite` / `host-failures.jsonl` were releasing. | **OPEN (Code Defect)** |
| **FIX-B** | Hosted CI Typecheck (PR #32, #33, #34) | `src/lib/bunny-host/ma4-s2t6.test.ts:103,113,117,127`<br>`package.json` | `TS2554: Expected 3 arguments, got 2` on `mailSend.run` and `docsWrite.run` in PR #32/#33; synthetic `{}` cast used in PR #34 (`7c81bd0`); `ma4-s2t5/t6/t7.test.ts` omitted from `npm run test:ma4` | `Connector<I>.run(input, ctx, prepared)` requires the `Prepared` payload returned by `connector.prepare!(input, ctx)` for consequential connectors. PR #32/#33 omitted the 3rd argument; PR #34 passed `{} as never` instead of calling `prepare()` and testing the full `brokered()` authorization contract. | **OPEN (Code Defect)** |
| **FIX-C** | Local Regression UIA Timeout | `src/lib/bunny-missions/cross-app-live.test.ts:35`<br>`src/lib/bunny-missions/capabilities/computer.server.ts` | `T6 X53` failed in full local regression (`test-results/ma3/t6/integrated-attempt.json`) on step 8 (`Enter` / `computer.invoke_control`) with `Desktop automation timed out after 9403 ms` | `Find-Window`, `Calculator-Frames`, and `Assert-BatchWindow` in `computer.server.ts` called `AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition)` (which makes cross-process UIA COM calls to every top-level window on the desktop and stalls when any background window is busy during full regression) and iterated `FindAll(TreeScope.Descendants, TrueCondition)` in PowerShell with multiple COM round-trips per element on every Calculator action and verification. | **OPEN (Code Defect)** |
| **FIX-D** | Real Local-Model Intelligence | `src/lib/bunny-host/ma4/agent-loop.ts`<br>`scripts/ma4-s2t3r1/model-qualify.mjs` | `qwen2.5-coder:7b` achieved `2/5` functional plans (`1/5` E2E completions) on H1–H5; `deepseek-r1:7b` timed out at 90s under grammar-constrained JSON (`format: PLAN_SCHEMA`) | 1. `planPrompt` in `agent-loop.ts` gave only action names (`read_file, write_file, ...`) without parameter schemas, workspace file context, or explicit rules against unnecessary `write_file`/`shell_exec` steps, causing `qwen2.5-coder:7b` to emit invalid parameter keys (`file_path` vs `path`), add unrequested `write_file` steps on read-only tasks (triggering `WAITING_APPROVAL`), or reference nonexistent files.<br>2. `deepseek-r1:7b` in Ollama suppresses `<think>` tokens when `format` is a JSON schema, causing degenerate token generation / 90s timeout. | **OPEN (Code Defect)** |
| **FIX-E** | 24-Hour Soak & Cancellation Ordering | `scripts/ma4-s2t3r/soak.mjs`<br>`scripts/ma4-s2t3r/soak-report.mjs` | Soak A (`port 43190`) recorded 1 `CANCELLATION_ORDERING` race in `soak.mjs`; Soak B (`port 43192`, PID `6840` / Host PID `19296`) is actively running (`~0.83h / 24h` elapsed) | 1. In `soak.mjs`, `agent.task.cancel` raced a fast local task (`fs.stat`) that completed in `< 5ms` before the cancel HTTP request arrived, and `soak.mjs` misclassified pre-cancel `COMPLETED` as `CANCELLATION_ORDERING`.<br>2. Soak B (`Bunny-S2T3R1-Soak`) must remain untouched until `2026-10-25T15:06:15Z` and be reported truthfully as `IN PROGRESS`. | **IN PROGRESS (Runtime Soak Gate)** |
| **FIX-F** | Accessibility Evidence | `src/routes/index.tsx`<br>`docs/ma4-s2-t5/ACCESSIBILITY_REPORT.md` | Screen-reader verification needed for Windows Narrator and Android TalkBack | Windows Narrator must be exercised against the live Windows app with actual focus/announcement evidence; Android TalkBack is `NOT TESTED` while physical Samsung SM-S948U is disconnected over ADB. | **OPEN (Verification / Device Gate)** |
| **FIX-G** | Release Packaging & Signing | `scripts/ma4-s2t4/package-verify.mjs`<br>`docs/ma4-s2-t8/` | Unsigned build vs production signing readiness | Local Windows desktop build and Android APK/AAB build/checksums/SBOM/rollback must be verified; Authenticode and Android production keystore signing are `BLOCKED` on external release credentials. | **BLOCKED (External Signing Credentials)** |
| **FIX-H** | External Connected OAuth | `src/lib/bunny-host/ma4/connectors/services.server.ts` | Live external Google/Microsoft OAuth tenant testing | Local loopback OAuth + broker security contracts are verified; live external Google/Microsoft tenant qualification is `BLOCKED` on external OAuth client credentials. | **BLOCKED (External OAuth Credentials)** |

---

## 4. Active Soak Processes Preserved

| Instance | Driver PID | Host PID | Port | Data Directory | Started (UTC) | Status |
|---|---|---|---|---|---|---|
| **Soak A** | `32948` | `31616` | `43190` | `C:\Users\allam\AppData\Local\Bunny-S2T3R-Soak` | `2026-10-24T13:51:15Z` | Active (Preserved) |
| **Soak B** | `6840` | `19296` | `43192` | `C:\Users\allam\AppData\Local\Bunny-S2T3R1-Soak` | `2026-10-24T15:06:15Z` | Active (Preserved — primary 24h S2T3R1 soak) |
