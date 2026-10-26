# MA4-S3-T4R1 Baseline and Source Integrity

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R1  
**Mission:** Real Workflow Benchmark Integrity, Verified Learning & Performance Qualification  
**Date:** October 26, 2026  
**Status:** QUALIFIED BASELINE  

---

## 1. Upstream Commit Lineage & Predecessors

The baseline evaluation establishes rigorous provenance connecting MA4-S3-T4R1 directly to approved, merged upstream commits:

| Milestone | PR / Reference | Commit SHA | Status |
| :--- | :--- | :--- | :--- |
| **MA4-S3-T3R2** (Pre-T4 Reference) | PR #47 | `4d19781ce73b9e4a5d8481ff2438883626244f2b` | Merged into `main` |
| **MA4-S3-T4** (Review Baseline) | PR #48 | `52aa6f3e961523444488ca4059867267baf2b6cf` (Head) | Merged into `main` |
| **Current `main` Merge Commit** | PR #48 Merge | `791753451984e8536cb81f25dff5e0f323f88062` | Verified Green |
| **MA4-S3-T4R1 Branch Worktree** | `ma4-s3-t4r1-real-workflow-qualification` | Worktree isolated at `bun-router-s3t4r1` | Active Working Tree |

Hosted GitHub Actions CI on `main` merge commit `791753451984e8536cb81f25dff5e0f323f88062`:
- **Run ID:** `40402654001`
- **Result:** Success (Static security audit, TypeScript compilation, Vitest Island UI tests, and MA4 Host regression passed).

---

## 2. Frozen Hardware & Runtime Environment

All benchmarks, multi-agent qualifications, and memory experiments execute on the identical physical hardware workstation:

- **Operating System:** Windows 11 Pro 64-bit (Build 10.0.26300)
- **Node.js Runtime:** `v24.18.0`
- **Package Manager:** `npm 11.16.0`
- **Local Model Server:** Ollama `0.40.11` (listening on `http://127.0.0.1:11434`)
- **Primary Discrete GPU:** NVIDIA GeForce RTX 4050 Laptop GPU
  - Dedicated VRAM: 6,141 MiB (6,439,305,216 bytes)
  - Driver Version: `616.92` (DirectX 12 / CUDA 13.4)
  - Active VRAM Allocation with Model Resident: ~4,298 MiB
  - Free Dedicated VRAM: ~1,910 MiB
- **Integrated NPU:** Intel(R) AI Boost (Detected; marked `UNSUPPORTED_IN_UPSTREAM_OLLAMA` per conservative execution policy)
- **Host System Physical RAM:** 16,384 MiB physical system RAM

---

## 3. Approved Pinned Model Identity

Strict adherence to local zero-fallback pin policy:
- **Requested Model Name:** `qwen2.5-coder:7b`
- **Served Model Family:** `qwen2.5-coder`
- **Observed Verified Digest:** `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`
- **Context Window Limit:** 32,768 tokens (discovered architecture limit)
- **Quantization:** Q4_K_M
- **Fallback Policy:** Cloud fallback, model substitution, or unpinned routing strictly forbidden (`PIN_VIOLATION` halts execution).

---

## 4. User Installation & Data Preservation Invariants

In accordance with Phase 0 requirements:
1. Existing user installation in `%LOCALAPPDATA%\Bunny-A` is preserved without any mutation.
2. Windows Startup shortcuts (`Bunny-A.lnk`, `Ollama.lnk`) remain untouched.
3. All benchmark executions utilize isolated disposable temporary directories (`%TEMP%\bunny-live-bench-*`) and transient SQLite databases (`bench-mem.sqlite`) that are cleanly closed and unlinked upon completion.
