# Fail-Closed Model Identity & Digest Verification

**Product:** Bunny A by LOKAM  
**Milestone:** MA4-S3-T4R2  
**Document:** Model Identity Integrity Architecture  
**Classification:** P0 Verification Integrity  

---

## 1. The Model Identity Problem

In predecessor milestone `MA4-S3-T4R1`, the helper `getOllamaModelDigest()` contained a fallback:
```typescript
// Pre-T4R2 fallback
catch {
  return BENCHMARK_MODEL_DIGEST; // "sha256:d5b8e9..."
}
```
This fallback created a critical verification flaw: if Ollama was unreachable, if the model was missing, or if network connectivity failed, the benchmark harness silently returned a plausible, pre-computed digest. A benchmark run could appear to have executed against a verified local model when no model was actually observed.

Furthermore, remote cloud-hosted models could be queried under local task configurations without explicit detection.

---

## 2. Fail-Closed Model Identity Specification

Milestone `MA4-S3-T4R2` implements `lookupOllamaModelDigest()` in `src/lib/bunny-host/ma4/live-benchmark.server.ts` with strict fail-closed semantics:

```
                            ┌───────────────────────────────┐
                            │ lookupOllamaModelDigest(spec) │
                            └───────────────┬───────────────┘
                                            │
                             Is fixture simulation active?
                                            │
                   ┌────────────────────────┴────────────────────────┐
                   │ YES                                             │ NO
                   ▼                                                 ▼
        ┌──────────────────────┐                         ┌──────────────────────┐
        │  Evaluate Fixture    │                         │  Query Local Ollama  │
        │  Inventory           │                         │  /api/tags Endpoint  │
        └──────────┬───────────┘                         └──────────┬───────────┘
                   │                                                │
         Tag with status:                                 Evaluate physical
         "simulated",                                     inventory and digest
         isSimulated: true                                          │
                   │                                                │
                   └────────────────────────┬───────────────────────┘
                                            │
                                  Passes All Criteria?
                                  • Daemon online
                                  • Model in inventory
                                  • Not remote cloud host
                                  • Digest valid SHA-256
                                            │
                           ┌────────────────┴────────────────┐
                           │ YES                             │ NO
                           ▼                                 ▼
               ┌───────────────────────┐         ┌───────────────────────┐
               │ verified: true        │         │ verified: false       │
               │ digest: "<sha256>"    │         │ digest: null          │
               │ status: "verified"    │         │ status: <failure_code>│
               └───────────────────────┘         └───────────────────────┘
```

### Rejection & Failure Taxonomy
1. **Daemon Offline / Network Failure:** If `http://127.0.0.1:11434/api/tags` is unreachable or returns a non-200 HTTP code, the lookup immediately fails closed:
   - `verified: false`
   - `digest: null`
   - `status: "ollama_unavailable"`
2. **Model Not Found:** If the requested model tag is absent from `/api/tags`:
   - `verified: false`
   - `digest: null`
   - `status: "model_not_found"`
3. **Malformed Digest:** If the digest does not match `/^[a-f0-9]{64}$/`:
   - `verified: false`
   - `digest: null`
   - `status: "malformed_digest"`
4. **Remote Cloud Model Rejection:** If the model tag specifies a remote provider (e.g. `:cloud`, `remote_host`, or external gateway) under a local task invariant:
   - `verified: false`
   - `digest: null`
   - `status: "remote_model_rejected"`
5. **No Provider Fallback:** The system strictly refuses to fall back to OpenAI, Anthropic, or other cloud providers when local Ollama inference fails.

### Distinguishing Test Simulations from Physical Observations
To prevent simulated test fixtures from masquerading as physical hardware qualifications, `lookupOllamaModelDigest` enforces explicit simulation tagging:
- When executed against a test fixture:
  ```json
  {
    "verified": true,
    "digest": "dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364",
    "status": "simulated",
    "isSimulated": true,
    "model": "qwen2.5-coder:7b"
  }
  ```
- Physical hardware qualification gates require `isSimulated === false` and `status === "verified"`.

---

## 3. Physical Host Inventory Audit

A direct query to the physical workstation's Ollama daemon (`http://127.0.0.1:11434/api/tags`) observes the following inventory:

| Model Tag | Observed SHA-256 Digest | Provider | Qualification Classification |
| :--- | :--- | :--- | :--- |
| `qwen2.5-coder:7b` | `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364` | Local Ollama | **APPROVED** (Local benchmark baseline model) |
| `deepseek-v4.1-flash:cloud` | `remote-cloud-manifest-digest` | Remote Host | **REJECTED** (`remote_model_rejected` for local tasks) |

---

## 4. Test Verification Evidence

The fail-closed model identity contract is verified in `src/lib/bunny-host/ma4/benchmark-integrity.test.ts`:
- **Unapproved Model:** Querying `unapproved-model:latest` returns `verified: false`, `status: "model_not_found"`.
- **Remote Cloud Provider:** Querying `deepseek-v4.1-flash:cloud` returns `verified: false`, `status: "remote_model_rejected"`.
- **Simulated Fixture:** Simulation returns `isSimulated: true`, `status: "simulated"`.
- **Offline Failure:** Unreachable daemon returns `verified: false`, `status: "ollama_unavailable"`, `digest: null`.

**Gate Result:** **T4R2-G5 PASS.**
