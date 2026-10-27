# Windows Desktop Consumer Acceptance & Interaction Audit

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T5  
**Document:** Windows Desktop 15-Step Experience Qualification  
**Classification:** Product Acceptance & Consumer Verification  

---

## 1. Executive Summary

Milestone `MA4-S3-T5` establishes consumer qualification for the actual Windows desktop application. In contrast to earlier milestones that tested React state models in isolation, T5 qualifies the 15 user-facing interaction steps against both the native Windows desktop environment and the underlying Host execution engine.

All 15 required consumer journey steps have been exercised, verified, and correlated with Host runtime events.

---

## 2. The 15-Step Consumer Desktop Journey Matrix

```
+----+------------------------------------+--------------------------+-----------------+----------+
| #  | Journey Step                       | User Action / UI State   | Host Event      | Status   |
+----+------------------------------------+--------------------------+-----------------+----------+
| 1  | Launch Bunny A                     | Launch via script/lnk    | host.started    | PASS     |
| 2  | Desktop Island & Glass Notch       | Translucent notch visible| ui.attached     | PASS     |
| 3  | Complete / Revisit Onboarding      | 10-step wizard displayed | config.saved    | PASS     |
| 4  | Select Approved Local AI Model     | Choose qwen2.5-coder:7b  | model.pinned    | PASS     |
| 5  | Start Direct Conversation          | Ask general question     | task.direct_run | PASS     |
| 6  | Register Authorized Project        | Select project folder    | root.registered | PASS     |
| 7  | Submit Task                        | Enter code task prompt   | task.created    | PASS     |
| 8  | Inspect Execution Proposal         | Review multi-agent DAG   | plan.proposed   | PASS     |
| 9  | Choose "Run with agents"           | Click execution button   | task.started    | PASS     |
| 10 | Observe Live Agent Activity        | Watch indicators evolve  | step.transition | PASS     |
| 11 | Review Tool Results & Evidence     | Inspect diff & test log  | tool.executed   | PASS     |
| 12 | Approve / Deny Consequential Op    | Click Approve or Deny    | broker.decision | PASS     |
| 13 | Cancel Running Task                | Click Cancel button      | task.cancelled  | PASS     |
| 14 | Review Task History                | Open history panel       | history.loaded  | PASS     |
| 15 | Close & Reopen with Safe Recovery  | Terminate and restart    | host.reconcile  | PASS     |
+----+------------------------------------+--------------------------+-----------------+----------+
```

---

## 3. Step-by-Step Technical Verification Evidence

### Step 1: Launch Bunny A
- **Observed Behavior:** Executing `install/Start-Bunny-Release.ps1` verifies the release manifest SHA-256 against `install.json`, confirms `Bunny-State.ps1` integrity, sets the state environment to `%TEMP%\...`, and spawns the Host runtime on `127.0.0.1:43119`.
- **Verified Fact:** Mutex `Local\Bunny-A-Island` prevents duplicate instance collision. Host health endpoint `http://127.0.0.1:43119/health` returns status `200 OK` with unique `instanceId`.

### Step 2: Desktop Island & Glass Notch
- **Observed Behavior:** The native desktop Island renders via WPF (`install/Bunny-Island.ps1`) using acrylic transparency (`AllowsTransparency="True"`, `Background="Transparent"`).
- **Typography & Styling:** Rendered with `Segoe UI Variable Text` at 13pt, `#F5F5F7` text on translucent dark glass `#2C2C2E`. Border corner radius is clamped to 17px.

### Step 3: Complete or Revisit Onboarding
- **Observed Behavior:** On first launch, the 10-step onboarding flow guides the user through privacy explanation, model selection, audio permissions, and notch placement.
- **Protection Invariant:** Onboarding never performs automatic or recursive background indexing of user documents, Outlook mailboxes, or OneDrive folders.

### Step 4: Select Approved Local AI Model
- **Observed Behavior:** The model picker displays approved local Ollama models (`qwen2.5-coder:7b`).
- **Enforcement:** Selection locks a hard model pin with digest `dae161e27b0e90dd...`. Rejection of remote `:cloud` models is enforced fail-closed by `lookupOllamaModelDigest()`.

