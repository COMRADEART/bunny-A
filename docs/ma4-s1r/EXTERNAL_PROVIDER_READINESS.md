# External provider readiness — preparation only

Prepared 2026-10-20. Base `f5d3f90`. **Activation and live external inference: PENDING USER APPROVAL.** No inference, authentication or authenticated quota request was made. Public documentation lookup is not an inference result.

## Candidate and verified documentation

Provider: OpenRouter, using the existing S1 adapter. Candidate exact model: `qwen/qwen3-4b:free`. Its [official model page](https://openrouter.ai/qwen/qwen3-4b:free) lists free access and 128K context. Availability, concrete downstream processor, supported parameters and zero token pricing must be revalidated at activation; a web listing is not live API qualification.

Official references reviewed:

* [API limits](https://openrouter.ai/docs/api/reference/limits): free variants are capped at 20 requests/minute and ordinarily 50/day; eligible accounts that purchased at least $10 credits can have 1,000/day. Additional account/model capacity limits may apply. Buying credits is not required or authorized for this procedure.
* [Free variants](https://openrouter.ai/docs/guides/routing/model-variants/free): use the exact `:free` identifier; rate-limited availability is not a permanence or SLA guarantee.
* [Provider selection](https://openrouter.ai/docs/guides/routing/provider-selection): restrict to an owner-reviewed downstream allowlist, disable fallback, require supported parameters and deny data collection. If those restrictions leave no eligible endpoint, qualification is BLOCKED; do not relax them automatically.
* [Authentication](https://openrouter.ai/docs/api/reference/authentication): API-key Bearer authentication is required. Use existing Host DPAPI storage, never committed configuration or browser storage.
* [Privacy policy](https://openrouter.ai/privacy) and [provider data practices](https://openrouter.ai/docs/guides/privacy/provider-logging): prompts leave this machine and pass through an aggregator and downstream processor. Retention/training depends on their terms/settings. A free price is not a privacy assurance.
* [Terms](https://openrouter.ai/terms): model and provider conditions also govern usage. Commercial suitability requires reviewing the selected model license and downstream restrictions; no blanket commercial-use clearance is claimed here.

## Bounded procedure after fresh explicit approval

1. User approves the provider, exact model, downstream processor, synthetic payload categories, privacy implications and quota budget. Supply credentials only through the existing trusted Host credential workflow. Approval of this document is not inferred.
2. Verify current public model metadata, account capacity, supported JSON fields, served-model naming and downstream terms. Enable one exact model, one downstream, paid access OFF, strict monetary ceilings at zero, evaluations OFF until separately scoped.
3. At most six synthetic requests, sequential, at most 1,024 input and 128 output tokens/request, 30-second request deadlines, no transport retries. Estimated maximum: 6,144 input + 768 output tokens; reserve at least six daily requests. Actual tokenizer counts and upstream failures may differ. No private fixture, source tree, user data, tool invocation or network-enabled agent.
4. Exercise plain text, exact pin, structured JSON, cancellation if supported, bounded error handling and denial of an unapproved model. Preserve served-model/usage receipts. Unsupported streaming/tools remain UNSUPPORTED. Mock quota exhaustion; do not consume the real account quota to exhaustion.
5. Disable activation again and verify reservations/cooldowns and secret redaction. Do not claim cloud qualification until real receipts validate it.

Mock-backed S1 contract tests exercise headers, exact pins, model mismatch, untrusted metadata, output/error redaction, quota reservations, retry/cooldown behavior, consent, and paired-client denial. Reproduced results are in `evidence/checks.json`. G11 is a readiness gate only. Live external activation remains **PENDING USER APPROVAL**, even if G11 preparation passes.
