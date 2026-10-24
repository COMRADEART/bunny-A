# MA4-S2-T8 — Beta Go / No-Go Decision (`BETA_GO_NO_GO.md`)

- **Gate T8-E Verdict:** **`PASS` (Explicit Go / No-Go Decision Published)**
- **General Public Beta Release Recommendation:** **`NO-GO` for Public / Uncontrolled Beta**
- **Controlled Local Workstation Preview Recommendation:** **`CONDITIONAL GO` (Local Workstation Only, External OAuth Providers Disabled, After `Soak B` Reaches `24.0 h` at `2026-10-25 15:06 UTC`)**

---

## 1. Active Blockers Preventing General Public Beta (`NO-GO`)

| Blocker ID | Milestone | Gate / Surface | Current Status | Required Closure Criteria |
|---|---|---|---|---|
| **BLK-S2-01** | `T3R1` / `T7` | 24-Hour Real-Clock Candidate Soak (`Soak B`, commit `448ca6b`, port `43192`) | **`IN PROGRESS` (`4.28 h / 24.0 h`, `28.2 MB/day` `PASS`)** | Allow `Soak B` (PID `6840` / Host PID `19296`) to complete its remaining `~19.7` real hours (`~2026-10-25 15:06 UTC`) and confirm `status: "PASS"` across all 12 criteria `S1`–`S12`. |
| **BLK-S2-02** | `T3R1` | Real Local Model Functional Completion (`R1-G6`) | **`PARTIAL` (`5/5` schema-valid, `8/8` security `PASS`, `2/5` functional / `1/5` completed on `H1`–`H5`)** | Raise `qwen2.5-coder:7b` functional completion on `H1`–`H5` to `>= 4/5` (`>= 80%`) and strip/disable `<think>` grammar conflicts for `deepseek-r1:7b`. |
| **BLK-S2-03** | `T3R1` / `T5` | Live Screen-Reader Hardware Verification (`R1-G4` & `R1-G5`) | **`PARTIAL` / `NOT TESTED`** (`BLK-T3R1-04` fixed in code on `T5`; Samsung `SM-S948U` disconnected) | Re-verify the `T5` per-item `aria-label` and `aria-live="polite"` fixes in a 5-minute Windows Narrator check, and attach the physical Samsung `SM-S948U` via USB/ADB to run live Android TalkBack touch exploration. |
| **BLK-S2-04** | `T4` / `T8` | Production Code Signing (`Authenticode` & `Google Play`) | **`BLOCKED` (`UNSIGNED` Windows / `TEST_SIGNED` Android)** | Provision a trusted Windows Authenticode OV/EV certificate (`BUNNY_WINDOWS_AUTHENTICODE_THUMBPRINT`) and a production Google Play upload keystore (`BUNNY_ANDROID_RELEASE_KEYSTORE`). |
| **BLK-S2-05** | `T6` | Live External OAuth Provider Qualification (`email`, `calendar`, `docs`) | **`BLOCKED` (Disabled in production)** | Provision dedicated non-production Google Workspace / Microsoft 365 OAuth client credentials and test accounts, run live end-to-end provider qualification, or keep external OAuth connectors disabled for initial beta. |
