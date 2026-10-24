# Critical Fix C — `cross-app-live.test.ts` T6 X53 Windows UIA timeout

**Status:** ROOT CAUSE IDENTIFIED (environmental, with a real product defect underneath) · product fix IMPLEMENTED · live X53 **NOT TESTED** from this session (cannot be: see §2).

## 1. Reproduction (this remediation session)

`node --experimental-strip-types --test src/lib/bunny-missions/cross-app-live.test.ts` (task-483, run 1):

| Step | Capability run | Result | Duration |
|---|---|---|---|
| 0–4 (fs, git, terminal, browser) | all `succeeded` | ✔ | 32–365 ms each |
| 5 Acquire | `computer.open_app` | **failed, `uncertain: true`** — *"Calculator launch outcome uncertain; no automatic relaunch."* | **9 327 ms** |

The ~9.3–9.4 s signature matches the originally reported 9 403 ms: the `acquire` script's 8 000 ms post-launch window-discovery deadline plus PowerShell/Add-Type startup. Evidence: `%TEMP%\bunny-test-evidence\ma3\t6\integrated-attempt.json`.

## 2. Measurements

| Probe (from the test's own process context) | Result |
|---|---|
| `AutomationElement.RootElement.FindAll(Children, True)` | **0 children in 58 ms** (not slow — empty) |
| Win32 `EnumWindows` visible + titled top-level windows | **0** |
| Session (`query user`) | console session 1, **Active**, not locked (`LogonUI` absent) |
| Window station / thread desktop | `WinSta0` / **`exebox-63A4YSH7DTYNP6QAP4IVGONHOM`** (a private sandbox desktop, not `Default`) |
| `CalculatorApp.exe` processes after the run | a new process started 16:27:55, exactly when `open_app` ran (1792873674632 ms) — launched via UWP activation onto the user's desktop, invisible to Bunny |

**Conclusion.** Enumeration is not slow, COM/UIA is not blocked, and there is no CPU/memory pressure or test concurrency involved. The agent's command shell — and every Host it forks — runs on a private desktop. UIA and `EnumWindows` only report windows on the caller's desktop, so the Calculator that UWP activation places on the interactive desktop can never be observed; the discovery loop runs to its 8 s deadline and reports an uncertain launch.

The earlier speculative change (Win32 pre-filtering of top-level windows, targeted UIA conditions) did not address this and was **reverted**; the enumeration code is byte-identical to T8.

## 3. Product defect underneath

Regardless of the harness, the Host must not launch an application it is structurally unable to observe: doing so produced an *uncertain* outcome, an `acquiring` guard requiring manual review, and an orphaned `CalculatorApp.exe` (cleaned up by PID + start-time match after this investigation).

## 4. Fix

`src/lib/bunny-missions/capabilities/computer.server.ts`

* `BunnyWin.OnInputDesktop()` — `OpenInputDesktop(DESKTOP_READOBJECTS)` and compare its name with `GetThreadDesktop(GetCurrentThreadId())`; any failure is `false` (fail closed). The input desktop handle is always closed.
* `CALCULATOR_SCRIPTS.existing` and `CALCULATOR_SCRIPTS.acquire` throw *"Interactive desktop unavailable … Nothing was launched."* **before** any enumeration or `Start-Process`. Because `existing` runs before `CalculatorTargets.acquire` persists the `acquiring` phase, the refusal is definite: no launch, no uncertainty guard, no orphan.
* No timeout was changed.

`src/lib/bunny-missions/cross-app-live.test.ts` — X53 now reports **NOT TESTED** (skip with reason) when the test process is not on the input desktop, alongside the existing "no verified Calculator" skip. It is never reported as passed in that condition.

`src/lib/bunny-missions/calculator-targets.test.ts` — `MA4-S2-FIX-C` asserts the desktop gate precedes enumeration and `Start-Process` in both scripts and that the refusal states nothing was launched.

## 5. Verification

| Check | Result |
|---|---|
| Real PRELUDE compiled in PowerShell, `[BunnyWin]::OnInputDesktop()` from this sandbox | `False` (correct) |
| `calculator-targets.test.ts` + `calculator-readiness.test.ts` | 32/32 pass |
| Adjacent `approval-batches.test.ts`, `cross-app.test.ts` (task-483, pre-revert, enumeration unchanged by revert) | 91/91 pass |
| `cross-app-live.test.ts` from this sandbox | **NOT TESTED** (skip, reason printed) |

## 6. Remaining gate

X53 must be executed by the owner from an interactive desktop session (`node --experimental-strip-types --test src/lib/bunny-missions/cross-app-live.test.ts` in a normal terminal). Until then X53 is an **open local gate**, not a pass.
