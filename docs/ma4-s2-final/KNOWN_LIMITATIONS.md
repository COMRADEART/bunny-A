# BUNNY A — MA4-S2 KNOWN LIMITATIONS & OPEN BLOCKERS (`KNOWN_LIMITATIONS.md`)

1. **24-Hour Real-Clock Candidate Soak (`Soak B`, `BLK-S2-01` — `IN PROGRESS`):**
   - `Soak B` (commit `448ca6b`, port `43192`, `%LOCALAPPDATA%\Bunny-S2T3R1-Soak`) is actively running at `4.28 h / 24.0 h` and passing all active criteria (`S5_memory = 28.2 MB/day <= 50 MB/day`, `84.4 -> 84.2 MB` private working set, `258 -> 258` handles, `0` duplicates, `0` errors), but requires `~19.7` additional wall-clock hours (`~2026-10-25 15:06 UTC`) before a full 24-hour `PASS` can be claimed.
2. **Real Local Model Functional Completion on Held-Out Tasks (`BLK-S2-02` — `PARTIAL`):**
   - While `plannerFormat(pin)` raised `qwen2.5-coder:7b` (`sha256:dae161e27b0e`) schema-valid plans from `0/5` (`0%`) to **`5/5` (`100%`)** and adversarial prompt-injection refusals (`X1`–`X8`) passed **`8/8` (`100%`)**, held-out functional plans (`H1`–`H5`) reached `2/5` (`40%`) and end-to-end completion reached `1/5` (`20%`). Additionally, `deepseek-r1:7b` (`sha256:755ced02ce7b`) times out at `90 s` when Ollama combines `<think>` token generation with grammar-constrained JSON output.
3. **Physical Android TalkBack Touch Exploration (`BLK-S2-03` — `NOT TESTED` / `BLOCKED`):**
   - Physical Samsung `SM-S948U` was not attached via USB/ADB during T3R1–T8 (`adb devices` empty), so live TalkBack swipe/double-tap verification remains pending hardware connection.
4. **External Production Code Signing (`BLK-S2-04` — `BLOCKED`):**
   - Windows Authenticode (`BUNNY_WINDOWS_AUTHENTICODE_THUMBPRINT`) and Google Play production upload keystore (`BUNNY_ANDROID_RELEASE_KEYSTORE`) credentials are not provisioned in this environment.
5. **Live External OAuth Provider Qualification (`BLK-S2-05` — `BLOCKED`):**
   - `email`, `calendar`, and `docs` connectors are verified against `SyntheticWorkspace` and `ma4-s2t6.test.ts`, and remain disabled by default in production (`services: null`) until dedicated non-production Google Workspace / Microsoft 365 OAuth test accounts and client credentials are provisioned.
6. **Local Desktop UIA Window Enumeration Contention (`cross-app-live.test.ts` `T6 X53`):**
   - Under heavy desktop window load, `UIAutomationClient` `RootElement.FindAll(TreeScope.Children, ...)` can exceed its `9 s` timeout when verifying Calculator launch (`Calculator launch outcome uncertain; no automatic relaunch`), failing closed without automatic relaunch as designed.
