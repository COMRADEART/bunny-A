# TypeSafe Jev contract audit (STATIC VERIFIED against the public docs)

Re-read on 2026-10-12 from https://docs.typesafe.ai/api and https://docs.typesafe.ai/models (public pages, no key, no
content sent). The adapter is `src/lib/bunny-host/typesafe-jev.server.ts` plus validators in `src/lib/bunny-host/intelligence.ts`.
It is a small audited HTTP adapter; no SDK is installed. Provider: TypeSafe (api.typesafe.ai). This is not any other
"Jev-compatible" provider. The repository's legacy `releases/installed/JEV-Windows-v1` folder is an older Bunny release
name and is unrelated to TypeSafe Jev.

| Documented fact | Adapter behaviour |
| --- | --- |
| `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <API_KEY>`, JSON body `{state, model, questions}` | Only that origin is accepted (`assertApprovedEndpoint`: https, exact host, no port/userinfo/path); `redirect: "manual"`, so the key is never forwarded to a redirect target |
| Question types `noul`, `choice` (≤255 options, criteria map), `score` (2–10 ordered levels) | `validateSystemOneRequest` enforces the same bounds before sending; Bunny asks one `choice` (eligible model keys only), one `score` (confidence) and one `noul` (ambiguity) |
| Response `{model, answers{id→{type, …}}, usage{input_tokens, output_tokens}}`; choice/score carry `confidence` and `probabilities` | `validateSystemOneResponse` rejects missing/extra ids, wrong types, out-of-set choices, probabilities that do not sum to ~1, out-of-range numbers; bodies over 256 KiB are refused |
| Errors 401, 422, 429, 529; back off on 429/529; `retry-after` may be present | 401/403 → AUTH_FAILED (no retry); 422 → PROVIDER_ERROR (no retry); 429 → RATE_LIMITED with `retry-after` cooldown; 529/5xx → PROVIDER_ERROR + circuit breaker. Model listing retries at most once; billable decisions are never retried, and an unknown outcome counts as spent |
| `jev-latest` and `jev-preview` both resolve to `jev-1.13.0`; versioned ids accepted | Default model `jev-latest`; the model list from `GET /v1/models` (non-billable) feeds the Settings model picker; the answering versioned id is recorded |
| Price $0.042 per million input tokens; output free | `requestCostUsd` estimates from provider-reported `input_tokens`; the monetary cap and strict budget fail closed when usage is unknown |
| Text-only input (no audio/image/video) | Bunny never sends audio; T12 voice PCM is not reachable from the decision path |
| Context 64k tokens (32k state + longest question) | By default Bunny sends exactly five metadata fields: `classified_task_class`, `eligible_models` (BunnyRouter's eligible keys), `resource_budget_class` and `latency_preference` (both from the depth setting), and the fixed `task_category_candidates` list. Request text is added only if the owner opts in, capped at 2,000 characters; text matching any credential pattern (`looksSecret`) is refused whole, not redacted, and nothing is sent |
| `GET /v1/models` lists "the model names your account can send" (account-scoped) | Used only by the explicit Test connection, with the Bearer key; read as proof that the key and network work, never as proof of decision inference. Whether an invalid key is refused on this endpoint is documented-by-implication only: live NOT TESTED |

Live compatibility: **NOT TESTED**. No authorized TypeSafe key was provided, so no request reached TypeSafe. The adapter was
exercised only against a scripted fake transport (SIMULATED) in `intelligence.test.ts` / `intelligence-host.test.ts`.
