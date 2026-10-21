# MA4-S1R2 cloud provider shortlist — readiness only (no live calls)

Discovery: https://github.com/mnfst/awesome-free-llm-apis (read 2026-10-21) as a lead list only. Every shortlisted fact below was checked on the provider's official documentation on 2026-10-21; anything not found there is marked UNVERIFIED. Free tiers can change without notice and must be re-checked at activation.

Selection aims at the demonstrated local weaknesses: coding correctness (G7), tool-calling reliability (0/12 locally), planning and independent review. Advertised benchmark scores were not used.

## Shortlist

| Rank | Provider / model | Free-tier type | Limits (official) | Tools / structured | Data terms (official) | Fit |
|---|---|---|---|---|---|---|
| **1 (preferred)** | **Groq — `openai/gpt-oss-120b`** | rate-limited free plan, no card (per Groq's plan tabs; exact Free values are account-specific) | page shows 30 RPM / 1K RPD / 8K TPM / 200K TPD, explicitly labelled Developer-plan base limits, org-scoped | tool use: yes (no parallel calls for gpt-oss); JSON mode: yes | no default retention of inference data; reliability/abuse logs up to 30 days unless Zero Data Retention is enabled (self-serve); Services Agreement §4.2: Groq may **not** train on inputs/outputs; "not for consumer use" | strongest open-weight reasoning/coding candidate with documented tool use and the cleanest data terms |
| 2 | Groq — `qwen/qwen3.8-27b` | same plan | same table: 30 RPM / 1K RPD / 8K TPM / 200K TPD | tool use incl. parallel; JSON mode | same as above | same family as the local 27B weights, so a measurement would also show what freeing local RAM could buy |
| 3 | OVHcloud AI Endpoints — `gpt-oss-120b` | anonymous, no key | 2 requests/min per IP per model (keys need a Public Cloud project with payment: 400 RPM) | function calling documented on this endpoint for other models; **UNVERIFIED for gpt-oss-120b chat completions** | docs state user data is not stored; EU hosting | no credential needed, EU, but 2 RPM is too slow for multi-agent G7 |

## Considered and not shortlisted

| Provider | Reason (official source) |
|---|---|
| Google Gemini API free tier | Unpaid Services: Google uses prompts/responses to improve products, human reviewers may read them, "do not submit sensitive, confidential, or personal information" (ai.google.dev/gemini-api/terms) |
| Mistral Experiment (free) | inputs/outputs may be used for training unless opted out (help.mistral.ai) |
| OpenRouter `:free` | already integrated (S1); 20 RPM, 50 RPD under 10 credits purchased (openrouter.ai/docs/api/reference/limits); free upstreams "may log prompts for training" per discovery list — synthetic data only, routes through unknown upstreams |
| NVIDIA NIM | discovery list: prompts logged, trial use only (not re-verified) |
| Cerebras | recent sources describe a $5 trial credit, not a permanent free tier; not verified on the official site |
| Cohere | trial key, non-commercial (discovery list) |

## Offline readiness (R2-G4)

* Candidates are data in `src/lib/bunny-host/ma4/cloud-candidates.ts`; all `enabled: false`, `evidence: official-documentation`, sources listed. Pricing is `null` (UNKNOWN), so the existing adapter refuses dispatch ("Unverified pricing/tier") even if enabled.
* Transport: the existing `CompatibleProvider` (HTTPS only, bounded JSON, Retry-After floor, key redaction) plus new bounded SSE streaming; the OpenAI-format tool shim `openAiChat` reuses the same tool loop and broker.
* Offline tests `ma4-cloud.test.ts` (5/5) with a global fetch that throws on any real request: 429 + Retry-After, 402 quota, 503 and network outage, served-model mismatch, key redaction, complete/interrupted/malformed/truncated/broken streams, OpenAI tool calls (id mapping, malformed arguments, unknown tools), disabled candidates and refusal of sensitive data.
* Groq and OVHcloud are **not** wired as Host providers. Activation would add them through the existing adapter/consent pattern only after approval.

Sources: [Groq rate limits](https://console.groq.com/docs/rate-limits) · [Groq tool use](https://console.groq.com/docs/tool-use) · [Groq your data](https://console.groq.com/docs/your-data) · [Groq services agreement](https://console.groq.com/docs/legal/services-agreement) · [OVHcloud AI Endpoints getting started](https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-getting-started) · [OVHcloud function calling](https://help.ovhcloud.com/csm/en-public-cloud-ai-endpoints-function-calling?id=kb_article_view&sysparm_article=KB0071906) · [OVHcloud Responses API](https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-responses-api) · [Gemini API terms](https://ai.google.dev/gemini-api/terms) · [Mistral training opt-out](https://help.mistral.ai/en/articles/347614-can-i-opt-out-of-my-input-or-output-data-being-used-for-training) · [OpenRouter limits](https://openrouter.ai/docs/api/reference/limits) · [discovery list](https://github.com/mnfst/awesome-free-llm-apis)
