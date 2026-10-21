# Privacy and security validation

Base: `f5d3f90`. External inference remains OFF; live activation is PENDING USER APPROVAL. No external-provider authentication, credential activation, quota exhaustion or cloud model invocation occurred. Public provider-documentation lookup sends no benchmark fixture.

| Boundary | Evidence and actual scope |
|---|---|
| Default external denial | Real local Host configuration remains disabled; unapproved OpenRouter submit refused before fetch. Existing deterministic consent tests rerun. |
| Sensitive fixtures stay local | Synthetic sensitive task completed with exact local coder pin; fresh preflight verifies no remote tag. Harness only permits loopback Ollama and preflight-verified small local tags. |
| Credentials absent from outputs | Existing DPAPI, known-secret redaction, provider-error omission and device-projection tests; qualification reads no external key. Test keys are synthetic. |
| Hard pins and fallback | Real successful exact pin, unavailable pin with zero generation, controlled missing-pin agent, and deterministic fallback/policy-revision tests. New served-model mismatch regression fails closed. |
| Tools and permissions | Existing capability authorization suite; real qualification runs with an empty capability adapter set. Metadata cannot confer tool permission. Native calculator proposal trial failed; no arbitrary call was executed. |
| Cancellation and cleanup | Real first-token cancellation and mission Stop; controller absent and sessions zero. Explicit unload plus final empty runtime cache list. |
| Untrusted metadata / output | Existing disabled discovery, strict configuration and requirements tests. Output is data; no evaluator or tool interpreter grants policy authority from model text. |
| Quotas and retries | Mock-backed atomic reservations, cooldown/retry-after, bounded timeout, cancellation queue cleanup and cost ceilings. No real provider balance or quota was exercised. |

Full current command outcomes:

| Check | Command | Result | Runtime |
|---|---|---|---|
| regression | `npm run test` | FAIL (exit 1) | 233.4 s |
| ui | `npm run test:ui` | PASS (exit 0) | 1.2 s |
| typecheck | `npm run typecheck` | FAIL (exit 2) | 24.9 s |
| build-mobile-web | `npm run build` | PASS (exit 0) | 29.4 s |
| build-desktop | `npm run build` | PASS (exit 0) | 8.8 s |
| regression-after-prerequisite (before R18 fixture correction) | `npm run test` | FAIL (exit 1) | 961.0 s |
| ui-final | `npm run test:ui` | PASS (exit 0) | 1.2 s |
| typecheck-final | `npm run typecheck` | PASS (exit 0) | 17.4 s |
| build-mobile-web-final | `npm run build` | PASS (exit 0) | 8.6 s |
| build-desktop-final | `npm run build` | PASS (exit 0) | 6.2 s |
| regression-after-prerequisite | `npm run test` | FAIL (exit 1) | 961.0 s |

Security assertions are bounded functional evidence, not a claim of comprehensive DLP, network monitoring of all machine processes, OS sandbox penetration testing or a formal audit. The harness fetch allowlist covers qualification-owned requests; it is not a machine-wide firewall. Ollama tags are checked again immediately before execution. Existing user/system services and user state are preserved.

Reproduction: `npm run test:ma4`, focused `node --experimental-strip-types --test src/lib/bunny-host/ma4-s1r.test.ts src/lib/orch/exec.server.test.ts src/lib/bunny-host/model-capability.test.ts`, and `npm test`. Exact results/overlap are in `evidence/checks.json`; focused suite passes are not added to regression totals twice.
