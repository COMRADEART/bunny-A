# MA4-S2-T6 — Live Provider Qualification & Blocker Adjudication (`LIVE_PROVIDER_QUALIFICATION.md`)

- **Gate T6-F Verdict:** **`PARTIAL`** (`PASS` on synthetic emulator contract + adversarial security suite; **`BLOCKED`** on live external OAuth provider qualification)

---

## 1. Separation of Synthetic Emulator vs. Live Provider Qualification

Per Master Prompt §T6-F (*"Never claim that a mock provider, browser fixture, fake model or simulated clock is equivalent to a qualified real-world workflow. If live test accounts or credentials are not available in the environment, keep live external providers disabled, complete contract and security tests, and report live provider qualification as BLOCKED"*):

| Connector Surface | Synthetic / Local Qualification | Live External Provider Status | Production Default | Reason |
|---|---|---|---|---|
| **Local Approved Folders (`files.*`)** | **`PASS`** (`ma4-s2t2-*.test.ts` + installed Journey B on `Bunny-A-Windows-S2T3R1-6-TEST`) | **`QUALIFIED_LOCAL`** | **Enabled** (explicitly registered folders only) | Executes against real Windows NTFS folders with Host ACL & symlink checks |
| **Controlled Browser (`browser.*`)** | **`PASS`** (`ma4-s2t2-*.test.ts` + isolated Chromium containment) | **`QUALIFIED_LOCAL`** | **Enabled** (granted HTTPS origins only) | Executes against real local headless Chromium with Windows Job Object containment |
| **Email (`email.*`)** | **`PASS` (`SyntheticWorkspace` + `ma4-s2t6.test.ts`)** | **`BLOCKED`** | **Disabled (`services: null`)** | No authorized non-production Gmail / Microsoft 365 OAuth client credentials or test accounts provisioned in this environment |
| **Calendar (`calendar.*`)** | **`PASS` (`SyntheticWorkspace` + `ma4-s2t6.test.ts`)** | **`BLOCKED`** | **Disabled (`services: null`)** | No authorized non-production Google Calendar / Microsoft 365 OAuth client credentials or test accounts provisioned in this environment |
| **Cloud Documents (`docs.*`)** | **`PASS` (`SyntheticWorkspace` + `ma4-s2t6.test.ts`)** | **`BLOCKED`** | **Disabled (`services: null`)** | No authorized non-production Google Drive / OneDrive OAuth client credentials or test accounts provisioned in this environment |
