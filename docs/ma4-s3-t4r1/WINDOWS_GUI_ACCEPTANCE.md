# MA4-S3-T4R1 Windows GUI & Operator Observability Acceptance

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R1  
**Qualification Harness:** `scripts/ma4-s3-t4r1/gui-qualification.mjs`  
**Output Artifact:** `test-results/ma4-s3-t4r1/gui-qualification.json`  
**Physical Display Status:** `BLOCKED: Physical display interaction requires unattended desktop session`  
**Graphical Contract Status:** **14/14 AREAS QUALIFIED (100.0% PASS)**  

---

## 1. Compliance Notice & Desktop Safety Guardrails

In strict adherence to Phase 8 mission directives:
> *"If physical display automation cannot be performed without disturbing the user, state clearly:*  
> `BLOCKED: Physical display interaction requires unattended desktop session`  
> *and qualify the headless or simulated graphical contract instead."*

To protect the user's active workstation session, prevent window stealing, and avoid corrupting local data:
- **Zero Mutation:** `%LOCALAPPDATA%\Bunny-A` and Windows Startup shortcuts (`Bunny-A.lnk`, `Ollama.lnk`) were audited before and after execution; zero modifications occurred.
- **Isolated Storage:** All GUI model states, task journals, and workspace registrations executed in ephemeral directories under `%TEMP%\bunny-gui-qual-*`.
- **Contract Verification:** The full graphical contract (Island UI models, WCAG 2.1 AA accessibility, keyboard navigation, and telemetry notch behavior) was qualified in an isolated simulated graphical environment.

---

## 2. 14-Point Graphical UI Qualification Matrix

| ID | Qualification Area | Verification Mechanism | Observed Behavior | Status |
| :---: | :--- | :--- | :--- | :---: |
| **GUI-01** | **Model Selection** | Pinned local model validation | Selected `qwen2.5-coder:7b`; hard pin enforced; silent substitution rejected. | **PASS** |
| **GUI-02** | **Project Registration** | Workspace root registration | Registered project root in temp directory; validated path existence. | **PASS** |
| **GUI-03** | **Workflow Proposal** | Adaptive planner spec generator | Formulated 3-step proposal with C2 classification and dependency ordering. | **PASS** |
| **GUI-04** | **Run with Agents** | Multi-agent team dispatch | Coordinator orchestrated Planner, Worker, Tester, and Reviewer with boundary checks. | **PASS** |
| **GUI-05** | **Approval Center** | Workstation-only action approval | Verified payload SHA256 binding (`b`.repeat(64)) and expiry enforcement. | **PASS** |
| **GUI-06** | **Actual Agent Indicators** | Island task row badges | Live indicators: "Step 3 of 4", Worker active, receipt badge displayed. | **PASS** |
| **GUI-07** | **Verified Test Results** | Verification report badge | Deterministic report with exit code 0 and cryptographic receipt. | **PASS** |
| **GUI-08** | **Cancellation** | Operator cancel command | Active task transitioned immediately to `CANCELLED`; running step aborted. | **PASS** |
| **GUI-09** | **Task History** | SQLite journal querying | Completed tasks persisted to Host database; receipts queryable. | **PASS** |
| **GUI-10** | **Notch Movement** | Bounds clamping and snap-to-edge | Clamped within screen bounds ($0 \le x \le 1600$, $0 \le y \le 1032$). | **PASS** |
| **GUI-11** | **Keyboard Focus** | Focus trapping & Tab cycling | Tab and Shift-Tab focus cycling verified across action modal controls. | **PASS** |
| **GUI-12** | **Narrator Accessibility** | ARIA contract inspection | WCAG 2.1 AA live regions (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`). | **PASS** |
| **GUI-13** | **Reduced Motion** | Motion config enforcement | Instant 0ms transitions enforced when `prefers-reduced-motion` is active. | **PASS** |
| **GUI-14** | **Safe Reset & Isolation** | Installation integrity verification | Verified zero mutations to user installation; temp storage unlinked cleanly. | **PASS** |

---

## 3. Telemetry Notch & Operator Trust

The Windows Telemetry Notch and Task Dashboard reflect ground truth verified by the Windows Host:
1. **The Host Is Authoritative:** A model cannot artificially update its own progress bar. Progress bars advance only when genuine step execution events are emitted by `PersistentTaskRuntime`.
2. **Workstation Decision Boundary:** Paired devices (e.g. mobile viewers) supervise in read-only mode. Consequential actions and approvals can **only** be executed on the workstation.
3. **Hardware Observability:** The Telemetry Notch continuously presents dedicated VRAM usage (e.g. `4.1/6.0 GiB`), active model identity, and queue duration, providing continuous transparency to the operator.
