# Bunny A Consumer Architecture: Windows & Android

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T5  
**Document:** Unified Consumer System Architecture  
**Classification:** Core System Architecture Specification  

---

## 1. Architectural Philosophy: The Unified Consumer Experience

Bunny A is designed not as a loose collection of disparate developer prototypes, but as a cohesive, installable, and trustworthy consumer AI companion operating seamlessly across Windows 11 and Android.

The architecture synthesizes Apple Human Interface design principles with deep Windows native integration and hardened local-first security:
- **Zero Cloud Dependence for Execution:** Core intelligence executes locally on the workstation's GPU via Ollama (`qwen2.5-coder:7b`).
- **Zero Silent Privilege Escalation:** The Windows Host remains the sole authority for local filesystem, shell, and network operations.
- **Fail-Closed Exact Payload Approval:** Any consequential modification requires cryptographic SHA-256 approval on the workstation.
- **Unified Companion Model:** The Android application acts as a secure, authenticated supervision companion, never an autonomous workstation root.

---

## 2. System Architecture Topology

```
+----------------------------------------------------------------------------------------------------+
|                                    WINDOWS WORKSTATION (Host Authority)                            |
|                                                                                                    |
|  +-------------------------------------+   +----------------------------------------------------+  |
|  |     Windows Island & Glass Notch    |   |           Real-Time Full-Duplex Voice Engine       |  |
|  |  * WPF / XAML Native Window         |   |  * native/voice/bunny-voice-worker.exe (.NET 4)    |  |
|  |  * Segoe UI Variable Typography     |   |  * whisper.cpp v1.9.4 local STT (ggml-base.en)     |  |
|  |  * Movable 4-Edge Placement         |   |  * Windows SAPI / Media Foundation Audio           |  |
|  |  * Dynamic Active Agent Indicators  |   |  * Acoustic Echo Cancellation & Barge-in Ducking   |  |
|  +------------------+------------------+   +-------------------------+--------------------------+  |
|                     |                                                |                             |
|                     +-----------------------+------------------------+                             |
|                                             | IPC Loopback Protocol                                |
|                                             v                                                      |
|  +----------------------------------------------------------------------------------------------+  |
|  |                                  Bunny-A Host Kernel (Port 43119)                            |  |
|  |                                                                                              |  |
|  |  +--------------------------+  +--------------------------+  +----------------------------+  |  |
|  |  |     Coordinator & DAG    |  |      Action Broker       |  |        Lotus Memory        |  |  |
|  |  |  Planner/Worker/Tester/  |  |  Exact SHA-256 Payload   |  |  Project-Scoped Episodic   |  |  |
|  |  |  Reviewer Multi-Agent    |  |  Workstation Approvals   |  |  Zero Cross-Project Leak  |  |  |
|  |  +-------------+------------+  +------------+-------------+  +-------------+--------------+  |  |
|  |                |                            |                              |                 |  |
|  |  +-------------v----------------------------v------------------------------v--------------+  |  |
|  |  |               PersistentTaskRuntime & SQLite TaskStore (persistence.server.ts)          |  |  |
|  |  +------------------------------------------+---------------------------------------------+  |  |
|  |                                             |                                                |  |
|  |  +------------------------------------------v---------------------------------------------+  |  |
|  |  |           Deterministic Test Runner (executeDeterministicTest Mode A)                  |  |  |
|  |  |           Node.exe isolated child process, captured stdout/stderr SHA-256               |  |  |
|  |  +------------------------------------------+---------------------------------------------+  |  |
|  +---------------------------------------------+------------------------------------------------+  |
|                                                |                                                   |
|                                                | Encrypted Pairing Protocol (QR / TLS)             |
+------------------------------------------------+---------------------------------------------------+
                                                 |
                                                 v
+----------------------------------------------------------------------------------------------------+
|                                      ANDROID COMPANION CLIENT                                      |
|                                                                                                    |
|  * Package: com.routeragent.jev (minSdk 26, targetSdk 35)                                          |
|  * Hardened WebView Container (Zero native JS bridge, No third-party cookies, TLS pinned)          |
|  * Live Task Supervision & Real-Time Agent Indicators                                              |
|  * Strict Approval Invariant: Displays "Approval required on Windows" for Consequential Actions    |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. Subsystem Breakdown

### 3.1 The Windows Island & Movable Glass Notch
- **Visual Design:** Translucent acrylic glass appearance rendered with Apple HIG-informed visual balance: white, neutral gray (`#F5F5F7`), and metallic highlights (`#636366`).
- **Placement Engine (`Bunny-Island.Placement.ps1`):** Supports top, bottom, left, and right screen edges within the primary display work area:
  - **Horizontal Edges (Top / Bottom):** Notch length extends horizontally; active agent indicators appear on the **LEFT** side of the body.
  - **Vertical Edges (Left / Right):** Notch length extends vertically along the edge; active agent indicators appear at the **TOP** of the body.
  - **Bounded Indicators:** Maximum 4 visible agent weapon chips plus one `+N` overflow chip; never expands unboundedly.
