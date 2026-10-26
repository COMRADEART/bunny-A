# MA4-S3-T3R2 — Baseline Audit & Environmental Profile

## 1. Executive Summary & Objective

Milestone MA4-S3-T3R2 ("Security Boundary Closure, Execution Containment & Production Qualification") hardens Bunny A's agent execution environment against unauthorized filesystem access, arbitrary command execution, unsafe test scripts, misleading verification receipts, and incomplete Windows UI qualification.

The core objective is to enforce operating-system-level and Host-kernel-level security controls at the actual trust boundary:
1. **Eliminate Arbitrary Root-Path Authority:** Remove raw caller-supplied filesystem path authority from the `local.test` step input contract. All execution must be anchored strictly in Host-registered root identifiers, bound by explicit task envelope grants, canonicalized, and protected against symlink, junction, and reparse-point escapes.
2. **Lock Down Test Command Execution:** Separate execution into Mode A (Host-verified approved test target with locked argument templates) and Mode B (Explicitly authorized project test profile). Prohibit arbitrary `npm` script execution, dynamic `npx` package downloads, and dangerous Node code-evaluation / preload flags.
3. **Windows Process Isolation Qualification:** Evaluate and verify Windows Job Object process-tree containment, memory floors, handle inheritance restrictions, execution timeouts, and cancellation. Truthfully report the boundaries of OS isolation and enforce a strict fail-closed policy against untrusted project code.
4. **Secure Test Reports & Artifact Paths:** Enforce registered-root containment, fresh mtime/hash verification (rejecting stale evidence), schema validation, and bounded size limits on all test reports and output artifacts.
5. **Preserve Verification Integrity:** Maintain deterministic exit code precedence, cryptographic receipt chaining, and absolute separation between non-authoritative model analysis and verified Host execution facts.
6. **Real Local-Agent & GUI Qualification:** Re-qualify real local Ollama inference (`qwen2.5-coder:7b`) and execute a comprehensive 20-step standalone Windows GUI journey with accessibility verification while rigorously preserving existing production installations and Start Menu shortcuts.

---

## 2. Predecessor Verification & Source Audit

- **Predecessor Merge Commit:** `5e35cb9d84823671a88826cf6d54a1f74a0cea06` (Merge PR #46 from `COMRADEART/ma4-s3-t3r1-real-agent-qualification` into `main`).
- **Predecessor Verified Tree:** Fetched `bunny-a/main` from `https://github.com/COMRADEART/bunny-A.git`, verified exact merge commit and clean tree.
- **Milestone Branch:** `ma4-s3-t3r2-security-boundary-closure`
- **Isolated Worktree:** `C:\Users\allam\Documents\new\bun-router-s3t3r2`
- **Predecessor Evidence Inspected:** All qualification records in `docs/ma4-s3-t3r1/` (including `BASELINE.md`, `REAL_EXECUTION_ARCHITECTURE.md`, `TEST_EXECUTOR_SECURITY.md`, `TEST_VERIFICATION_INTEGRITY.md`, `WINDOWS_INSTALLED_ACCEPTANCE.md`, and `evidence/installed-journey.json`) were inspected and preserved intact without modification.

---

## 3. Host System & Hardware Profile

| Metric | Measured Value | Verification Method |
| :--- | :--- | :--- |
| **Operating System** | Windows 11 Pro 64-bit (`10.0.26300`) | `[Environment]::OSVersion.VersionString` / `systeminfo` |
| **Node.js Runtime** | `v24.18.0` (x64) | `node -v` (`C:\Program Files\nodejs\node.exe`, 92,534,088 bytes) |
| **Total System RAM** | 31.84 GiB (34,188,435,456 bytes) | `Get-CimInstance Win32_OperatingSystem` |
| **Available RAM (Idle)** | 14.5–16.8 GiB free (well above 4 GiB floor) | `freemem()` in `task-executors.server.ts` |
| **GPU / Acceleration** | NVIDIA GeForce RTX 4050 Laptop GPU | `nvidia-smi` |
| **VRAM Dedicated** | 6,141 MiB (6.0 GiB) | `nvidia-smi` |
| **NVIDIA Driver Version** | `576.88` / CUDA `12.9` | `nvidia-smi` |
| **Ollama Server Version** | `v0.40.11` | `GET http://127.0.0.1:11434/api/version` |
| **Authorized Local Model** | `qwen2.5-coder:7b` | `GET http://127.0.0.1:11434/api/tags` |
| **Model Digest** | `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364` | Verified via Ollama tags manifest |
| **Model Size** | 4,683,087,561 bytes | Verified via Ollama manifest |

---

## 4. Production State & Installation Preservation Baseline

Prior to creating any test workspaces or initiating local runs, existing production installations and Start Menu shortcuts were audited to ensure zero drift:

| Target | Path | Baseline Timestamp (UTC) | Length |
| :--- | :--- | :--- | :--- |
| **Production App Data** | `C:\Users\allam\AppData\Local\Bunny-A` | `10/23/2026 5:03:03 PM` | Directory |
| **Startup Shortcut** | `C:\Users\allam\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\Bunny-A.lnk` | `10/18/2026 2:52:57 AM` | 2,882 bytes |

**Preservation Invariant:** All milestone tests, builds, and packaged GUI qualifications MUST redirect application state, workspace paths, and registry keys to isolated disposable locations (e.g. `Bunny-T3R2-Package`, `alpha-host-t3r2`), ensuring production timestamps and shortcut targets remain strictly unaltered.
