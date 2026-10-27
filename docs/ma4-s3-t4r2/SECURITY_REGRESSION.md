# Security, Privacy & Containment Regression Audit

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R2  
**Document:** Security Boundaries & Invariant Audit  
**Classification:** P0 Security & Verification Integrity  

---

## 1. Security Architecture & Boundary Invariants

Milestone `MA4-S3-T4R2` enforces strict security, privacy, and process containment invariants across all benchmark execution paths.

```
                                  ┌───────────────────────────────┐
                                  │   Model Output / Execution    │
                                  └───────────────┬───────────────┘
                                                  │
                 ┌────────────────────────────────┼────────────────────────────────┐
                 ▼                                ▼                                ▼
   ┌───────────────────────────┐    ┌───────────────────────────┐    ┌───────────────────────────┐
   │ 1. Local-Only Provider    │    │ 2. Process Containment    │    │ 3. Credential & Data      │
   │                           │    │                           │    │    Privacy Invariants     │
   │ • Fail-closed /api/tags   │    │ • Approved node.exe only  │    │ • Zero DPAPI secrets leak │
   │ • Cloud models rejected   │    │ • Locked Mode A arguments │    │ • Zero external egress    │
   │ • Zero remote fallback    │    │ • Contained project roots │    │ • Benchmark artifacts     │
   │ • Model pin enforcement   │    │ • Windows Job Object tree │    │   fully sanitized         │
   └───────────────────────────┘    └───────────────────────────┘    └───────────────────────────┘
```

---

## 2. Invariant 1: Local-Only Model Execution & Rejection of Cloud Gateways

### 2.1 Rejection of Remote Cloud Models
Bunny A enforces a strict local-only execution policy for benchmark runs and private task execution. In `live-benchmark.server.ts`:
- Models flagged with `:cloud` or declaring a `remote_host` (such as `deepseek-v4.1-flash:cloud` observed in local Ollama tags) are strictly rejected with `status: "remote_model_rejected"`.
- When local Ollama is offline or uninstalled, the system **never falls back** to remote API endpoints (e.g. OpenAI, Anthropic, or external gateways).

### 2.2 Model Pinning & Anti-Spoofing
- The benchmark runner validates model identity against the cryptographic SHA-256 digest returned by the Ollama daemon.
- Silent fallback to `BENCHMARK_MODEL_DIGEST` has been eliminated. If the model tag or digest cannot be physically verified, execution fails closed.

---

## 3. Invariant 2: Process Containment & Code Execution Restrictions

### 3.1 Operating System Sandbox Limitations
Bunny A explicitly acknowledges that the Node runtime on Windows operates within the user's security context without a kernel-enforced sandboxed filesystem or network container.

### 3.2 Mitigation: Locked Fixture Execution
To prevent arbitrary code execution under the user's account:
- The benchmark harness **never automatically executes arbitrary model-generated JavaScript or shell scripts**.
- Process testing is restricted exclusively to trusted, pre-approved test fixtures residing strictly within the verified project root (`assertContainedPath`).
- Invocation arguments are locked to Node's deterministic test runner:
  ```text
  ["--experimental-strip-types", "--test", <resolved-contained-fixture>]
  ```
- Any attempt by the model to spawn arbitrary executables (`powershell.exe`, `cmd.exe`, or unapproved interpreters) is refused at the host runner admission gate.

### 3.3 Windows Job Object Lifecycle
All spawned worker processes and deterministic test runs are enrolled into Windows Job Objects (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`). If the parent Host process or task runtime terminates, all descendant processes are immediately terminated by the Windows kernel, preventing orphan processes.

---

## 4. Invariant 3: Hardware Safety & OOM Prevention

- When `nvidia-smi` hardware telemetry is unavailable, the system defaults to a conservative single-model, single-agent scheduling mode.
- Parallel dual-7B model execution is strictly forbidden unless physical telemetry confirms >= 5.5 GiB of free dedicated VRAM.
- This prevents out-of-memory kernel paging, system instability, or thermal throttling.

---

## 5. Invariant 4: Privacy & Zero Credential Exposure

- All benchmark artifacts, task reports, and journal logs are sanitized of user paths, environment credentials, and private git commit history.
- Cryptographic keys and local authentication tokens remain encrypted using Windows DPAPI (`CryptProtectData`) and are never exposed in benchmark outputs or test evidence.
- Zero network packets are transmitted to external cloud servers during local qualification.

---

## 6. Verification Matrix

| Security Domain | Defense Mechanism | Test Evidence | Result |
| :--- | :--- | :--- | :---: |
| **Model Ingress** | Remote cloud model rejection | `benchmark-integrity.test.ts` (unapproved & cloud model rejections) | **PASS** |
| **Model Pinning** | Fail-closed digest validation | `benchmark-integrity.test.ts` (exact SHA-256 check) | **PASS** |
| **Code Execution** | Refusal of arbitrary model code | `benchmark-integrity.test.ts` (12 negative process proofs) | **PASS** |
| **Job Containment** | Windows Job Object kill-on-close | `owned-process-group.test.ts` & `stop-ownership.test.ts` | **PASS** |
| **Data Privacy** | DPAPI credential isolation | `oauth-pkce.test.ts` & `gate-identity.test.ts` | **PASS** |
| **Hardware Safety** | Conservative scheduling on unavailable telemetry | `benchmark-integrity.test.ts` (fail-closed telemetry) | **PASS** |

**Gate Result:** **T4R2-G13 PASS.**
