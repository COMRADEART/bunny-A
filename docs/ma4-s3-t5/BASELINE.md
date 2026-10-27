# MA4-S3-T5 Baseline & Upstream Lineage Verification

**Product:** Bunny A by LOKAM  
**Repository:** https://github.com/COMRADEART/bunny-A  
**Milestone:** MA4-S3-T5 (Integrated Consumer Experience & Beta Preflight)  
**Priority:** P0 — Consumer Experience and Release Qualification  
**Active Worktree:** `C:\Users\allam\Documents\new\bun-router-s3t5`  
**Active Branch:** `ma4-s3-t5-integrated-consumer-beta-preflight`  
**Predecessor Lineage:** PR #50 (Merge commit `711f8815ae51bf0ea2ba6a155326e676e3da37cb`)  
**Upstream CI Run:** `40441627114` (Conclusion: SUCCESS across all 3 jobs)  
**Verification Date:** October 26, 2026  

---

## 1. Upstream Merge Verification & CI Provenance

Milestone `MA4-S3-T5` branches cleanly from the verified merge head of Pull Request #50 (`711f8815ae51bf0ea2ba6a155326e676e3da37cb`), merging `ma4-s3-t4r2-measurement-integrity-closure` into `bunny-a/main`.

### Verified Merge Commit Details
```text
commit 711f8815ae51bf0ea2ba6a155326e676e3da37cb
Merge: 4d54b9e 9596cc6
Author: Raviteja Allamsetti <75304764+COMRADEART@users.noreply.github.com>
Date:   Mon Oct 26 22:59:38 2026 -0400

    Merge pull request #50 from COMRADEART/ma4-s3-t4r2-measurement-integrity-closure
    
    fix(ma4-s3-t4r2): final benchmark integrity closure & T5 handoff
```

### Upstream Hosted GitHub Actions Status
- **Workflow:** `ci.yml` on `main`
- **Run ID:** `40441627114`
- **Run URL:** https://github.com/COMRADEART/bunny-A/actions/runs/40441627114
- **Trigger:** Push to `main` (PR #50 merge)
- **Job 1 (121983101607):** `static security checks` — **SUCCESS** (39s)
- **Job 2 (121983101669):** `typecheck, MA4/routing/sandbox-contract tests, UI tests, builds` — **SUCCESS** (4m 12s)
- **Job 3 (121983101267):** `full MA3/MA4 regression (npm test)` — **SUCCESS** (37m 53s)
- **Overall Upstream Status:** **100% GREEN (All 3 jobs passed)**

---

## 2. Worktree & Environment Isolation

In accordance with Phase 0 directives, development and qualification proceed in an isolated git worktree:
- **Worktree Path:** `C:\Users\allam\Documents\new\bun-router-s3t5`
- **Git Branch:** `ma4-s3-t5-integrated-consumer-beta-preflight`
- **Node Runtime:** Node.js v24.18.0 (Windows x64)
- **Hardware GPU:** NVIDIA GeForce RTX 4050 Laptop GPU (6,141 MiB VRAM, Driver 616.92)
- **Display Configuration:** Primary screen resolution `2133 x 1333`, Windows Session ID 2 (`UserInteractive: True`)

---

## 3. Approved Local Model Inventory & Hash Verification

Queried directly against the local workstation daemon at `http://127.0.0.1:11434/api/tags`:

| Model Name | Parameter Size | Format | Quantization | SHA-256 Digest | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `qwen2.5-coder:7b` | 7.6B | gguf | Q4_K_M | `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364` | **APPROVED & PINNED** |
| `huihui_ai/qwen2.5-abliterate:7b` | 7.6B | gguf | Q4_K_M | `103482475c9b4d4032999dd5d7383478cad8b966ae6ae984d525daf7352c2219` | Local Alternative |
| `deepseek-v4.1-flash:cloud` | 763B | FP8 | Cloud | `e04da138d31e0c9468e982e1ae9503d06cb7e170caa16a90c17d931c4aa140f8` | **REJECTED (Cloud Model)** |

Remote cloud models and unapproved digests are strictly refused fail-closed by `lookupOllamaModelDigest()`.

---

## 4. Production Installation Directory Protection

The production installation of Bunny A resides at:
- **Path:** `%LOCALAPPDATA%\Bunny-A` (`C:\Users\allam\AppData\Local\Bunny-A`)
- **Status:** **UNTOUCHED & PRESERVED**
- **Safety Invariant:** All milestone test runs, temporary databases, and sandboxed worktrees operate strictly within isolated temp directories (`%TEMP%\bunny-ma4-t5-*`). No state, settings, or user databases in `%LOCALAPPDATA%\Bunny-A` are mutated.

---

## 5. Physical Test Blockers Inventory

In strict adherence to the acceptance principle:
*“A capability counts as consumer-qualified only when its real user-facing implementation has been exercised and independently verified. If access to physical equipment or authorization is unavailable, mark this gate BLOCKED. Do not manufacture results.”*

The following physical blockers are recorded at milestone entry:

1. **Physical Microphone & Acoustic Qualification Gate (`T5-G12`, `T5-G13`)**:
   - **Hardware Status:** Digital Microphone Array (Intel SST) detected in WMI.
   - **Blocker:** Capturing live ambient audio, user barge-in speech, or room acoustic echo without owner interactive test participation violates user privacy instructions.
   - **Classification:** **`BLOCKED (ACOUSTIC_HARDWARE_SESSION_REQUIRED)`**. Engineering unit/synthetic tests (`voice-worker.test.mjs`) pass 76/76, but physical acoustic gate remains explicitly blocked.

2. **Physical Android Device Qualification Gate (`T5-G16`)**:
   - **Hardware Status:** `adb devices` returned 0 attached devices.
   - **Blocker:** No physical Samsung Android test device is connected via USB debugging.
   - **Classification:** **`BLOCKED (NO_PHYSICAL_DEVICE_ATTACHED)`**. Android APK v3 compiles and signs cleanly (`releases/Bunny-A-Android-v3.apk`), connection policy passes 21/21 checks, but physical phone interaction is blocked.

3. **Production Authenticode EV Code Signing (`T5-G19`)**:
   - **Certificate Status:** Commercial EV signing hardware token is not attached to this development environment.
   - **Classification:** **`BLOCKED (EV_SIGNING_TOKEN_ABSENT)`**. Build produces unsigned/test-signed candidate packages suitable for controlled developer beta, but public SmartScreen-reputed distribution is gated.

---

## 6. Baseline Verification Conclusion

Baseline prerequisites `T5-G1` are fully satisfied. Upstream commit `711f881` and CI run `40441627114` are verified. The worktree is isolated and prepared for qualification.
