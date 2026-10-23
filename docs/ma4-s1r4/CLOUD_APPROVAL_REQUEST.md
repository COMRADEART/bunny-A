# MA4-S1R4 cloud approval request — STATUS: PENDING (nothing activated)

This updates `docs/ma4-s1r2/CLOUD_APPROVAL_REQUEST.md`. It requests a decision and authorizes nothing. No credential
was created or read, no provider is enabled, and no external inference call has been made in S1R4.

## Why it is requested again

Local models still fail the frozen G7 v2 regression (0/3 in S1R2, S1R3 and S1R4) although the S1R4 workflow passed
held-out G7 at **17/20**. The remaining v2 failure is a single missed edge case (`''` must raise) that no 7B sample,
Tester or repair found. The 27B/30B local models are BLOCKED_RESOURCE_LIMIT (measured: RAM fell to 2.1–2.6 GiB during
load). The two options are: free ≈ 6 GiB of host RAM for a local 30B MoE trial (owner action, no cost), or this request.

## Proposal (unchanged provider and model; scope narrowed)

| Item | Proposed |
|---|---|
| Provider / exact model | Groq — `openai/gpt-oss-120b` only (no fallback model) |
| Roles | **Worker and Tester only**, behind the S1R4 workflow; Planner and Reviewer stay local; acceptance stays with the local sandboxed deterministic gate |
| Data scope | **Synthetic only**: the frozen G7 specs and the S1R4 development task specs already in this repository. Hidden tests and reference solutions never leave the host. No user code, project files, memories, credentials or real prompts |
| Test count | G7 v2 ×3 and held-out 10 × 2 under the unchanged rules, plus the 20-trial development set: ≈ 43 trials × ≤ 4 cloud calls ≈ **≤ 180 requests**, capped by the reservation store (≤ 20 RPM, ≤ 50/day unless raised) |
| Privacy | Zero Data Retention enabled in Groq Data Controls before the first call; Groq contract: no training on inputs/outputs |
| Cost ceiling | **$0.00** (free plan, `allowPaid: false`, `spending_limit_usd: 0`); any billing prompt stops the run |
| Credentials | one owner-created key in the existing DPAPI connection store; never in files, env or logs |
| Gate | the same pre-registered G7 rules; a cloud result would be reported separately from local qualification |

## Approval record the owner would issue on the workstation

```json
{ "provider_id": "groq", "model_id": "openai/gpt-oss-120b", "approval_status": "approved",
  "approved_purpose": ["coding", "debugging"], "data_categories": ["synthetic"],
  "spending_limit_usd": 0, "expiry": "<owner-chosen, e.g. 7 days after issue>" }
```

## Required to proceed (none has happened)

1. The owner approves provider, model, roles, data scope, request cap, cost ceiling and expiry in writing.
2. The owner creates the key and enables Zero Data Retention.
3. A reviewed adapter change wires Groq through the existing provider abstraction (cloud adapters are disabled today:
   `ma4/registry.ts`, `ma4/cloud-candidates.ts` unchanged; CI checks they stay disabled).
4. The owner issues the approval from the workstation; agents cannot issue approvals.
