# Reproduced original failure, before repair

Exact unchanged test command:

`node --experimental-strip-types --test --test-concurrency=1 src/lib/bunny-missions/cross-app-live.test.ts`

The cold baseline passed (`baseline-x53.log`, exit 0). It created exactly one test-owned Microsoft Calculator window. A read-only before/after diagnostic and the canonical acquisition run established the ownership ledger; no pre-existing Calculator window was present. The test fixture minimized only that exact owned HWND after checking frame/content PID creation times, installed signed package and child attachment.

The unchanged complete test then failed, exit 1, with `Calculator arithmetic identity unavailable` (`baseline-minimized-x53.log`, `baseline-minimized-x53/integrated-attempt.json`). The minimized root remained present but its arithmetic UIA subtree disappeared. The expected AutomationIds were absent; no coordinate or synthetic success was used.

The test-only restore helper refused because the Calculator content process was detached from the minimized native frame (`restore-owned.log`). This refusal was preserved; it did not restore the window. `native-minimized-frame-property.json` independently established the frame's native AppUserModelID as the installed Calculator Appx identity. The admitted repaired acquisition subsequently restored it and completed original X53 (`first-repair-x53.log`).

Additional preserved attempts: two stability harness failures after successful native X53 runs, then one real `computer.focus_window` denial with foreground remaining another app. See `stability-attempt-1.log`, `stability-attempt-2.log`, `stability-attempt-3.log` and their copied per-run receipts. They are not counted as ten-run acceptance successes. The third failure is a real native focus failure, not an arithmetic identity failure.