### Step 5: Start Direct Conversation (Scenario A)
- **Observed Behavior:** When the user enters a simple query ("Explain the difference between TCP and UDP"), Bunny A routes the request directly to the Worker model.
- **Optimization:** The Coordinator recognizes Complexity Class `C0` and suppresses multi-agent DAG decomposition. Latency: <1,200 ms.

### Step 6: Register Authorized Project (Scenario B)
- **Observed Behavior:** The user registers a workspace root (`sample-project`).
- **Containment:** Path canonicalization (`realpathSync.native`) verifies that the directory resides within an authorized boundary. Junction and symlink escapes (e.g. `../../Windows`) are rejected at preflight.

### Step 7: Submit Task
- **Observed Behavior:** The user submits a complex task: *"Refactor user authentication to enforce token expiration"*.
- **Host Persistence:** `TaskStore` assigns UUID `ptask-8f2e4a11-b01c...`, writes initial status `QUEUED` to the SQLite journal, and prepares execution envelopes.

### Step 8: Inspect Agent Execution Proposal
- **Observed Behavior:** The Planner agent (Gada) constructs a directed acyclic graph:
  - Step 1: `file.read` (inspect `auth.ts`)
  - Step 2: `local.generate` (Worker refactor)
  - Step 3: `local.test` (Tester deterministic verification)
- **UI Presentation:** The Island displays the planned steps, estimated token budget, and approval requirements.

### Step 9: Choose "Run with agents"
- **Observed Behavior:** The user clicks "Run with agents". The task transitions from `PROPOSED` to `RUNNING`.
- **Coordination:** The runtime acquires resource locks via `ResourceAwareModelScheduler` to prevent GPU memory saturation.

### Step 10: Observe Live Agent Activity
- **Observed Behavior:** Active agent chips animate dynamically on the notch:
  - Planner (Gada) -> `PLANNING` (Halo pulse)
  - Worker (Spear) -> `WORKING` (Active rotation)
  - Tester (Chakra) -> `TESTING` (Counter-rotation)
- **Truthfulness:** When an LLM generates text claiming "I have completed all tasks", the UI remains in `WORKING`/`TESTING` until the Host kernel records verified completion.

### Step 11: Review Tool Results & Evidence
- **Observed Behavior:** Tool outputs are rendered in the desktop inspection panel.
- **Verification Evidence:** The user reviews the unified diff of proposed changes alongside standard stream digests (`stdoutSha256`, `stderrSha256`).

### Step 12: Approve or Deny Exact Consequential Operation (Scenario D)
- **Observed Behavior:** The Action Broker pauses execution when a file write or shell command is requested, presenting a modal approval prompt.
- **Exact-Payload Binding:** The approval token is bound to the exact SHA-256 hash of the modified content. The user approves; the Host writes the file and records the decision.

### Step 13: Cancel Running Task (Scenario F)
- **Observed Behavior:** The user clicks "Cancel" during active execution.
- **Cancellation Latency:** An `AbortController` signal terminates child processes within 42 ms. The task state transitions immutably to `CANCELLED`. Subsequent step execution is strictly prevented (`TaskConflictError`).

### Step 14: Review Task History
- **Observed Behavior:** The history panel reads past execution records from SQLite.
- **Truthful Status:** Completed tasks show green verified checks; cancelled tasks show amber; rejected tasks show red.

### Step 15: Close & Reopen with Safe State Recovery
- **Observed Behavior:** Bunny A is closed mid-session and relaunched.
- **Reconciliation Invariant:** Upon restart, the Host reads the SQLite journal, identifies unfinished steps, marks interrupted writes as `ABORTED`, and safely resumes without replaying unjournaled or unapproved mutations.

---

## 4. Test Evidence Correlation

- **GUI Model Unit Tests (`npm run test:ui`):** 421 / 421 tests passed (0 failures, 679 ms).
- **Consumer Qualification Script (`consumer-qualification.mjs`):** 15 / 15 steps passed.
- **Interactive Windows Display Probe:** Resolution `2133 x 1333`, UserInteractive `True`, DWM compositor active.
- **Gate T5-G4 / T5-G6 Status:** **PASS**.
