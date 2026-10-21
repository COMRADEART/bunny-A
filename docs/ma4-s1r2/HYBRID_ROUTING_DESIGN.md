# MA4-S1R2 hybrid routing design — R2-G3 / R2-G10

Code: `src/lib/bunny-host/ma4/hybrid.ts`, wiring in `routing.server.ts` and `manager.server.ts`, persistence in `ma4/store.server.ts`. Tests: `ma4-hybrid.test.ts` (5), `ma4.test.ts` (18, incl. the updated Host integration fixture).

## Eligibility pipeline (as implemented)

```text
task → applyRoutingMode (adds restrictions; MODEL_PINNED without a model refuses)
     → analyzeModelTask (category, structured, sensitivity)
     → hardExclusions: exact pins / allowlists · privacy (local-only, sensitive, offline) · hard capabilities
       (tools, vision, context, output) · provider readiness · connection consent
       · MA4 API models: configuration + budget + scoped owner approval (approvalExclusion)
     → scoreCandidate: policy priors · context · readiness · usage · latency · empirical · benchmark
       · NEW reliability (measured task-category correctness)
     → selectRoutingCandidate (deterministic tie-break) → MA3 bounded recovery
```

Availability alone never qualifies: a candidate must survive every hard filter. The local-first preference is applied only among eligible candidates (existing latency/local priors; privacy constraints exclude cloud outright).

## Routing modes

| Mode | Effect | Notes |
|---|---|---|
| (absent) | established behaviour | MA4 API providers now ALSO need a scoped approval — strictly safer than S1R |
| `AUTO_LOCAL` | `localOnly: true` | excludes hosted CLIs, MA4 API models and cloud-backed Ollama tags (`:cloud`, `remote_host`) |
| `AUTO_HYBRID` | established behaviour | external models only through consent + configuration + approval |
| `MODEL_PINNED` | requires `modelExact`, else refuses | the pin is a hard filter; no substitution |
| `AGENT_HYBRID` | per-step routing with MA3 per-agent pins (`applySelection`) | each agent may get a different eligible model; pins win |
| `OFFLINE_ONLY` | `localOnly` + `offlineOnly` | Ollama `execute()` also refuses hosted tags at launch |

Modes only add restrictions; none removes one. `routingMode` and `dataCategory` are accepted over HTTP only as validated enums.

## Explicit cloud approval contract

Record (`ApprovalSchema`): `provider_id`, `model_id`, `approval_status` (pending/approved/revoked), `approved_purpose` (task categories), `data_categories` (synthetic/public/code/personal/unclassified), `spending_limit_usd`, `expiry`.

* Issued only through `IntelligenceStore.issueApproval(record, actor)` with `actor === "workstation"` (the existing `isTrustedLocalActor`). The Host stamps `issued_by`/`issued_at`; a row without that stamp is ignored.
* `importApproval()` (files, configuration, agent or model output) always yields **pending**. No code path turns model text into an approval; `ownerDirective` still ignores anything but a leading owner sentence.
* `approvalExclusion` covers exactly one provider + model; an approved provider never implies its other models. Purpose, data category (task default `unclassified`, which must be listed explicitly), unexpired expiry and cumulative reserved spend since issuance must all match.
* An approval removes one exclusion only; configuration (`enabled:false` by default), consent, credentials, budget, privacy and pins still apply.
* **No approval was issued in this phase.** External providers remain disabled.

A trusted Host UI/HTTP route for issuing approvals is NOT added in this phase (external inference stays disabled); the store API is ready for it.

## Reliability-aware ranking (H1/H2)

* Evidence rows: `(provider, model, category, passes, samples, source)`; a benchmark import replaces only its own source; verified runtime outcomes accumulate under `runtime` (`recordOutcome`).
* Score: `reliabilityPoints` = (Wilson 95% lower bound − 0.5) × 20, i.e. −10…+10. Fewer than 3 samples = UNPROVEN = 0 points (never a bonus). Lookup errors count as UNPROVEN.
* Capability flags (JSON mode, tools) and correctness are separate: a model with 6/6 `json-schema` but 0/6 `programming` loses ranking for coding (test H1).
* Hard pins beat reliability evidence (test H1, pinned branch).

H2 failure-aware assignment: repeated failures lower a model's category score through `runtime` evidence; MA3's bounded recovery (`RECOVERY_BOUNDS`: 1 same-candidate retry, 2 alternates, 4 attempts) evaluates alternates and never touches pins or privacy constraints. When no eligible local candidate remains and only an unapproved cloud model could serve, routing reports `MODEL_APPROVAL_REQUIRED` instead of calling it.

## Agent isolation (H3)

Inter-agent artifacts are untrusted input: strict schemas reject extra keys (e.g. `model_override`); pins, allowed imports, module names, permissions, quotas and approvals come only from the orchestrator (`ma4-workflow.test.ts` E3/H3). Mission routing reads only `step.objective`.

## Measured limitations (not hidden)

* The task analyzer is coarse: held-out debugging and planning prompts classify as `coding`; math, tool and instruction prompts as `general`, which has no reliability mapping (dry run in `evidence/heldout-auto-vs-fixed.json`). Improving it must use new data, not the held-out prompts.
* Exact score ties fall back to provider order then model id (alphabetical), which is arbitrary between the two local 7B models.
* Runtime evidence is recorded only for tasks that carry an independent Host verification spec (`verify`); unverified completions add nothing (covered by `m2.test.ts`, one pass + one fail → 1/2).