- **Agent Roles & Identity Assets:**
  - **Planner:** Represented by **Gada** (Wisdom, structural stability)
  - **Worker:** Represented by **Spear** (Precision execution, focused focus)
  - **Tester:** Represented by **Chakra** (Cyclic verification, deterministic assertion)
  - **Reviewer:** Represented by **Sword** (Decisive quality gate, stylistic cut)

### 3.2 Real-Time Full-Duplex Voice Engine
- **Architecture:** Managed C# worker process (`native/voice/bunny-voice-worker.exe`) communicating over standard input/output with JSON-delimited protocol frames (`protocol: "bunny-voice/1"`).
- **Acoustic Echo Cancellation (AEC):** Tracks hardware playback residual to prevent Bunny A's own synthesized voice from triggering recognition on the microphone input.
- **Barge-in Ducking & Cancellation:** When user onset is detected during active speech playback, the voice worker immediately issues `speak.cancel`, silences output audio in `<50ms`, drops stale generation buffers, and transitions to capture mode.
- **Speech-to-Text Pipeline:** Local `whisper.cpp v1.9.4` running quantized `ggml-base.en` weights directly on CPU/GPU without cloud network transport. Seamless fallback to Windows SAPI if Whisper runtime is unstaged.

### 3.3 Host Kernel & Task Orchestration
- **Task Runtime (`PersistentTaskRuntime`):** Backed by SQLite (`TaskStore`), recording every task creation, step transition, tool call, and terminal state.
- **Coordinator & Agent Roles:** Multi-agent collaboration coordinates Planner, Worker, Tester, and Reviewer. Single-step tasks (C0 direct conversation) bypass multi-agent decomposition to eliminate unnecessary latency and token expenditure.
- **Deterministic Test Runner (`executeDeterministicTest`):** Spawns authorized Node.js processes with Mode A locked arguments (`--experimental-strip-types`, `--test`). Captures streams up to 200 KB, computes SHA-256 digests, and generates immutable provenance receipts (`receipt:test-exec:...`).

### 3.4 Windows Approval Center & Action Broker
- **Security Boundary:** Consequential operations (file writes, project mutations, test executions) require explicit authorization before execution.
- **Exact-Payload SHA-256 Binding:** Approvals are bound to the exact content hash of the proposed change. A model cannot substitute a different mutation under an existing approval.
- **Fail-Closed Enforcement:** Denials terminate the affected branch immediately. No Lotus Memory entry or planning heuristic can override an explicit user rejection.

### 3.5 Android Companion Integration
- **Package Identity:** `com.routeragent.jev`, targeting modern Android (API 35, minimum API 26).
- **Security Sandbox:** Operates inside a secure WebView sandbox with:
  - Cleartext traffic disabled (`android:usesCleartextTraffic="false"`).
  - No JavaScript-to-native bridge (`addJavascriptInterface` strictly omitted).
  - Mixed content rejected (`MIXED_CONTENT_NEVER_ALLOW`).
  - Third-party cookies and file/content access disabled.
- **Remote Policy Contract:** A paired phone can supervise tasks, monitor agent states, and receive notifications. When a consequential operation awaits consent, the Android UI displays **"Approval required on Windows"** and disables remote execution.

---

## 4. Architectural Invariants Summary

1. **Host Primacy:** The local Windows machine is the single source of authority for permissions, file access, and execution.
2. **Local-First Model Pin:** Only verified local Ollama models (`qwen2.5-coder:7b`) are admitted for execution. Cloud models are rejected.
3. **Receipt Provenance:** A test receipt cannot exist without an authorized OS process execution.
4. **Zero Silent Scanning:** First-run onboarding and project registration never scan user files without explicit consent.
