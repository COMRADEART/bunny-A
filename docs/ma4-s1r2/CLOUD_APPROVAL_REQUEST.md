# MA4-S1R2 cloud approval request — STATUS: PENDING (nothing activated)

This document requests a decision. It does not authorize anything. No credential has been created, read or stored, no provider is enabled, and no external call has been made.

## Proposal

| Item | Proposed |
|---|---|
| Provider | Groq (GroqCloud API, `https://api.groq.com/openai/v1`) |
| Exact model | `openai/gpt-oss-120b` (fallback for comparison only if separately approved: `qwen/qwen3.8-27b`) |
| Why | Local 7B models failed G7 (see [G7_QUALIFICATION_RESULTS.md](G7_QUALIFICATION_RESULTS.md)) and emitted 0/12 tool calls; the 27B/30B weights cannot load in measured headroom. gpt-oss-120b has documented tool use and JSON mode on Groq, and Groq's contract forbids training on inputs/outputs. |
| Capabilities (documented) | chat completions, tool use (no parallel tool calls), JSON mode. Context/output limits: re-check in the console at activation (not recorded as verified). |
| Free-tier conditions | Free plan, rate-limited, no card. Limits are organization-scoped and account-specific; the docs show 30 RPM / 1,000 RPD / 8K TPM / 200K TPD as base values. No permanence guarantee. |
| Data exposure | **Synthetic qualification tasks only**: the frozen G7 held-out specs, unchanged G7 v2 spec and frozen benchmark prompts already in this repo. No user code, project files, memories, credentials, prompts from real tasks, or evaluation answers (hidden tests and references stay host-side). |
| Retention | Groq does not retain inference data by default, but may log inputs/outputs for up to 30 days for reliability/abuse. **Proposed condition: enable Zero Data Retention in Groq Data Controls before the first call.** |
| Proposed test calls | at most 150 requests total: G7 held-out 10 tasks × 2 trials and v2 regression × 3 (≈ 6 calls per trial ≈ 140), plus 10 tool-call benchmark samples. Bunny's reservation store will enforce `requestsPerMinute ≤ 20`, `requestsPerDay ≤ 50` per day (it caps at 50; the run would span ≥ 3 days unless the cap is raised with approval). |
| Maximum estimated spend | **$0.00**: free plan only; `allowPaid: false`, `maxUsdPerRequest: 0`, `maxUsdPerDay: 0`, approval `spending_limit_usd: 0`. Any billing prompt stops the run. |
| Credentials | one Groq API key created by the owner, stored with the existing DPAPI connection store (`connections.credential.save`), never in files, env or logs |
| Commercial use | Groq Services Agreement allows use within customer applications ("not for consumer use"); no resale; usage must not aim to avoid fees. Owner to confirm this fits LOKAM's intended use. |
| Geographic | no geographic restriction in the agreement (export-control clauses apply); the contracting entity depends on the owner's region. |

## Approval record that would be issued (by the owner on the workstation)

```json
{
  "provider_id": "groq",
  "model_id": "openai/gpt-oss-120b",
  "approval_status": "approved",
  "approved_purpose": ["coding", "debugging", "planning", "tool-execution"],
  "data_categories": ["synthetic"],
  "spending_limit_usd": 0,
  "expiry": "<owner-chosen, e.g. 7 days after issue>"
}
```

## Required to proceed (all must happen; none has)

1. Owner approves provider, model, purpose, data category `synthetic`, call budget and expiry in writing.
2. Owner creates the Groq key and enables Zero Data Retention.
3. A small adapter change wires Groq through the existing provider abstraction (same consent and connection gates as OpenRouter). That change goes through review and tests first.
4. The owner issues the approval through the workstation (`issueApproval(..., "workstation")`). Agents cannot issue it.

Until then, every cloud-dependent item (live cloud benchmarks, cloud G7 trials, cloud fallback) stays **PENDING**. Local work is unaffected.
