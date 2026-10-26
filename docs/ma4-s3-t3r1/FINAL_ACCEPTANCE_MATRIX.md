# MA4-S3-T3R1 — Final Acceptance Matrix (T3R1-G1 through T3R1-G20)

## 1. Compliance Matrix

| Gate | Requirement Description | Verification Evidence | Result |
| :--- | :--- | :--- | :---: |
| **T3R1-G1** | **Deterministic Test Execution**<br>No test step can pass without real OS process launch. | `test-runner.server.ts`, Adversarial Case 1 | **PASS** |
| **T3R1-G2** | **Exit Code Precedence**<br>Only observed exit code 0 can produce a verified receipt. | Adversarial Cases 2, 6 | **PASS** |
| **T3R1-G3** | **Executable Allowlisting**<br>Only `node`, `npm`, `npx` permitted; shell interpreters blocked. | Adversarial Cases 9, 10 | **PASS** |
| **T3R1-G4** | **Shell Injection Immunity**<br>Spawn via argument arrays without shell interpolation. | Adversarial Case 9 | **PASS** |
| **T3R1-G5** | **Working Directory Containment**<br>Working directory must resolve strictly inside registered project root. | `test-runner.server.ts` path check | **PASS** |
| **T3R1-G6** | **Timeout & Process Tree Cleanup**<br>Tests timeout cleanly; child trees terminated on Windows. | Adversarial Cases 4, 5 | **PASS** |
| **T3R1-G7** | **Bounded Output Buffering**<br>Standard output/error capped at 1 MiB; overflows fail closed. | Adversarial Case 7 | **PASS** |
| **T3R1-G8** | **Report Artifact Verification**<br>Required report files verified by SHA-256 digest before pass. | Adversarial Case 8 | **PASS** |
| **T3R1-G9** | **Receipt Integrity & Stale Replay Rejection**<br>Receipts bound to artifact hashes; stale digests rejected. | Adversarial Case 11 | **PASS** |
| **T3R1-G10**| **Model Commentary Separation**<br>Model analysis isolated under `modelAnalysis`; cannot forge receipt. | `task-executors.server.ts` line 186–205 | **PASS** |
| **T3R1-G11**| **Real Local Ollama Qualification**<br>Multi-agent team qualified with local `qwen2.5-coder:7b`. | Live Scenarios A, B, C | **PASS** |
| **T3R1-G12**| **Hard Model Pinning & Fail-Closed**<br>Pinned model enforced; no silent fallback or substitution. | Live Scenario E | **PASS** |
| **T3R1-G13**| **VRAM & System Memory Floor**<br>Requires 4.0 GiB free RAM; sequential GPU inference enforced. | `task-executors.server.ts` line 212 | **PASS** |
| **T3R1-G14**| **Consequential Approval Gate**<br>Disk edits require exact payload SHA-256 human approval. | Installed Journey Steps 13, 14 | **PASS** |
| **T3R1-G15**| **Crash Recovery & UNCERTAIN Governance**<br>Consequential failures become UNCERTAIN; zero auto-replay. | Approval & Recovery Suite | **PASS** |
| **T3R1-G16**| **Truthful Notch & Zero Synthetic Progress**<br>12 canonical states; no synthetic percentage estimations. | Installed Journey Step 10 | **PASS** |
| **T3R1-G17**| **Windows Installed Journey Qualification**<br>Complete 18-step user journey executed in packaged build. | `installed-journey.json` Steps 1–18 | **PASS** |
| **T3R1-G18**| **Production Isolation & State Preservation**<br>`%LOCALAPPDATA%\Bunny-A` and Startup shortcut untouched. | `installed-journey.json` Step 0 & Teardown | **PASS** |
| **T3R1-G19**| **Full Repository Regression Pass**<br>100% pass across all unit, integration, and UI tests. | Full `npm test`, `test:ui`, `test:ma4` | **PASS** |
| **T3R1-G20**| **Clean Production & Desktop Build**<br>Zero TypeScript errors; clean Vercel & Desktop Vite builds. | `npm run build`, `npm run typecheck` | **PASS** |

---

## 2. Beta Readiness Decision: NO-GO

While all technical requirements for milestone MA4-S3-T3R1 have passed with 100% empirical verification, the product classification remains **NO-GO for public beta distribution** at this stage:
- **Grounding Limitation:** 7B parameter models occasionally require targeted prompting or multiple rounds for non-trivial refactoring tasks.
- **Hardware Profile:** High reliance on local VRAM (minimum 6 GiB recommended) requires clear hardware preflight checks for consumer machines.
- **Desktop Packaging:** Formal EV code signing and installer wizard distribution are scheduled for subsequent production milestones.
