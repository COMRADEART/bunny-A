# MA4-S3-T3R1 — Windows Installed User Journey Qualification

## 1. Scope & Packaging Verification

Phase 6 exercised the full 18-step end-to-end user journey against a standalone packaged build of Bunny A running on Windows 11 Pro (`10.0.26300`):
- **Candidate Release Name:** `Bunny-A-T3R1-TEST` (version `0.0.1-t3r1`)
- **Package Location:** `%LOCALAPPDATA%\Bunny-T3R1-Package\Bunny-A-T3R1-TEST`
- **Node Runtime:** v24.18.0 (92,534,088 bytes; SHA256 `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de`)
- **Node License:** Official license packaged alongside binary (160,552 bytes; verified by `package-bunny-desktop.ps1`).
- **Isolation Protection:** The production installation at `%LOCALAPPDATA%\Bunny-A` and Startup shortcut at `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Bunny-A.lnk` were monitored before and after testing; timestamps were identical.

---

## 2. 18-Step User Journey Verification Log

Evidence captured in `docs/ma4-s3-t3r1/evidence/installed-journey.json`:

| Step # | Journey Step Description | Action / Payload | Result / Evidence | Status |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Start Isolated Application** | `Start-Bunny-Release.ps1 -InstallConfig ... -NoIsland -NoGateway -NoRemote` | Host ready on port 43765; PID 29016; `app: "Bunny-A"`. | PASS |
| **2** | **Select Authorized Local Model** | `settings.set` -> `selectedModel: "qwen2.5-coder:7b"`, priority `local_only` | 200 OK; confirmed `qwen2.5-coder:7b` selected. | PASS |
| **3** | **Register Temporary Project Folder** | `connector.roots.set` -> `alpha-proj` at temp path | 200 OK; root registered with write/read grants. | PASS |
| **4** | **Submit C1 File-Reading Request** | Read `TASKS.md` via `local.generate` with `qwen2.5-coder:7b` | Model completed inference in 1,882 ms. | PASS |
| **5** | **Confirm File Contents Support Answer** | Verify summary mentions all 3 tasks in `TASKS.md` | Grounded summary verified; file receipt verified. | PASS |
| **6** | **Submit C2 Multi-Step Request** | Multi-agent task on buggy `calculator.js` | Proposal generated; task enters `AWAITING_APPROVAL`. | PASS |
| **7** | **Review Task Proposal** | Inspect proposed Planner, Worker, Tester steps | Schema validated; no unauthorized capabilities requested. | PASS |
| **8** | **Select "Run with Agents"** | `ptask.approve` on C2 task | Task admitted; transitions to `RUNNING`. | PASS |
| **9** | **Observe Role Handoffs** | Planner -> Worker -> Tester step handoffs | State transitions observed: `RUNNING (Working)` -> `TESTING`. | PASS |
| **10** | **Observe Notch Status Changes** | Real-time SSE `/events` stream monitoring | Valid state sequence; zero synthetic percentages. | PASS |
| **11** | **Observe Honest Failing Test** | `local.test` on defective `calculator.test.js` | Process exited with code 1; task state: `FAILED`. | PASS |
| **12** | **Submit C3 File-Modification Request** | Propose fix for `calculator.js` | Worker creates patch; presents approval request. | PASS |
| **13** | **Observe Modification Approval Gate** | Check pending action details | `file.apply` presented with exact payload hash (`29a63...`). | PASS |
| **14** | **Approve Exact Modification** | `action.approve` on pending action ID | 200 OK; payload hash matched. | PASS |
| **15** | **Verify File Modification on Disk** | Inspect `calculator.js` on filesystem | File contents match exact patch bytes. | PASS |
| **16** | **Observe Follow-up Test Pass** | Tester runs `calculator.test.js` against fixed file | Exit code 0; verified receipt `receipt:test-exec:...` issued. | PASS |
| **17** | **Submit Bounded Task & Issue Stop** | Create long task; call `ptask.cancel` | Task admitted; observed `RUNNING`; stop issued. | PASS |
| **18** | **Confirm Prompt Cessation** | Measure time to settle; check output | Task settled to `CANCELLED` in 171 ms; output did not grow. | PASS |

---

## 3. Teardown & Invariant Verification

1. **Host Termination:** Isolated host killed gracefully via PID 29016.
2. **FileSystem Cleanup:** Temporary test workspace and test package directories removed completely.
3. **Production State Integrity:**
   - Production install mtime before: `1792774983692.9773` — after: `1792774983692.9773` (Match: TRUE).
   - Startup shortcut mtime before: `1792291977364.1206` — after: `1792291977364.1206` (Match: TRUE).
